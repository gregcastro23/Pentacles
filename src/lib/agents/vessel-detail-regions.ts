/** Preserve a reader's place when the selected vessel receives a new snapshot. */
export function preserveVesselReading(host: HTMLElement, sameVessel = true): () => void {
  const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const focusedSeal = sameVessel ? focused?.closest('details[data-seal-id]')?.getAttribute('data-seal-id') : null;
  const openSeals = new Set(sameVessel ? Array.from(host.querySelectorAll('details[open]'), item => item.getAttribute('data-seal-id')) : []);
  const portrait = sameVessel ? host.querySelector<HTMLImageElement>('img') : null;
  const scroll = sameVessel ? Array.from(host.querySelectorAll<HTMLElement>('.pk-vessel-card-hud, .pk-vessel-body'),
    element => ({ selector: `.${element.className}`, top: element.scrollTop })) : [];
  return () => {
    const replacement = host.querySelector<HTMLImageElement>('img');
    if (portrait && replacement && portrait !== replacement) {
      replacement.parentNode!.insertBefore(portrait, replacement);
      replacement.remove();
    }
    let summary: HTMLElement | null = null;
    for (const seal of host.querySelectorAll<HTMLDetailsElement>('details[data-seal-id]')) {
      const id = seal.getAttribute('data-seal-id');
      if (openSeals.has(id)) seal.setAttribute('open', '');
      if (id === focusedSeal) summary = seal.querySelector('summary');
    }
    if (focused && !focused.isConnected) {
      const button = focused.id ? Array.from(host.querySelectorAll<HTMLElement>('button')).find(item => item.id === focused.id) : null;
      (summary ?? button ?? host.closest<HTMLElement>('.pk-court-detail') ?? host).focus({ preventScroll: true });
    }
    for (const item of scroll) {
      const element = host.querySelector<HTMLElement>(item.selector);
      if (element) element.scrollTop = item.top;
    }
  };
}

/** Update only changed inspector sections; activity/age must not reset seals or portraits. */
export class VesselDetailRegions {
  private key: string | null = null;
  private regions: Array<{ element: HTMLElement; markup: string }> = [];

  constructor(private host: HTMLElement) {}

  reset(): void { this.key = null; this.regions = []; }

  update(key: string, sections: string[]): void {
    if (this.key !== key) {
      this.host.replaceChildren();
      this.regions = [];
      this.key = key;
    }
    sections.forEach((markup, index) => {
      let region = this.regions[index];
      if (!region) {
        const element = document.createElement('div');
        element.className = 'pk-court-detail-region';
        this.host.appendChild(element);
        this.regions[index] = region = { element, markup: '' };
      }
      if (region.markup === markup) return;
      const restore = preserveVesselReading(region.element);
      region.element.innerHTML = markup;
      region.markup = markup;
      restore();
    });
    for (const region of this.regions.splice(sections.length)) region.element.remove();
  }
}
