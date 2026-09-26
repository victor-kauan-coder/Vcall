/**
 * ui/profile-editor.js — trocar nome e avatar no meio da chamada.
 *
 * O saguão já deixava escolher avatar antes de entrar, mas dentro da chamada o
 * avatar das Configurações era só uma figura: clicar nele não fazia nada. Aqui
 * ele vira um botão que abre a mesma grade do saguão (estilos, sortear, usar
 * foto), e a escolha vale na hora para todo mundo da sala.
 *
 * O editor é montado DENTRO do corpo do diálogo de Configurações, no lugar da
 * linha de perfil — nada de um segundo diálogo por cima do primeiro, que é
 * justamente o tipo de coisa que "abre e some" quando um fecha o outro.
 */
import { el, icon, clear } from "../lib/dom.js";
import { prefs, randomSeed } from "../lib/util.js";
import { AVATAR_STYLES, avatarEl, sampleAvatars, STYLE_LABELS, isPhoto } from "./avatars.js";
import { preparePhoto, ACCEPTED } from "./photo.js";
import { toast } from "./toast.js";

/**
 * @param {{ profile: {name:string, avatar:object}, onChange: (profile) => void }} opts
 * @returns {HTMLElement} o bloco "Seu perfil", pronto para entrar no diálogo.
 */
export function profileSection({ profile, onChange }) {
  let avatar = profile.avatar;
  let aberto = false;

  const nameInput = el("input.input", {
    type: "text",
    value: profile.name,
    maxLength: 32,
    "aria-label": "Seu nome",
  });
  nameInput.addEventListener("change", () => {
    const name = nameInput.value.trim().slice(0, 32);
    if (!name) {
      nameInput.value = profile.name;
      return;
    }
    if (name === profile.name) return;
    profile = { ...profile, name };
    prefs.set("name", name);
    onChange(profile);
    toast("Nome atualizado", { tone: "ok", ms: 1800, key: "perfil" });
  });

  const avatarBtn = el("button.profileEdit__avatar", {
    type: "button",
    "aria-label": "Trocar avatar",
    "aria-expanded": "false",
    dataset: { tip: "Trocar avatar", "tip-placement": "bottom" },
  });
  const lapis = el("span.profileEdit__badge", { "aria-hidden": "true" }, [icon("pencil", { size: "sm" })]);

  const grade = el("div.avatarPicker__grid.profileEdit__grid", { role: "radiogroup", "aria-label": "Avatar" });
  const fotoInput = el("input.sr-only", { type: "file", accept: ACCEPTED, tabIndex: -1 });
  const sortear = el("button.btn.btn--ghost", { type: "button" }, [icon("shuffle", { size: "sm" }), el("span", { text: "Sortear" })]);
  const usarFoto = el("button.btn.btn--ghost", { type: "button" }, [icon("image", { size: "sm" }), el("span", { text: "Usar foto" })]);
  const gaveta = el("div.profileEdit__drawer", { hidden: true }, [
    el("div.row.profileEdit__tools", {}, [el("span.field__label", { text: "Escolha um avatar" }), el("span.spacer"), usarFoto, sortear]),
    grade,
    fotoInput,
  ]);

  const aplicar = (novo) => {
    avatar = novo;
    profile = { ...profile, avatar };
    prefs.set("avatar", avatar);
    desenharBotao();
    desenharGrade();
    onChange(profile);
  };

  function desenharBotao() {
    clear(avatarBtn);
    avatarBtn.append(avatarEl(avatar, { size: 44, title: "Seu avatar" }), lapis);
  }

  function desenharGrade() {
    clear(grade);
    const usandoFoto = isPhoto(avatar);
    if (usandoFoto) {
      grade.append(
        el("button.avatarPicker__option", { type: "button", role: "radio", "aria-checked": "true", "aria-label": "Sua foto" }, [
          avatarEl(avatar, { title: "Sua foto" }),
        ]),
      );
    }
    const seed = usandoFoto ? prefs.get("avatar:seed", null) || randomSeed() : avatar.seed;
    prefs.set("avatar:seed", seed);
    for (const spec of sampleAvatars(seed)) {
      const rotulo = STYLE_LABELS[spec.style] || spec.style;
      grade.append(
        el(
          "button.avatarPicker__option",
          {
            type: "button",
            role: "radio",
            "aria-label": rotulo,
            "aria-checked": String(!usandoFoto && spec.style === avatar.style),
            onClick: () => aplicar({ ...spec }),
          },
          [avatarEl(spec, { title: rotulo })],
        ),
      );
    }
  }

  const alternar = (abrir = !aberto) => {
    aberto = abrir;
    gaveta.hidden = !abrir;
    avatarBtn.setAttribute("aria-expanded", String(abrir));
    if (abrir) desenharGrade();
  };

  avatarBtn.addEventListener("click", (e) => {
    // Dentro de <form method="dialog"> qualquer clique que envie o formulário
    // fecha as Configurações. `type="button"` já evita isso; o preventDefault
    // é a garantia para quem mexer aqui depois.
    e.preventDefault();
    alternar();
  });
  sortear.addEventListener("click", (e) => {
    e.preventDefault();
    const style = isPhoto(avatar) ? prefs.get("avatar:style", null) || AVATAR_STYLES[0] : avatar.style;
    aplicar({ style, seed: randomSeed() });
  });
  usarFoto.addEventListener("click", (e) => {
    e.preventDefault();
    fotoInput.click();
  });
  fotoInput.addEventListener("change", async () => {
    const file = fotoInput.files?.[0];
    fotoInput.value = "";
    if (!file) return;
    try {
      const { photo } = await preparePhoto(file);
      if (!isPhoto(avatar) && avatar?.style) prefs.set("avatar:style", avatar.style);
      aplicar({ photo });
      toast("Foto atualizada", { tone: "ok", ms: 1800, key: "perfil" });
    } catch (err) {
      toast(err?.message || "Não foi possível usar essa imagem.", { tone: "warn" });
    }
  });

  desenharBotao();

  return el("div.stack.profileEdit", {}, [
    el("h3", { text: "Seu perfil", style: { fontSize: "var(--text-md)" } }),
    el("div.row", {}, [avatarBtn, nameInput]),
    gaveta,
  ]);
}
