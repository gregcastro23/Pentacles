/* Tiny element builders for AlchmChart. `h` = HTML, `s` = SVG. */
const SVG_NS = "http://www.w3.org/2000/svg";

function apply(node, attrs) {
  if (!attrs) return;
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") node.setAttribute("class", v);
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "dataset") for (const d in v) node.dataset[d] = v[d];
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
}
function append(node, children) {
  if (children == null) return;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}
export function h(tag, attrs, children) {
  const n = document.createElement(tag);
  apply(n, attrs); append(n, children); return n;
}
export function s(tag, attrs, children) {
  const n = document.createElementNS(SVG_NS, tag);
  apply(n, attrs); append(n, children); return n;
}
export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
