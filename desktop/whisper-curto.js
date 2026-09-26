/**
 * desktop/whisper-curto.js — adapta o encoder do Whisper para trechos curtos.
 *
 * O Whisper sempre lê uma janela de 30 s: uma frase de 2 s é completada com
 * 28 s de silêncio e o encoder processa tudo. No modelo exportado para ONNX
 * isso está gravado no grafo — o embedding de posição é uma constante de
 * 1500 posições somada à entrada — e um trecho menor simplesmente não roda.
 *
 * Aqui o grafo é editado uma vez, logo depois do download:
 *
 *   1. a constante de posições passa por um Slice com o tamanho real da
 *      entrada — o encoder aceita de 1 a 30 s (é o `audio_ctx` do
 *      whisper.cpp). Medido: uma frase de 8 s no modelo "base" cai de ~3,9 s
 *      para ~0,14 s de processamento;
 *   2. as saídas `encoder_attentions.*` são removidas. O modelo foi exportado
 *      com elas (servem para carimbos de tempo, que não usamos), e com 30 s
 *      de áudio elas somam ~430 MB de memória a CADA inferência no "base".
 *
 * Sem dependências: um leitor/escritor mínimo do formato protobuf, só com
 * os campos do ONNX que importam. O resto do arquivo (os pesos) é copiado
 * byte a byte, sem ser interpretado.
 */

/* ------------------------------------------------------------------ *
 * Protobuf mínimo
 * ------------------------------------------------------------------ */

function lerVarint(buf, pos) {
  let valor = 0n;
  let desloc = 0n;
  for (;;) {
    const b = buf[pos++];
    valor |= BigInt(b & 0x7f) << desloc;
    if (b < 0x80) return [valor, pos];
    desloc += 7n;
  }
}

function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** Campos de uma mensagem, sem decodificar o conteúdo: { num, tipo, cru, dados }. */
export function campos(buf) {
  const lista = [];
  let pos = 0;
  while (pos < buf.length) {
    const ini = pos;
    const [chave, p1] = lerVarint(buf, pos);
    pos = p1;
    const num = Number(chave >> 3n);
    const tipo = Number(chave & 7n);
    let dados = null;
    if (tipo === 0) {
      pos = lerVarint(buf, pos)[1];
    } else if (tipo === 1) {
      pos += 8;
    } else if (tipo === 5) {
      pos += 4;
    } else if (tipo === 2) {
      const [tam, p2] = lerVarint(buf, pos);
      dados = buf.subarray(p2, p2 + Number(tam));
      pos = p2 + Number(tam);
    } else {
      throw new Error(`protobuf: tipo de campo ${tipo} não suportado`);
    }
    lista.push({ num, tipo, cru: buf.subarray(ini, pos), dados });
  }
  return lista;
}

const bytes = (num, conteudo) => Buffer.concat([varint((num << 3) | 2), varint(conteudo.length), conteudo]);
const texto = (num, s) => bytes(num, Buffer.from(s, "utf8"));
const inteiro = (num, n) => Buffer.concat([varint(num << 3), varint(n)]);
const str = (f) => f.dados.toString("utf8");

/** NodeProto: input=1, output=2, name=3, op_type=4. */
function no({ entradas, saidas, nome, op }) {
  return Buffer.concat([...entradas.map((e) => texto(1, e)), ...saidas.map((s) => texto(2, s)), texto(3, nome), texto(4, op)]);
}

/** TensorProto int64 1-D: dims=1, data_type=2 (7 = INT64), int64_data=7, name=8. */
function constante(nome, valores) {
  return Buffer.concat([inteiro(1, valores.length), inteiro(2, 7), ...valores.map((v) => inteiro(7, v)), texto(8, nome)]);
}

/* ------------------------------------------------------------------ *
 * A edição
 * ------------------------------------------------------------------ */

const MARCA = "vcall_curto";

/** O encoder já foi adaptado? (procura a marca sem decodificar os pesos) */
export function jaAdaptado(buf) {
  return buf.includes(Buffer.from(`${MARCA}_pos`));
}

/**
 * @param {Buffer} modelo  bytes do encoder_model*.onnx
 * @returns {Buffer} o modelo adaptado (ou o mesmo, se já estava)
 */
export function adaptarEncoder(modelo) {
  if (jaAdaptado(modelo)) return modelo;
  const topo = campos(modelo);
  const iGrafo = topo.findIndex((f) => f.num === 7 && f.tipo === 2);
  if (iGrafo < 0) throw new Error("ONNX sem grafo");
  const grafo = campos(topo[iGrafo].dados);

  // O nó que soma o embedding de posição: Add(x, embed_positions.weight).
  let alvo = -1;
  let entradas = null;
  for (let i = 0; i < grafo.length; i += 1) {
    const f = grafo[i];
    if (f.num !== 1 || f.tipo !== 2) continue;
    const c = campos(f.dados);
    if (!c.some((x) => x.num === 4 && str(x) === "Add")) continue;
    const ins = c.filter((x) => x.num === 1).map(str);
    if (ins.length === 2 && /embed_positions\.weight$/.test(ins[1])) {
      alvo = i;
      entradas = { campos: c, ins };
      break;
    }
  }
  if (alvo < 0) throw new Error("encoder sem embedding de posição reconhecível");
  const [x, pos] = entradas.ins;
  const m = (s) => `${MARCA}_${s}`;

  // Add original, agora somando a fatia das posições.
  const addNovo = Buffer.concat(
    entradas.campos.map((c) => {
      if (c.num === 1 && str(c) === pos) return texto(1, m("pos"));
      return c.cru;
    }),
  );
  // T = Shape(x)[1:2]; pos_T = Slice(pos, [0], T, [0])
  const nos = [
    no({ entradas: [x], saidas: [m("forma")], nome: m("Shape"), op: "Shape" }),
    no({ entradas: [m("forma"), m("um"), m("dois")], saidas: [m("T")], nome: m("SliceT"), op: "Slice" }),
    no({ entradas: [pos, m("zero"), m("T"), m("zero")], saidas: [m("pos")], nome: m("SlicePos"), op: "Slice" }),
  ].map((n) => bytes(1, n));
  const consts = [constante(m("zero"), [0]), constante(m("um"), [1]), constante(m("dois"), [2])].map((c) => bytes(5, c));

  const novo = [];
  for (let i = 0; i < grafo.length; i += 1) {
    const f = grafo[i];
    if (i === alvo) {
      novo.push(...nos, bytes(1, addNovo));
      continue;
    }
    // Saídas de atenção: fora (ValueInfoProto: name=1).
    if (f.num === 12 && f.tipo === 2) {
      const nome = campos(f.dados).find((c) => c.num === 1);
      if (nome && /attentions/.test(str(nome))) continue;
    }
    novo.push(f.cru);
  }
  novo.push(...consts);

  const grafoNovo = Buffer.concat(novo);
  return Buffer.concat(topo.map((f, i) => (i === iGrafo ? bytes(7, grafoNovo) : f.cru)));
}
