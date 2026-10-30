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
    style: any = {
      setProperty: (k: string, v: string) => { this.style[k] = v; },
      getPropertyValue: (k: string) => this.style[k] ?? '',
    };
    text = '';
    events = new Map<string, Set<(event: any) => void>>();
    scrollTop = 0;
    clientWidth = 800;
    clientHeight = 600;

    constructor(public tagName: string) {}

    get firstChild() { return this.children[0] || null; }
    get isConnected(): boolean { return this === document.body || !!this.parentNode?.isConnected; }
    get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
    set textContent(value: string) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.text = String(value);
    }

    get innerHTML(): string {
      return this.children.map(c => c.tagName === '#TEXT' ? c.textContent : `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
    }
    set innerHTML(html: string) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.text = '';
      if (!html) return;
      parseHTML(html, this, document);
    }

    get className(): string { return this.getAttribute('class') ?? ''; }
    set className(val: string) { this.setAttribute('class', val); }

    get id(): string { return this.getAttribute('id') ?? ''; }
    set id(val: string) { this.setAttribute('id', val); }

    get value(): string { return this.attrs.get('value') ?? ''; }
    set value(v: string) { this.attrs.set('value', String(v)); }

    get disabled(): boolean { return this.attrs.has('disabled'); }
    set disabled(v: boolean) { if (v) this.setAttribute('disabled', ''); else this.attrs.delete('disabled'); }

    get hidden(): boolean { return this.attrs.has('hidden'); }
    set hidden(v: boolean) { if (v) this.setAttribute('hidden', ''); else this.attrs.delete('hidden'); }

    setAttribute(key: string, value: unknown) {
      this.attrs.set(key, String(value));
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key: string) { return this.attrs.get(key) ?? null; }

    get classList() {
      const values = () => new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
      const toggle = (name: string, force?: boolean) => {
        const set = values();
        const add = force ?? !set.has(name);
        if (add) set.add(name); else set.delete(name);
        this.setAttribute('class', [...set].join(' '));
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
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    replaceChildren(...nodes: Element[]) {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (const node of nodes) this.appendChild(node);
    }
    append(...nodes: (Element | string)[]) {
      for (const node of nodes) {
        if (typeof node === 'string') this.appendChild(document.createTextNode(node));
        else this.appendChild(node);
      }
    }
    contains(node: Element | null): boolean {
      return !!node && (node === this || this.children.some((c) => c.contains(node)));
    }
    focus() { if (this.isConnected) document.activeElement = this; }
    getClientRects() { return this.isConnected ? [{}] : []; }

    matches(selector: string): boolean {
      const excluded = [...selector.matchAll(/:not\(([^)]+)\)/g)];
      if (excluded.some((m) => this.matches(m[1]))) return false;
      selector = selector.replace(/:not\([^)]+\)/g, '');
      const tag = selector.match(/^[a-z0-9-]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = selector.match(/#([\w-]+)/)?.[1];
      if (id && this.getAttribute('id') !== id) return false;
      if ([...selector.matchAll(/\.([\w-]+)/g)].some((m) => !this.classList.contains(m[1]))) return false;
      return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every((m) =>
        m[2] === undefined ? this.attrs.has(m[1]) : this.getAttribute(m[1]) === m[2]);
    }
    querySelectorAll(selector: string): Element[] {
      const result: Element[] = [];
      for (const child of this.children) {
        if (selector.split(',').some((s) => child.matches(s.trim()))) result.push(child);
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
    removeEventListener(type: string, listener: (event: any) => void) {
      this.events.get(type)?.delete(listener);
    }
    dispatchEvent(event: any) {
      if (!event.target) event.target = this;
      let curr: Element | null = this;
      while (curr) {
        for (const listener of curr.events.get(event.type) || []) listener(event);
        curr = curr.parentNode;
      }
    }
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }
    showModal() {}
    close() { this.parentNode?.removeChild(this); }
    remove() { this.parentNode?.removeChild(this); }
  }

  function parseHTML(html: string, parent: Element, doc: any): void {
    const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
    const stack: Element[] = [parent];
    const voidTags = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(html)) !== null) {
      if (match[3]) {
        const text = match[3];
        if (text.length > 0) {
          stack[stack.length - 1].appendChild(doc.createTextNode(text));
        }
      } else if (match[1]) {
        const isClosing = match[0].startsWith('</');
        const tagName = match[1].toUpperCase();
        if (isClosing) {
          if (stack.length > 1 && stack[stack.length - 1].tagName === tagName) {
            stack.pop();
          }
        } else {
          const el = doc.createElement(tagName);
          const attrStr = match[2] || '';
          const attrRegex = /([a-zA-Z0-9-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
          let attrMatch: RegExpExecArray | null;
          while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
            const key = attrMatch[1];
            const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
            el.setAttribute(key, val);
          }
          stack[stack.length - 1].appendChild(el);
          const isSelfClosing = match[0].endsWith('/>') || voidTags.has(tagName);
          if (!isSelfClosing) {
            stack.push(el);
          }
        }
      }
    }
  }

  document = {
    createElement: (tag: string) => new Element(tag.toUpperCase()),
    createTextNode: (text: string) => Object.assign(new Element('#TEXT'), { text }),
    getElementById: (id: string) => document.body.querySelector(`#${id}`),
    querySelector: (selector: string) => document.body.querySelector(selector),
    querySelectorAll: (selector: string) => document.body.querySelectorAll(selector),
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: any) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent(event: any) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
  document.body = new Element('BODY');
  document.activeElement = document.body;
  return document;
}

export function setupVesselDomGlobals(): { document: any; window: any; cleanup: () => void } {
  const document = createVesselDocument();
  const originalGlobals: Record<string, any> = {
    document: (globalThis as any).document,
    window: (globalThis as any).window,
    ResizeObserver: (globalThis as any).ResizeObserver,
    requestAnimationFrame: (globalThis as any).requestAnimationFrame,
    cancelAnimationFrame: (globalThis as any).cancelAnimationFrame,
    Event: (globalThis as any).Event,
    CustomEvent: (globalThis as any).CustomEvent,
  };

  const windowObj = {
    document,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(performance.now()), 16),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
    addEventListener: document.addEventListener,
    removeEventListener: document.removeEventListener,
    dispatchEvent: document.dispatchEvent,
  };

  Object.assign(globalThis, {
    document,
    window: windowObj,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
    Event: class Event {
      constructor(public type: string) {}
    },
    CustomEvent: class CustomEvent {
      constructor(public type: string, public init?: any) {}
    },
  });

  return {
    document,
    window: windowObj,
    cleanup: () => {
      for (const [key, val] of Object.entries(originalGlobals)) {
        if (val === undefined) delete (globalThis as any)[key];
        else (globalThis as any)[key] = val;
      }
    },
  };
}
