/**
 * features/transfer.js — envio de arquivos na conversa.
 *
 * O arquivo vai pelo mesmo caminho da mídia: direto de navegador a navegador,
 * pelo DataChannel, criptografado por DTLS. Ele nunca toca o servidor — que é
 * o ponto: um anexo que sobe para algum lugar deixa de ser uma conversa
 * privada, vira um arquivo guardado por outra pessoa.
 *
 * Duas consequências práticas disso, e as duas moldam o código:
 *
 * 1. NÃO HÁ ARMAZENAMENTO. Quem não estava na sala na hora do envio não
 *    recebe. Não há "histórico de anexos" para buscar depois; o arquivo existe
 *    enquanto a aba de quem recebeu estiver aberta.
 *
 * 2. O CANAL TEM TETO. Um DataChannel não engole megabytes de uma vez: ele
 *    vai em pedaços, e o remetente espera o buffer esvaziar entre eles
 *    (`broadcastBlob` já faz essa espera). Por isso há um limite de tamanho —
 *    acima dele o certo é mandar um link, não empurrar o arquivo pela chamada.
 */
import { Emitter } from "../lib/emitter.js";

/** Teto por arquivo. Acima disso a transferência leva minutos e trava o canal. */
export const MAX_FILE = 25 * 1024 * 1024;
/** Pedaço em base64. Pequeno, para a fila do canal (128 kB) andar em passos finos. */
const CHUNK = 16 * 1024;
/** Sem novos pedaços por este tempo, a transferência é dada por abandonada. */
const ABANDONADO_MS = 120_000;

let counter = 0;
const newId = (selfId) => `${selfId}-f${Date.now().toString(36)}-${(counter += 1)}`;

export class FileTransfer extends Emitter {
  /** id -> { meta, total, parts, got } */
  #incoming = new Map();

  /**
   * Quem põe cada pedaço na rede. Deve devolver uma promessa que só resolve
   * quando o pedaço saiu (mesh.broadcastBlob). Sem ele, os pedaços são só
   * emitidos como evento `blob` (usado nos testes).
   */
  sender = null;

  constructor({ selfId = "self" } = {}) {
    super();
    this.selfId = selfId;
  }

  async #enviar(payload) {
    if (this.sender) return this.sender(payload);
    this.emit("blob", payload);
    return { ok: [], falhou: [] };
  }

  /**
   * Fatia e emite um arquivo. Quem escuta `blob` põe cada pedaço na rede.
   * Devolve os metadados para a conversa mostrar a bolha imediatamente, antes
   * de o envio terminar.
   */
  async send(file) {
    if (!file) return null;
    if (file.size > MAX_FILE) {
      this.emit("error", { file, reason: "too-large" });
      return null;
    }

    const id = newId(this.selfId);
    const data = await toBase64(file);
    const total = Math.max(1, Math.ceil(data.length / CHUNK));
    const meta = {
      id,
      name: String(file.name || "arquivo").slice(0, 120),
      size: file.size,
      mime: file.type || "application/octet-stream",
      at: Date.now(),
    };

    /*
     * O envio segue em segundo plano, um pedaço de cada vez: o próximo só sai
     * quando o anterior foi aceito pela rede. A bolha de quem manda aparece
     * na hora e a barra de progresso mostra o avanço de verdade (antes ela
     * marcava 100% antes de qualquer byte sair).
     */
    const falharam = new Set();
    const envio = (async () => {
      const r0 = await this.#enviar({ type: "file-begin", id, by: this.selfId, meta, total });
      for (const f of r0?.falhou || []) falharam.add(f);
      for (let i = 0; i < total; i += 1) {
        const r = await this.#enviar({
          type: "file-chunk",
          id,
          by: this.selfId,
          i,
          total,
          data: data.slice(i * CHUNK, (i + 1) * CHUNK),
        });
        for (const f of r?.falhou || []) falharam.add(f);
        this.emit("progress", { id, sent: i + 1, total, outgoing: true });
      }
      const resultado = { id, falhou: [...falharam] };
      this.emit("sent", resultado);
      return resultado;
    })();

    // O próprio remetente também recebe um objeto pronto, para a bolha dele
    // ter um botão de baixar igual ao dos outros.
    return { ...meta, url: URL.createObjectURL(file), blob: file, self: true, envio };
  }

  /** Trata uma mensagem vinda do canal de carga pesada. Ignora o que não é dela. */
  apply(from, msg) {
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "file-begin") {
      if (!msg.meta || !Number.isInteger(msg.total) || msg.total < 1) return true;
      if (Number(msg.meta.size) > MAX_FILE) return true;
      this.#varrerIncompletos();
      this.#incoming.set(msg.id, { from, meta: msg.meta, total: msg.total, parts: [], got: 0, at: Date.now() });
      this.emit("start", { id: msg.id, from, meta: msg.meta });
      return true;
    }

    if (msg.type === "file-chunk") {
      const entry = this.#incoming.get(msg.id);
      if (!entry) return true;
      // Um pedaço repetido não pode contar duas vezes, senão a contagem chega
      // ao total com buracos e o arquivo sai corrompido.
      if (entry.parts[msg.i] === undefined) {
        entry.parts[msg.i] = msg.data;
        entry.got += 1;
        entry.at = Date.now();
      }
      this.emit("progress", { id: msg.id, sent: entry.got, total: entry.total, outgoing: false });
      if (entry.got < entry.total) return true;

      this.#incoming.delete(msg.id);
      try {
        const blob = fromBase64(entry.parts.join(""), entry.meta.mime);
        this.emit("file", {
          ...entry.meta,
          from: entry.from,
          url: URL.createObjectURL(blob),
          blob,
          size: blob.size,
        });
      } catch (err) {
        this.emit("error", { reason: "decode", err });
      }
      return true;
    }

    return false;
  }

  /**
   * Descarta transferências que pararam no meio.
   *
   * Quem mandava pode ter fechado a aba ou caído da rede sem que o `peer-leave`
   * chegasse. Os pedaços já recebidos ficavam guardados para sempre — e o
   * limite por arquivo é de 25 MB, que em base64 passa de 33 MB na memória.
   * Duas tentativas abandonadas já seriam mais memória do que o aplicativo
   * inteiro ocupa.
   */
  #varrerIncompletos() {
    const limite = Date.now() - ABANDONADO_MS;
    for (const [id, entrada] of this.#incoming) {
      if ((entrada.at || 0) < limite) {
        this.#incoming.delete(id);
        this.emit("cancelado", { id, motivo: "parou de chegar" });
      }
    }
  }

  /** Esquece transferências pela metade de quem saiu da sala. */
  forget(peerId) {
    for (const [id, entry] of this.#incoming) {
      if (entry.from === peerId) this.#incoming.delete(id);
    }
  }
}

/* ==================================================================== *
 * Base64
 *
 * O DataChannel deste app trafega JSON, e JSON não carrega bytes crus. Base64
 * custa um terço a mais de tamanho e é o que mantém o arquivo no mesmo caminho
 * já testado das imagens do canvas, sem um segundo protocolo binário só para
 * isto.
 * ==================================================================== */

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const url = String(fr.result || "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function fromBase64(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
