/** Keep live state advancing while avoiding unnecessary GPU submissions. */
export class CourtRenderBudget {
  private dirty = true;
  private wasVisible = false;
  private lastRender = -Infinity;

  invalidate(): void { this.dirty = true; }

  shouldRender(now: number, motion: boolean, visible: boolean): boolean {
    if (!visible) { this.wasVisible = false; return false; }
    const render = motion || this.dirty || !this.wasVisible || now - this.lastRender >= 250;
    this.wasVisible = true;
    if (render) {
      this.dirty = false;
      this.lastRender = now;
    }
    // A quiet scene gets a 4 Hz heartbeat for async model loads and rating
    // changes; controls and pointer feedback explicitly invalidate sooner.
    return render;
  }
}
