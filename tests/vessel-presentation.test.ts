import { describe, expect, it, spyOn } from 'bun:test';
import { presentVessel, vesselActivity, updateVesselPortrait, nextVesselFreshnessUpdate } from '../src/lib/agents/vessel-presentation';
import { layoutCourtNameplates } from '../src/lib/agents/court-nameplates';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { openPentacleCourt } from '../src/lib/agents/court-view';
import { VesselCardHUD } from '../src/lib/agents/player-card-hud';
import { setupVesselDomGlobals } from './helpers/vessel-dom';

describe('Vessel identity and measured-state presentation', () => {
  it('keeps pending, partial, stale and example metrics distinct, including measured zero balances', () => {
    const payload = structuredClone(FIXTURE_AGENTS[0]);
    expect(presentVessel(payload).sourceLabel).toBe('Example ratings');
    payload.ratingSource = 'live';
    expect(presentVessel(payload).ovr).toBe('—');
    expect(presentVessel(payload).esms).toBeNull();
    expect(presentVessel(payload).surge).toBeNull();
    payload.ratingFeed = { sourceKey: payload.key, receivedAt: 1000, esmsAvailable: false, skyAvailable: true };
    const partial = presentVessel(payload, 1100);
    expect(partial.sourceLabel).toBe('Partial live rating');
    expect(partial.ovr).toBe(String(payload.ovr));
    expect(partial.seals).toBeNull();
    expect(partial.surge).not.toBeNull();
    payload.ratingFeed.esmsAvailable = true;
    payload.esms.spirit = 0;
    expect(presentVessel(payload, 1100).esms!.spirit).toBe(0);
    expect(presentVessel(payload, 1100).status).toBe('current');
    expect(presentVessel(payload, 302000).sourceLabel).toBe('Stale rating');
    expect(presentVessel(payload, 302000).ovr).toBe(String(payload.ovr));
    payload.ratingFeed.skyAvailable = false;
    payload.surge.active = true;
    expect(vesselActivity(payload)).toBe('Holding position');
    expect(vesselActivity(payload, 'victory')).toBe('Celebrating a trick win');
    expect(vesselActivity(payload, 'surge', 'House II')).toBe('Travelling to House II');
  });

  it('keeps failed image fallbacks stable and replaces them on a new portrait', () => {
    const { cleanup } = setupVesselDomGlobals();
    try {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      payload.appearance = { ...presentVessel(payload).appearance, portraitSvgDataUri: undefined, portraitUrl: '/missing-avatar.png' };
      const view = presentVessel(payload);
      const image = document.createElement('img');
      updateVesselPortrait(image, view);
      expect(image.getAttribute('src')).toBe('/missing-avatar.png');
      image.dispatchEvent(new Event('error'));
      expect(image.getAttribute('src')).toBe(view.fallbackPortrait);
      updateVesselPortrait(image, view);
      expect(image.getAttribute('src')).toBe(view.fallbackPortrait);
      payload.appearance = { ...payload.appearance, portraitUrl: '/new-avatar.png' };
      updateVesselPortrait(image, presentVessel(payload));
      expect(image.getAttribute('src')).toBe('/new-avatar.png');
      payload.appearance = { ...payload.appearance, portraitUrl: 'javascript:alert(1)' };
      expect(presentVessel(payload).portrait).toBe(presentVessel(payload).fallbackPortrait);
    } finally { cleanup(); }
  });

  it('shares portrait, full name and unavailable measurements across roster, inspector and card while ratings refresh', () => {
    const { cleanup } = setupVesselDomGlobals();
    const court = openPentacleCourt();
    const hud = new VesselCardHUD();
    try {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      payload.handle = 'Sir Isaac Newton of the Celestial Court';
      payload.ratingSource = 'live';
      const avatar = court.getArena().placeAvatarOnZone(0, payload)!;
      expect(avatar.getObjectByName('VesselIdentityBadge')).toBeUndefined();
      court.getArena().selectAgent(payload.key);
      hud.show(payload);
      const detail = court.getDialog().querySelector('.pk-court-detail')!;
      const roster = court.getDialog().querySelector('.pk-court-agent')!;
      expect(detail.querySelector('h3')!.textContent).toBe(payload.handle);
      expect(roster.querySelector('strong')!.textContent).toBe(payload.handle);
      expect(detail.querySelector('img')!.getAttribute('src')).toBe(roster.querySelector('img')!.getAttribute('src'));
      expect(document.querySelector('.pk-vessel-portrait')!.getAttribute('src')).toBe(detail.querySelector('img')!.getAttribute('src'));
      expect(detail.textContent).toContain('ESMS and seals unavailable');
      expect(document.querySelector('.pk-vessel-card-hud')!.textContent).toContain('Sky reading unavailable');
      expect(detail.querySelectorAll('meter')).toHaveLength(0);
      const updated = { ...payload, ratingFeed: { sourceKey: payload.key, receivedAt: Date.now(), esmsAvailable: true, skyAvailable: true } };
      court.getArena().refreshAvatar(updated);
      court.getDialog().querySelector('input')!.dispatchEvent(new Event('input'));
      hud.refreshAgentPayload(updated);
      expect(detail.querySelectorAll('meter')).toHaveLength(8);
      expect(detail.textContent).toContain('Live rating');
      expect(court.getArena().selection?.agentId).toBe(payload.key);
      expect(court.getDialog().querySelector('.pk-court-agent')).toBe(roster);
    } finally { hud.destroy(); court.destroy(); cleanup(); }
  });

  it('keeps the reader and portrait in place through activity, age and seal updates', () => {
    const { cleanup } = setupVesselDomGlobals();
    const court = openPentacleCourt();
    try {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      payload.appearance = { ...presentVessel(payload).appearance, portraitSvgDataUri: undefined, portraitUrl: '/missing.png' };
      payload.ratingFeed = { sourceKey: payload.key, receivedAt: Date.now(), esmsAvailable: true, skyAvailable: true };
      const avatar = court.getArena().placeAvatarOnZone(0, payload)!;
      court.getArena().selectAgent(payload.key);
      const detail = court.getDialog().querySelector<HTMLElement>('.pk-court-detail')!;
      const portrait = detail.querySelector('img')!;
      portrait.dispatchEvent(new Event('error'));
      const fallback = portrait.getAttribute('src');
      const seal = detail.querySelector('details')!;
      seal.setAttribute('open', '');
      const summary = seal.querySelector<HTMLElement>('summary')!;
      summary.focus();
      const refresh = () => court.getDialog().querySelector('input')!.dispatchEvent(new Event('input'));
      avatar.userData.animationState = 'victory';
      payload.ratingFeed.receivedAt -= 120000;
      refresh();
      expect(detail.querySelector('details')).toBe(seal);
      expect(detail.querySelector('img')).toBe(portrait);
      expect(document.activeElement).toBe(summary);
      expect(detail.textContent).toContain('Celebrating a trick win');
      expect(detail.textContent).toContain('Updated 2m ago');
      const updated = { ...payload, ovr: 95, seals: payload.seals.map((s, i) => i ? s : { ...s, description: 'Updated measured seal effect.' }) };
      court.getArena().refreshAvatar(updated);
      refresh();
      expect(detail.querySelector('img')).toBe(portrait);
      expect(portrait.getAttribute('src')).toBe(fallback);
      const replacement = detail.querySelector('details')!;
      expect(replacement.getAttribute('open')).toBe('');
      expect(replacement.textContent).toContain('Updated measured seal effect.');
      expect(document.activeElement).toBe(replacement.querySelector('summary'));
      court.getArena().refreshAvatar({ ...updated, seals: [] });
      refresh();
      expect(document.activeElement).toBe(detail);
    } finally { court.destroy(); cleanup(); }
  });

  it('preserves expanded card details, scroll and focus through a live refresh', () => {
    const { cleanup } = setupVesselDomGlobals();
    const hud = new VesselCardHUD();
    try {
      hud.setRoster(FIXTURE_AGENTS);
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      hud.show(payload);
      const portrait = document.querySelector('img');
      document.querySelector('details')!.setAttribute('open', '');
      document.querySelector<HTMLElement>('summary')!.focus();
      document.querySelector<HTMLElement>('.pk-vessel-body')!.scrollTop = 140;
      hud.refreshAgentPayload({ ...payload, esms: { ...payload.esms, spirit: 321 } });
      expect(document.querySelector('img')).toBe(portrait);
      expect(document.querySelector('details')!.getAttribute('open')).toBe('');
      expect(document.activeElement).toBe(document.querySelector('summary'));
      expect(document.querySelector<HTMLElement>('.pk-vessel-body')!.scrollTop).toBe(140);
      expect(document.querySelector('.pk-vessel-card-hud')!.textContent).toContain('321');
      hud.show(FIXTURE_AGENTS[1]);
      expect(document.querySelector('details')!.getAttribute('open')).toBeNull();
      const next = document.querySelector<HTMLElement>('#pk_next_agent')!;
      next.focus();
      next.click();
      expect(hud.getCurrentPayload()!.key).toBe(FIXTURE_AGENTS[2].key);
      expect(document.activeElement).toBe(document.querySelector('#pk_next_agent'));
    } finally { hud.destroy(); cleanup(); }
  });

  it('updates a quiet card at freshness boundaries and stops work while hidden or destroyed', () => {
    const { document: doc, cleanup } = setupVesselDomGlobals();
    let now = 1_000_000;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    const pending = new Map<number, () => void>();
    let id = 0;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      pending.set(++id, callback); return id;
    }) as any);
    const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(((key: number) => pending.delete(key)) as any);
    const hud = new VesselCardHUD();
    try {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      payload.ratingFeed = { sourceKey: payload.key, receivedAt: now, esmsAvailable: true, skyAvailable: true };
      hud.show(payload);
      const label = document.querySelector('.pk-vessel-freshness')!;
      const portrait = document.querySelector('img');
      expect(label.textContent).toContain('Updated just now');
      expect(pending.size).toBe(1);
      now += 300001;
      pending.values().next().value!();
      expect(label.textContent).toContain('Stale rating · Updated 5m ago');
      expect(document.querySelector('img')).toBe(portrait);
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(pending.size).toBe(0);
      now += 3_600_000;
      doc.hidden = false;
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(label.textContent).toContain('Updated 1h ago');
      expect(pending.size).toBe(1);
      hud.hide();
      expect(pending.size).toBe(0);
      hud.show(payload);
      hud.destroy();
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(pending.size).toBe(0);
    } finally { hud.destroy(); timer.mockRestore(); clear.mockRestore(); clock.mockRestore(); cleanup(); }
  });

  it('formats long ages, schedules the stale boundary and refreshes a changed derived identity', () => {
    const payload = structuredClone(FIXTURE_AGENTS[0]);
    expect(nextVesselFreshnessUpdate(payload)).toBeNull();
    payload.ratingFeed = { sourceKey: payload.key, receivedAt: 100000, esmsAvailable: true, skyAvailable: true };
    expect(nextVesselFreshnessUpdate(payload, 100000)).toBe(60000);
    expect(nextVesselFreshnessUpdate(payload, 400000)).toBe(1);
    expect(nextVesselFreshnessUpdate(payload, 400001)).toBe(59999);
    expect(presentVessel(payload, 100000 + 86_400_000).snapshotLabel).toBe('Updated 1d ago');
    expect(presentVessel(payload, 100000).snapshotTimestamp).toBe(new Date(100000).toISOString());
    payload.key = 'custom-scholar';
    payload.appearance = undefined;
    const initial = presentVessel(payload).portrait;
    payload.archetype.title = 'Artist';
    const changed = presentVessel(payload).portrait;
    expect(changed).not.toBe(initial);
    expect(changed).toBe(presentVessel(structuredClone(payload)).portrait);
  });
});

describe('Readable nameplate placement', () => {
  it('prioritizes selection, avoids overlaps and reserves space for camera controls', () => {
    const anchors = [
      { key: 'near', x: 160, y: 220, depth: .1, selected: false },
      { key: 'selected', x: 162, y: 220, depth: .8, selected: true },
      { key: 'behind', x: 50, y: 220, depth: 2, selected: false },
      { key: 'offscreen', x: -80, y: 220, depth: .1, selected: true },
    ];
    const result = layoutCourtNameplates(anchors, 320, 390);
    expect(result.map(p => p.key)).toEqual(['selected']);
    expect(result[0].x).toBeGreaterThanOrEqual(12);
    expect(result[0].x + result[0].width).toBeLessThanOrEqual(308);
    expect(result[0].y).toBeGreaterThanOrEqual(112);
    expect(result[0].y + 62).toBeLessThanOrEqual(278);
    expect(layoutCourtNameplates(anchors, 80, 200)).toEqual([]);
  });
});
