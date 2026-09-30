// A small DOM fixture, following the existing client test harnesses. Browser
// verification covers layout; these tests exercise lifecycle and focus behavior.
export function createVesselDocument() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  let document: any;

  class Element {
    children: Element[] = [];
    parentNode: Element | null = null;
    attrs = new Map<string, string>();
    dataset: Record<string, string> = {};
    style: any = { setProperty() {} };
    private text = "";
    private events = new Map<string, Set<(event: any) => void>>();
    constructor(public tagName: string) {}
    get firstChild() { return this.children[0] || null; }
    get isConnected(): boolean { return this === document.body || !!this.parentNode?.isConnected; }
    get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
    set textContent(value: string) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.text = String(value);
    }
    setAttribute(key: string, value: unknown) {
      this.attrs.set(key, String(value));
      if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key: string) { return this.attrs.get(key) ?? null; }
    get classList() {
      const values = () => new Set((this.getAttribute("class") || "").split(/\s+/).filter(Boolean));
      const toggle = (name: string, force?: boolean) => {
        const set = values();
        const add = force ?? !set.has(name);
        if (add) set.add(name); else set.delete(name);
        this.setAttribute("class", [...set].join(" "));
        return add;
      };
      return {
        add: (...names: string[]) => names.forEach((n) => toggle(n, true)),
        remove: (...names: string[]) => names.forEach((n) => toggle(n, false)),
        contains: (name: string) => values().has(name),
        toggle,
      };
    }
    appendChild(child: Element) {
      child.parentNode?.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
    removeChild(child: Element) {
      if (child.contains(document.activeElement)) document.activeElement = document.body;
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
      return child;
    }
    contains(node: Element | null): boolean {
      return !!node && (node === this || this.children.some((c) => c.contains(node)));
    }
    focus() { if (this.isConnected) document.activeElement = this; }
    getClientRects() { return this.isConnected ? [{}] : []; }
    matches(selector: string): boolean {
      const excluded = [...selector.matchAll(/:not\(([^)]+)\)/g)];
      if (excluded.some((m) => this.matches(m[1]))) return false;
      selector = selector.replace(/:not\([^)]+\)/g, "");
      const tag = selector.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = selector.match(/#([\w-]+)/)?.[1];
      if (id && this.getAttribute("id") !== id) return false;
      if ([...selector.matchAll(/\.([\w-]+)/g)].some((m) => !this.classList.contains(m[1]))) return false;
      return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every((m) =>
        m[2] === undefined ? this.attrs.has(m[1]) : this.getAttribute(m[1]) === m[2]);
    }
    querySelectorAll(selector: string): Element[] {
      const result: Element[] = [];
      for (const child of this.children) {
        if (selector.split(",").some((s) => child.matches(s.trim()))) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector: string): Element | null {
      return this.matches(selector) ? this : this.parentNode?.closest(selector) || null;
    }
    addEventListener(type: string, listener: (event: any) => void) {
      if (!this.events.has(type)) this.events.set(type, new Set());
      this.events.get(type)!.add(listener);
    }
    dispatchEvent(event: any) { for (const listener of this.events.get(event.type) || []) listener(event); }
  }

  document = {
    createElement: (tag: string) => new Element(tag.toUpperCase()),
    createTextNode: (text: string) => Object.assign(new Element("#text"), { textContent: text }),
    getElementById: (id: string) => document.body.querySelector(`#${id}`),
    querySelector: (selector: string) => document.body.querySelector(selector),
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: any) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent(event: any) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
  document.body = new Element("BODY");
  document.activeElement = document.body;
  return document;
}
