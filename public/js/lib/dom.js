/**
 * lib/dom.js — utilidades de DOM. Sem framework, mas também sem
 * `innerHTML` em caminho que toque dado de usuário.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Cria um elemento.
 *   el("div.tile", { id: "x" }, [child, "texto"])
 * O seletor aceita `tag.classe1.classe2`.
 */
export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.classList.add(...classes);

  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.classList.add(...String(v).split(/\s+/).filter(Boolean));
    // `dataset` só aceita chaves em camelCase; aceitamos kebab-case também,
    // porque é assim que o atributo aparece no HTML e no CSS.
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) {
        if (dv === null || dv === undefined) continue;
        node.dataset[dk.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(dv);
      }
    }
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (val === null || val === undefined) continue;
        // Propriedades personalizadas (--algo) só entram por setProperty;
        // atribuição direta as descarta em silêncio.
        if (prop.startsWith("--")) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k === "text") node.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in node && k !== "list" && typeof v !== "object") {
      node[k] = v;
    } else {
      node.setAttribute(k, v === true ? "" : String(v));
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

/**
 * Um ícone do sprite vendorizado (Lucide). Nunca desenhamos SVG à mão:
 * `name` tem de existir em public/vendor/icons.svg.
 */
export function icon(name, { size = "", label = "", className = "" } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon${size ? ` icon--${size}` : ""}${className ? ` ${className}` : ""}`);
  svg.setAttribute("aria-hidden", label ? "false" : "true");
  if (label) {
    svg.setAttribute("role", "img");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = label;
    svg.append(title);
  }
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `/vendor/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

/** Troca o ícone de um <svg class="icon"> já montado, sem recriar o nó. */
export function setIcon(svg, name) {
  const use = svg?.querySelector("use");
  if (use) use.setAttribute("href", `/vendor/icons.svg#i-${name}`);
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/** Listener com desinscrição — devolve uma função de limpeza. */
export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** Agrupa várias limpezas em uma. */
export function disposer() {
  const fns = [];
  const add = (fn) => (fns.push(fn), fn);
  add.dispose = () => {
    while (fns.length) {
      try {
        fns.pop()();
      } catch {
        /* limpeza nunca deve quebrar o fluxo */
      }
    }
  };
  return add;
}

/** Agenda no próximo quadro, cancelando a chamada anterior pendente. */
export function raf(fn) {
  let id = 0;
  return (...args) => {
    cancelAnimationFrame(id);
    id = requestAnimationFrame(() => fn(...args));
  };
}
