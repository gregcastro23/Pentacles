import { describe, expect, it } from 'bun:test';
import { CourtRenderBudget } from '../src/lib/agents/court-render-budget';
import { openPentacleCourt } from '../src/lib/agents/court-view';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { setupVesselDomGlobals } from './helpers/vessel-dom';

describe('Court render budget', () => {
  it('keeps animated frames smooth and limits quiet rendering to a heartbeat', () => {
    const animated = new CourtRenderBudget();
    const quiet = new CourtRenderBudget();
    let animatedFrames = 0, quietFrames = 0;
    for (let i = 0; i < 60; i++) {
      if (animated.shouldRender(i * 1000 / 60, true, true)) animatedFrames++;
      if (quiet.shouldRender(i * 1000 / 60, false, true)) quietFrames++;
    }
    expect(animatedFrames).toBe(60);
    expect(quietFrames).toBe(4);
    quiet.invalidate();
    expect(quiet.shouldRender(990, false, true)).toBe(true);
    expect(quiet.shouldRender(995, false, true)).toBe(false);
  });

  it('renders immediately after returning onscreen and retains hidden invalidations', () => {
    const budget = new CourtRenderBudget();
    expect(budget.shouldRender(0, false, true)).toBe(true);
    expect(budget.shouldRender(10, true, false)).toBe(false);
    budget.invalidate();
    expect(budget.shouldRender(20, false, false)).toBe(false);
    expect(budget.shouldRender(30, false, true)).toBe(true);
    expect(budget.shouldRender(40, false, true)).toBe(false);
  });

  it('skips offscreen draws while completing live movement and cleans up its observer', async () => {
    const { cleanup } = setupVesselDomGlobals();
    const previousObserver = globalThis.IntersectionObserver;
    let nextFrame: FrameRequestCallback | undefined;
    let observed: Element | undefined;
    let visibility: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    let disconnected = false;
    globalThis.IntersectionObserver = class {
      constructor(callback: typeof visibility) { visibility = callback; }
      observe(target: Element) { observed = target; }
      disconnect() { disconnected = true; }
    } as any;
    globalThis.requestAnimationFrame = callback => { nextFrame = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { nextFrame = undefined; };
    const court = openPentacleCourt();
    try {
      const arena = court.getArena();
      let renders = 0;
      arena.renderer.render = () => { renders++; };
      let now = performance.now();
      const advance = () => { now += 20; nextFrame!(now); };
      advance();
      expect(renders).toBe(1);
      expect(observed).toBe(court.getDialog().querySelector('.pk-court-stage'));
      visibility([{ target: observed, isIntersecting: false, intersectionRatio: 0 }]);
      arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0]);
      const travel = arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 1, 500);
      for (let i = 0; i < 30; i++) advance();
      expect(renders).toBe(1);
      expect(await travel).toBe(true);
      expect(arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)?.zoneId).toBe(1);
      visibility([{ target: observed, isIntersecting: true, intersectionRatio: 1 }]);
      advance();
      expect(renders).toBe(2);

      court.getDialog().querySelector<HTMLButtonElement>('[data-action="motion"]')!.click();
      advance();
      const quietStart = renders;
      for (let i = 0; i < 50; i++) advance();
      expect(renders - quietStart).toBeLessThanOrEqual(4);
      const beforePointer = renders;
      observed!.dispatchEvent(new Event('pointermove'));
      advance();
      expect(renders).toBe(beforePointer + 1);
      court.destroy();
      expect(disconnected).toBe(true);
      expect(nextFrame).toBeUndefined();
    } finally {
      court.destroy();
      if (previousObserver) globalThis.IntersectionObserver = previousObserver;
      else delete (globalThis as any).IntersectionObserver;
      cleanup();
    }
  });
});
