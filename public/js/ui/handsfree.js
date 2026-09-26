/**
 * ui/handsfree.js — o fone Bluetooth que "some com o som" durante a chamada.
 *
 * O sintoma que as pessoas relatam: entram na chamada e param de ouvir o
 * YouTube, a música, o som de outros vídeos. O app não mexe no som de outros
 * programas; quem faz isso é o Bluetooth. Um fone só consegue ser microfone
 * trocando do perfil estéreo (A2DP) para o perfil de ligação (HFP, "Hands-
 * Free"). Nesse perfil o Windows e o Linux expõem OUTRO dispositivo de saída,
 * e tudo o que tocava no fone estéreo fica sem ter por onde sair — além de o
 * som da própria chamada virar qualidade de telefone.
 *
 * Não há como impedir isso de dentro de um app: é o protocolo. O que dá para
 * fazer é perceber e oferecer a saída que resolve — outro microfone, com o
 * fone continuando só como fone de ouvido, em estéreo.
 */
import { toast } from "./toast.js";

/** Rótulos do perfil de ligação no Windows (EN/PT) e no Linux (PipeWire/Pulse). */
const HANDS_FREE = /hands[- ]?free|viva[- ]?voz|ag audio|\bhfp\b|\bhsp\b|head ?unit/i;

export const isHandsFree = (label) => HANDS_FREE.test(label || "");

export function watchHandsFree(media) {
  let warned = null;

  const check = () => {
    const track = media.micTrack;
    if (!track || warned === track.id || !isHandsFree(track.label)) return;
    warned = track.id;

    const alt = media.devices.audioinput.find(
      (d) => d.label && !["default", "communications"].includes(d.deviceId) && !isHandsFree(d.label),
    );
    toast(
      "Seu fone Bluetooth entrou no modo viva-voz para usar o microfone — por isso o som de outros apps some e a chamada fica abafada." +
        (alt ? " Use outro microfone e deixe o fone só para ouvir." : ""),
      {
        tone: "warn",
        ms: 20000,
        key: "handsfree",
        action: alt
          ? {
              label: "Usar outro microfone",
              onClick: async () => {
                if (await media.selectDevice("audioinput", alt.deviceId)) {
                  toast(`Microfone: ${alt.label}. O fone volta ao som estéreo em alguns segundos.`, { tone: "ok" });
                }
              },
            }
          : null,
      },
    );
  };

  check();
  media.on("change", check);
  media.on("devices", check);
}
