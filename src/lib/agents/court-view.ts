import * as THREE from 'three';
import { PentacleArena3D, getZoneTitle } from './pentacle-arena-3d';
import { ArenaNavigation } from './arena-navigation';
import { CourtRenderBudget } from './court-render-budget';
import type { AvatarRenderQuality } from './court-resolution';
import { SpacetimeDBBridge, setGlobalSpacetimeCourtBridge, type CourtTimelineEvent } from './spacetimedb-bridge';
import { ESMS_KEYS, SACRED_STAT_KEYS } from './rating-contract';
import { PLANET_NAMES, accessRefusalReason } from '../../alchm-chart/zone-access.js';
import { FACTION_HEX_COLORS } from './avatar-foot-ring';
import { presentVessel, vesselActivity, updateVesselPortrait, formatVesselBalance } from './vessel-presentation';
import { layoutCourtNameplates, type NameplateAnchor } from './court-nameplates';
import { VesselDetailRegions } from './vessel-detail-regions';
import './court-view.css';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function formatCourtTimeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export const EXAMPLE_TIMELINE_EVENTS: CourtTimelineEvent[] = [
  {
    id: 'example-evt-1',
    type: 'contest',
    timestamp: Date.now() - 14000,
    zoneId: 10,
    agentKey: 'leonardo-da-vinci',
    agentHandle: 'Leonardo da Vinci',
    faction: 7,
    rivalKey: 'isaac-newton',
    rivalHandle: 'Isaac Newton',
    rivalFaction: 6,
    summary: 'Leonardo da Vinci defending Crown against Isaac Newton',
    detail: 'Equilibrium Surge active (+12% momentum) with Celestial seal tier',
  },
  {
    id: 'example-evt-2',
    type: 'contest',
    timestamp: Date.now() - 42000,
    zoneId: 0,
    agentKey: 'isaac-newton',
    agentHandle: 'Isaac Newton',
    faction: 6,
    rivalKey: 'neo',
    rivalHandle: 'Neo',
    rivalFaction: 0,
    summary: 'Isaac Newton contesting House of Aries',
    detail: 'Challenged territory control in round 2 with 78 OVR momentum',
  },
  {
    id: 'example-evt-3',
    type: 'arrival',
    timestamp: Date.now() - 85000,
    zoneId: 2,
    agentKey: 'hypatia',
    agentHandle: 'Hypatia',
    faction: 5,
    targetZoneId: 2,
    summary: 'Hypatia arrived at House of Gemini',
    detail: 'Took owner position in House 2 with Astral seal tier',
  },
  {
    id: 'example-evt-4',
    type: 'contest',
    timestamp: Date.now() - 130000,
    zoneId: 6,
    agentKey: 'emily-dickinson',
    agentHandle: 'Emily Dickinson',
    faction: 3,
    summary: 'Emily Dickinson igniting Tempest Surge in Spire 1',
    detail: 'Surge meter 100% — Tempest resonance bonus (+18%) active on Spires',
  },
];

export interface CourtViewOptions {
  client?: any;
  faction?: number | null;
  zoneId?: number | null;
  onClose?: () => void;
}

/** Read-only map inspection. Example vessels are always an explicit opt-in. */
export function openPentacleCourt(options: CourtViewOptions = {}) {
  const returnFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'pk-court';
  dialog.setAttribute('aria-labelledby', 'pk-court-title');
  dialog.innerHTML = `
    <header class="pk-court-header">
      <div class="pk-court-brand"><span aria-hidden="true">✧</span><div><p>PENTACLES / THE ELEVEN ZONES</p><h1 id="pk-court-title">The Agent Court</h1></div></div>
      <div class="pk-court-header-actions">
        <div class="pk-court-modes" role="group" aria-label="Court data source"><button type="button" data-mode="live" aria-pressed="true">Live court</button><button type="button" data-mode="examples" aria-pressed="false">Example vessels</button></div>
        <button type="button" data-action="close" autofocus>Back to sky <span aria-hidden="true">↗</span></button>
      </div>
    </header>
    <div class="pk-court-body">
      <section class="pk-court-map" aria-label="3D Pentacle court">
        <div class="pk-court-stage"></div>
        <div class="pk-court-labels"></div>
        <div class="pk-court-nameplates" aria-label="Vessels in the scene"></div>
        <div class="pk-court-map-heading"><span class="pk-court-status" role="status"></span><p class="pk-court-source-note"></p><button type="button" class="pk-court-inspect-selection" data-action="inspect" hidden>Inspect selection</button></div>
        <div class="pk-court-fallback" hidden><strong>3D rendering is unavailable</strong><p>You can still browse zones and agents in the inspector.</p></div>
        <div class="pk-court-navigation" role="group" aria-label="Camera controls">
          <button type="button" data-action="overview">Overview</button><button type="button" data-action="top">Top view</button>
          <button type="button" data-action="in" aria-label="Zoom in">＋</button><button type="button" data-action="out" aria-label="Zoom out">−</button>
          <button type="button" data-action="motion" aria-pressed="true">Motion on</button>
          <button type="button" data-action="quality" aria-label="Sharper avatar rendering" aria-pressed="true">Sharp</button>
          <button type="button" data-action="spectate" aria-pressed="false" class="pk-court-spectate-btn">Follow action</button>
        </div>
        <p class="pk-court-help">Drag to orbit · Scroll or pinch to zoom · Select a vessel to inspect</p>
      </section>
      <aside class="pk-court-inspector" aria-label="Court inspector">
        <div class="pk-court-inspector-heading"><p class="pk-court-eyebrow">EXPLORE THE COURT</p><h2>Vessels & territories</h2><p>Follow the agents shaping the Pentacle.</p></div>
        <label class="pk-court-field">Territory<select aria-label="Territory"><option value="all">All eleven zones</option>${Array.from({ length: 11 }, (_, i) => `<option value="${i}">${getZoneTitle(i)}</option>`).join('')}</select></label>
        <section class="pk-court-detail" aria-label="Selection details" tabindex="-1"></section>
        <button type="button" class="pk-court-focus" data-action="focus" disabled>Focus selected model</button>
        <div class="pk-court-timeline-heading"><h3>Arrival & contest timeline</h3><span class="pk-court-timeline-count"></span></div>
        <div class="pk-court-timeline-categories" role="group" aria-label="Timeline category filter">
          <button type="button" data-timeline-category="all" class="pk-court-timeline-filter" aria-pressed="true">All</button>
          <button type="button" data-timeline-category="contest" class="pk-court-timeline-filter" aria-pressed="false">Contests</button>
          <button type="button" data-timeline-category="arrival" class="pk-court-timeline-filter" aria-pressed="false">Arrivals</button>
          <button type="button" data-timeline-category="rating" class="pk-court-timeline-filter" aria-pressed="false">Ratings</button>
        </div>
        <div class="pk-court-timeline" role="feed" aria-label="Arrival and contest events"></div><p class="pk-court-timeline-empty"></p>
        <div class="pk-court-roster-heading"><h3>Agents on the map</h3><span class="pk-court-count"></span></div>
        <label class="pk-court-field"><span class="pk-court-sr-only">Search agents</span><input type="search" placeholder="Search name or faction…" aria-label="Search agents" /></label>
        <div class="pk-court-roster"></div><p class="pk-court-empty"></p>
      </aside>
    </div>`;
  document.body.appendChild(dialog);
  const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const stage = get<HTMLDivElement>('.pk-court-stage');
  const territory = get<HTMLSelectElement>('select');
  const search = get<HTMLInputElement>('input');
  const detail = get('.pk-court-detail');
  const roster = get('.pk-court-roster');
  const timelineHost = get<HTMLDivElement>('.pk-court-timeline');
  const timelineCount = get<HTMLSpanElement>('.pk-court-timeline-count');
  const timelineEmpty = get<HTMLParagraphElement>('.pk-court-timeline-empty');
  const focusButton = get<HTMLButtonElement>('[data-action="focus"]');
  const inspectButton = get<HTMLButtonElement>('[data-action="inspect"]');
  const motionButton = get<HTMLButtonElement>('[data-action="motion"]');
  const labelsHost = get('.pk-court-labels');
  const nameplatesHost = get('.pk-court-nameplates');
  const nameplates = new Map<string, HTMLButtonElement>();
  const projected = new THREE.Vector3();
  const rosterButtons = new Map<string, HTMLButtonElement>();
  const timelineItems = new Map<string, { button: HTMLButtonElement; event: CourtTimelineEvent; markup: string }>();
  const labels = new Map<number, HTMLButtonElement>();
  const receivedZones = new Set<number>();
  const renderBudget = new CourtRenderBudget();
  const invalidateRender = () => renderBudget.invalidate();
  let stageVisible = true;
  let mode: 'live' | 'examples' = 'live';
  let timelineCategory: 'all' | 'contest' | 'arrival' | 'rating' = 'all';
  let arena: PentacleArena3D;
  let navigation: ArenaNavigation | undefined;
  let bridge: SpacetimeDBBridge;
  let disposed = false;
  let rebuilding = false;
  let motion = !(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
  let followAction = false;
  let quality: AvatarRenderQuality = 'sharp';
  let detailSignature = '';
  let frame = 0;
  let lastTime = performance.now();
  let lastRefresh = 0;

  const select = () => {
    if (disposed || rebuilding) return;
    // Keep the roster's territory filter independent of selection: users can
    // inspect adjacent agents without losing their place in the full roster.
    invalidateRender();
    refresh();
  };
  const showDetails = () => {
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({ block: 'start' });
  };
  const vesselDetails = new VesselDetailRegions(detail);
  const setDetail = (html: string) => {
    vesselDetails.reset();
    if (html !== detailSignature) { detail.innerHTML = html; detailSignature = html; }
  };

  function refresh() {
    if (!arena || disposed || rebuilding) return;
    const connected = options.client?.isLive === true;
    const applied = typeof options.client?.isApplied === 'function' && options.client.isApplied('zone');
    const status = mode === 'examples' ? 'EXAMPLE COURT' : !connected ? 'OFFLINE' : applied ? 'LIVE COURT' : 'SYNCING COURT';
    get('.pk-court-status').textContent = status;
    get('.pk-court-source-note').textContent = mode === 'examples'
      ? 'Four reference vessels · Sample ownership and ratings'
      : !connected ? 'Waiting for connection · Any visible state is the last received snapshot'
      : 'Territories and seated agents from the shared map';
    const selected = arena.selection;
    const agent = selected?.agentId ? arena.avatarRegistry.get(selected.agentId) : undefined;
    const zone = selected ? arena.zones.get(selected.zoneId) : undefined;
    inspectButton.hidden = !selected;
    const inspectLabel = `Inspect ${agent?.payload.handle ?? zone?.name ?? 'selection'} →`;
    if (inspectButton.textContent !== inspectLabel) inspectButton.textContent = inspectLabel;
    focusButton.disabled = !selected || !arena.webglAvailable;
    focusButton.textContent = agent ? 'Focus selected model ↗' : 'Focus selected territory ↗';
    if (agent && zone) {
      const p = agent.payload;
      const view = presentVessel(p);
      const activity = vesselActivity(p, agent.group.userData.animationState,
        agent.targetZoneId === undefined ? undefined : getZoneTitle(agent.targetZoneId));
      const sourceNote = `${view.sourceLabel} · ${view.snapshotLabel}${p.isPlaceholder ? ' · Provisional natal chart' : ''}`;
      const likeness = agent.group.userData.externalModel ? 'Authored likeness' : agent.group.userData.modelError
        ? 'Procedural likeness · custom model unavailable' : 'Procedural likeness';
      detailSignature = '';
      vesselDetails.update(p.key, [`<div class="pk-court-agent-identity"><img class="pk-court-portrait" width="76" height="76" alt="" /><div><p class="pk-court-eyebrow">${escape(p.factionName)} · ${escape(agent.slot === 'spectator' ? 'Seated agent' : agent.slot)}</p><h3>${escape(view.name)}</h3><p>${escape(view.archetype)}</p></div><strong class="pk-court-ovr">${view.ovr}<small>OVR</small></strong></div>`,
        `<div class="pk-court-presence"><span class="pk-court-source-pill" data-rating-status="${view.status}">${escape(view.sourceLabel)}</span><time datetime="${escape(view.snapshotTimestamp)}" title="${escape(view.snapshotTimestamp)}">${escape(view.snapshotLabel)}</time></div>`,
        `<p class="pk-court-activity">${escape(activity)}</p>`,
        `<div class="pk-court-location"><span>${escape(zone.name)}</span><span>${escape(likeness)}</span></div>`,
        `<p class="pk-court-notice" title="${escape(sourceNote)}">${view.status === 'stale' ? 'Waiting for a newer snapshot. Displayed metrics are the last received values.' : p.isPlaceholder ? 'Provisional natal chart' : 'Identity and readings from the current court snapshot.'}</p>`,
        `<section class="pk-court-metric-section"><h4>Sacred seven <span>25–99</span></h4>${!view.available ? '<p class="pk-court-notice">Ratings have not been supplied.</p>' : `<div class="pk-court-stats">${SACRED_STAT_KEYS.map(key => `<div><span>${escape(key)}</span><meter min="25" max="99" value="${p.ratings[key]}" aria-label="${key}"></meter><b>${p.ratings[key]}</b></div>`).join('')}</div>`}</section>`,
        `<section class="pk-court-metric-section"><h4>Elemental balances <span>ESMS</span></h4>${view.esms ? `<dl class="pk-court-esms">${ESMS_KEYS.map(key => `<div data-element="${key}"><dt>${key}</dt><dd>${formatVesselBalance(view.esms![key])}</dd></div>`).join('')}</dl>` : '<p class="pk-court-notice">ESMS and seals unavailable · No measured ledger reading.</p>'}</section>`,
        `<section class="pk-court-metric-section"><h4>Resonance surge <span>${view.surge ? `${Math.round(view.surge.meter)}%` : '—'}</span></h4>${view.surge ? `<meter min="0" max="100" value="${view.surge.meter}" aria-label="Resonance surge"></meter><p class="pk-court-notice">${escape(view.surge.surgeType)} · ${view.surge.active ? 'Active' : 'Building resonance'}</p>` : '<p class="pk-court-notice">Sky reading unavailable</p>'}</section>`,
        `<section class="pk-court-metric-section"><h4>Alchemical seals <span>${view.seals?.length ?? '—'}</span></h4>${view.seals ? `<ul class="pk-court-seals">${view.seals.map(seal => `<li><details data-seal-id="${escape(seal.id)}"><summary><span data-tier="${escape(seal.tier)}">${escape(seal.tier)}</span> <span>${escape(seal.name)}</span></summary><p>${escape(seal.description)}</p><small>${escape(seal.category)}${seal.statKey ? ` · ${escape(seal.statKey)}` : ''} · Tier ×${seal.multiplier}</small></details></li>`).join('') || '<li>No seals earned in this snapshot.</li>'}</ul>` : '<p class="pk-court-notice">Awaiting measured seals</p>'}</section>`,
        `<div class="pk-court-relic"><span>Signature relic</span><strong>${escape(view.relic)}</strong></div>`]);
      updateVesselPortrait(detail.querySelector<HTMLImageElement>('img')!, view);
    } else if (zone && mode === 'live' && !receivedZones.has(zone.zoneId)) {
      setDetail(`<p class="pk-court-eyebrow">${zone.kind.toUpperCase()} / TERRITORY ${zone.zoneId + 1}</p><h3>${escape(zone.name)}</h3><p>Awaiting territory data.</p><p class="pk-court-notice">Ownership, control and faction access will appear when this territory’s snapshot arrives.</p>`);
    } else if (zone) {
      const count = [...arena.avatarRegistry.values()].filter(a => a.zoneId === zone.zoneId).length;
      const access = options.faction != null ? accessRefusalReason(zone.zoneId, options.faction, arena.getZoneOwners())
        : zone.kind === 'house' ? 'Houses are open to every faction.' : zone.kind === 'spire' ? 'Hold an adjacent House to access this Spire.' : 'Hold two Spires to access the Crown.';
      setDetail(`<p class="pk-court-eyebrow">${zone.kind.toUpperCase()} / TERRITORY ${zone.zoneId + 1}</p><h3>${escape(zone.name)}</h3>
        <p>${zone.owner == null ? 'Unclaimed' : `${PLANET_NAMES[zone.owner]} ownership`} · ${count} ${count === 1 ? 'agent' : 'agents'} present</p>
        <div class="pk-court-control"><span>Control strength</span><strong>${Math.round(Math.abs(zone.control) / 10)}%</strong></div><meter min="0" max="1000" value="${Math.abs(zone.control)}" aria-label="Territory control strength"></meter>
        <p class="pk-court-activity">${zone.inFlux ? `In flux · ${Math.round(zone.fluxLevel / 10)}%` : 'Stable territory'}</p><p class="pk-court-notice">${escape(access ?? 'Accessible to your faction.')}</p>`);
    } else {
      setDetail('<p class="pk-court-eyebrow">A LIVING CONSTELLATION</p><h3>Choose your perspective.</h3><p>Select a named territory or a vessel to explore its identity, presence and place in the war.</p><div class="pk-court-legend"><span>5 Houses</span><span>5 Spires</span><span>1 Crown</span></div>');
    }
    const query = search.value.trim().toLocaleLowerCase();
    const agents = [...arena.avatarRegistry.values()].sort((a, b) => a.payload.handle.localeCompare(b.payload.handle));
    const keys = new Set(agents.map(a => a.payload.key));
    for (const [key, button] of rosterButtons) if (!keys.has(key)) { button.remove(); rosterButtons.delete(key); }
    for (const [key, button] of nameplates) if (!keys.has(key)) { button.remove(); nameplates.delete(key); }
    let visible = 0;
    for (const registration of agents) {
      const p = registration.payload;
      const view = presentVessel(p);
      const activity = vesselActivity(p, registration.group.userData.animationState,
        registration.targetZoneId === undefined ? undefined : getZoneTitle(registration.targetZoneId));
      let button = rosterButtons.get(p.key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'pk-court-agent';
        button.innerHTML = '<img class="pk-court-roster-portrait" width="38" height="38" alt="" /><span><strong></strong><small></small><em></em></span><b></b>';
        button.addEventListener('click', () => {
          arena.selectAgent(p.key);
          navigation?.focusSelection();
          showDetails();
        });
        rosterButtons.set(p.key, button);
        roster.appendChild(button);
      }
      button.hidden = !(territory.value === 'all' || registration.zoneId === Number(territory.value)) ||
        !`${p.handle} ${p.factionName}`.toLocaleLowerCase().includes(query);
      if (!button.hidden) visible++;
      button.setAttribute('aria-pressed', String(selected?.agentId === p.key));
      button.style.setProperty('--agent-color', FACTION_HEX_COLORS[p.faction] || '#d8b46a');
      button.querySelector('strong')!.textContent = p.handle;
      button.querySelector('small')!.textContent = `${p.factionName} · ${getZoneTitle(registration.zoneId)}`;
      button.querySelector('b')!.textContent = view.ovr;
      button.querySelector('em')!.textContent = view.sourceLabel;
      button.querySelector('em')!.setAttribute('data-rating-status', view.status);
      updateVesselPortrait(button.querySelector<HTMLImageElement>('img')!, view);
      if (arena.webglAvailable) {
        let plate = nameplates.get(p.key);
        if (!plate) {
          plate = document.createElement('button'); plate.type = 'button';
          plate.className = 'pk-court-nameplate';
          plate.hidden = true;
          plate.innerHTML = '<img width="36" height="36" alt="" /><span><strong></strong><small></small></span><b></b>';
          plate.addEventListener('click', () => { arena.selectAgent(p.key); navigation?.focusSelection(); showDetails(); });
          nameplates.set(p.key, plate); nameplatesHost.appendChild(plate);
        }
        plate.setAttribute('aria-pressed', String(selected?.agentId === p.key));
        plate.setAttribute('aria-label', `Inspect ${view.name} · ${view.ovr} OVR · ${view.sourceLabel} · ${activity}`);
        plate.setAttribute('title', `${view.name} · ${view.sourceLabel} · ${activity}`);
        plate.setAttribute('data-rating-status', view.status);
        plate.style.setProperty('--agent-color', FACTION_HEX_COLORS[p.faction] || '#d8b46a');
        plate.querySelector('strong')!.textContent = view.name;
        plate.querySelector('small')!.textContent = `${view.sourceLabel} · ${activity}`;
        plate.querySelector('b')!.textContent = view.ovr;
        updateVesselPortrait(plate.querySelector<HTMLImageElement>('img')!, view);
      }
    }
    get('.pk-court-count').textContent = `${visible} / ${agents.length}`;
    get('.pk-court-empty').textContent = visible ? '' : agents.length ? 'No agents match this territory or search.'
      : mode === 'live' ? 'No seated agents received. Explore the territories, or choose Example vessels to preview the models.' : 'No vessels to display.';

    const rawTimeline: CourtTimelineEvent[] = mode === 'examples' ? EXAMPLE_TIMELINE_EVENTS : bridge.getTimeline();
    const visibleEvents = rawTimeline.filter(evt => {
      const matchesTerritory = territory.value === 'all' || evt.zoneId === Number(territory.value);
      const matchesCategory = timelineCategory === 'all' || evt.type === timelineCategory;
      const matchesQuery = !query || `${evt.summary} ${evt.detail ?? ''} ${evt.agentHandle} ${getZoneTitle(evt.zoneId)}`.toLocaleLowerCase().includes(query);
      return matchesTerritory && matchesCategory && matchesQuery;
    });
    timelineCount.textContent = `${visibleEvents.length} / ${rawTimeline.length}`;
    timelineEmpty.textContent = visibleEvents.length ? '' : rawTimeline.length ? 'No events match this territory or search.'
      : mode === 'live' ? 'No recent arrivals or contests. Events will stream in live as agents clash.' : 'No events to display.';
    const focusedEvent = timelineHost.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const visibleIds = new Set(visibleEvents.map(evt => evt.id));
    for (const [id, entry] of timelineItems) {
      if (!visibleIds.has(id)) { entry.button.remove(); timelineItems.delete(id); }
    }
    for (const [index, evt] of visibleEvents.entries()) {
      let entry = timelineItems.get(evt.id);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pk-court-timeline-item';
        button.setAttribute('data-event-id', evt.id);
        entry = { button, event: evt, markup: '' };
        timelineItems.set(evt.id, entry);
        const current = entry;
        button.addEventListener('click', () => {
          const event = current.event;
          if (arena.avatarRegistry.has(event.agentKey)) arena.selectAgent(event.agentKey);
          else arena.selectZone(event.zoneId);
          navigation?.focusSelection();
          showDetails();
        });
      }
      entry.event = evt;
      const item = entry.button;
      const isSelected = selected?.agentId ? selected.agentId === evt.agentKey : selected?.zoneId === evt.zoneId;
      item.setAttribute('aria-pressed', String(isSelected));
      item.style.setProperty('--agent-color', FACTION_HEX_COLORS[evt.faction] || '#d8b46a');
      const markup = `
        <div class="pk-court-timeline-meta">
          <span class="pk-court-badge pk-badge-${escape(evt.type)}">${escape(evt.type.toUpperCase())}</span>
          <span class="pk-court-timeline-zone">${escape(getZoneTitle(evt.zoneId))}</span>
          <time>${escape(formatCourtTimeAgo(evt.timestamp))}</time>
        </div>
        <p class="pk-court-timeline-summary"><span class="pk-court-agent-dot" aria-hidden="true"></span>${escape(evt.summary)}</p>
        ${evt.detail ? `<small class="pk-court-timeline-detail">${escape(evt.detail)}</small>` : ''}
      `;
      if (entry.markup !== markup) { item.innerHTML = markup; entry.markup = markup; }
      const next = timelineHost.children[index] ?? null;
      if (next !== item) timelineHost.insertBefore(item, next);
    }
    if (focusedEvent) {
      if (focusedEvent.isConnected) {
        if (document.activeElement !== focusedEvent) focusedEvent.focus({ preventScroll: true });
      } else {
        get<HTMLButtonElement>('[data-timeline-category][aria-pressed="true"]').focus({ preventScroll: true });
      }
    }

    for (const [id, label] of labels) {
      label.setAttribute('aria-pressed', String(selected?.zoneId === id));
      label.style.setProperty('--zone-color', FACTION_HEX_COLORS[arena.zones.get(id)!.owner ?? -1] || '#71839d');
    }
  }

  function buildScene() {
    rebuilding = true;
    bridge?.disconnect();
    bridge?.detachArena();
    navigation?.destroy();
    arena?.destroy();
    roster.replaceChildren();
    rosterButtons.clear();
    timelineHost.replaceChildren();
    timelineItems.clear();
    labelsHost.replaceChildren();
    labels.clear();
    nameplatesHost.replaceChildren();
    nameplates.clear();
    receivedZones.clear();
    territory.value = 'all';
    arena = new PentacleArena3D({ container: stage, showIdentityBadges: false, renderQuality: quality, onSelectAgent: select, onSelectZone: select });
    navigation = arena.webglAvailable ? new ArenaNavigation(arena) : undefined;
    navigation?.controls.addEventListener('change', invalidateRender);
    bridge = new SpacetimeDBBridge();
    bridge.attachArena(arena);
    setGlobalSpacetimeCourtBridge(bridge);
    if (typeof window !== 'undefined') (window as any).__pentacleArena = arena;
    bridge.onZoneUpdate(row => { receivedZones.add(row.zoneId); invalidateRender(); });
    bridge.onTimelineEvent(evt => {
      if (!disposed && !rebuilding) {
        invalidateRender();
        if (followAction && (evt.type === 'contest' || evt.type === 'arrival')) {
          if (arena.avatarRegistry.has(evt.agentKey)) {
            arena.selectAgent(evt.agentKey);
          } else {
            arena.selectZone(evt.zoneId);
          }
          navigation?.focusSelection();
        }
        refresh();
      }
    });
    if (mode === 'examples') arena.loadFixtures();
    else if (options.client) bridge.connect(options.client);
    get('.pk-court-fallback').hidden = arena.webglAvailable;
    for (const action of ['overview', 'top', 'in', 'out', 'spectate']) {
      const btn = get<HTMLButtonElement>(`[data-action="${action}"]`);
      if (btn) btn.disabled = !arena.webglAvailable;
    }
    if (arena.webglAvailable) {
      for (const [id, zone] of arena.zones) {
        const label = document.createElement('button');
        label.type = 'button';
        label.textContent = zone.kind === 'crown' ? 'Crown' : zone.name;
        label.setAttribute('aria-label', `Inspect ${zone.name}`);
        label.addEventListener('click', () => { territory.value = String(id); arena.selectZone(id); showDetails(); });
        labels.set(id, label);
        labelsHost.appendChild(label);
      }
    }
    rebuilding = false;
    if (options.zoneId != null) arena.selectZone(options.zoneId);
    refresh();
    resize();
  }

  function resize() {
    arena?.resize(stage.clientWidth, stage.clientHeight);
    navigation?.resize();
    invalidateRender();
  }
  function updateMotion() {
    invalidateRender();
    motionButton.textContent = motion ? 'Motion on' : 'Motion off';
    motionButton.setAttribute('aria-pressed', String(motion));
  }
  function animate(now: number) {
    if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (!document.hidden) {
      arena.motionEnabled = motion;
      arena.update(dt);
      navigation?.update();
      if (renderBudget.shouldRender(now, motion, stageVisible)) {
        arena.renderer.render(arena.scene, arena.camera);

        const anchors: NameplateAnchor[] = [];
        for (const [key, registration] of arena.avatarRegistry) {
          projected.set(0, 3, 0).applyMatrix4(registration.group.matrixWorld).project(arena.camera);
          anchors.push({ key, x: (projected.x + 1) * stage.clientWidth / 2,
            y: (1 - projected.y) * stage.clientHeight / 2, depth: projected.z, selected: arena.selection?.agentId === key });
        }
        const placements = new Map(layoutCourtNameplates(anchors, stage.clientWidth, stage.clientHeight).map(placement => [placement.key, placement]));
        for (const [key, plate] of nameplates) {
          const placement = placements.get(key);
          plate.hidden = !placement;
          if (placement) {
            plate.style.left = `${placement.x}px`; plate.style.top = `${placement.y}px`;
            plate.style.width = `${placement.width}px`;
          }
        }
        for (const [id, label] of labels) {
          projected.copy(arena.zones.get(id)!.position).project(arena.camera);
          label.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 0.96 || Math.abs(projected.y) > 0.87;
          label.style.left = `${(projected.x + 1) * 50}%`;
          label.style.top = `${(1 - projected.y) * 50}%`;
        }
      }
      if (now - lastRefresh > 300) { refresh(); lastRefresh = now; }
    }
    frame = requestAnimationFrame(animate);
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    visibilityObserver?.disconnect();
    for (const event of ['pointermove', 'pointerleave', 'pointerdown']) stage.removeEventListener(event, invalidateRender);
    bridge.disconnect();
    bridge.detachArena();
    setGlobalSpacetimeCourtBridge(null);
    if (typeof window !== 'undefined' && (window as any).__pentacleArena === arena) {
      delete (window as any).__pentacleArena;
    }
    navigation?.destroy();
    arena.destroy();
    dialog.close();
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
    options.onClose?.();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); destroy(); });
  dialog.addEventListener('close', destroy);
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const nextMode = button.dataset.mode;
    if (nextMode && nextMode !== mode) {
      mode = nextMode as typeof mode;
      for (const el of dialog.querySelectorAll<HTMLButtonElement>('[data-mode]')) el.setAttribute('aria-pressed', String(el.dataset.mode === mode));
      buildScene();
    }
    const nextCategory = button.dataset.timelineCategory;
    if (nextCategory && nextCategory !== timelineCategory) {
      timelineCategory = nextCategory as typeof timelineCategory;
      for (const el of dialog.querySelectorAll<HTMLButtonElement>('[data-timeline-category]')) {
        el.setAttribute('aria-pressed', String(el.dataset.timelineCategory === timelineCategory));
      }
      refresh();
    }
    switch (button.dataset.action) {
      case 'close': destroy(); break;
      case 'overview': navigation?.overview(); break;
      case 'top': navigation?.overview(true); break;
      case 'in': navigation?.zoom(0.8); break;
      case 'out': navigation?.zoom(1.25); break;
      case 'inspect': showDetails(); break;
      case 'focus':
        navigation?.focusSelection();
        get('.pk-court-body').scrollTop = 0;
        inspectButton.focus({ preventScroll: true });
        break;
      case 'motion': motion = !motion; updateMotion(); break;
      case 'quality': {
        quality = quality === 'sharp' ? 'balanced' : 'sharp';
        const button = get<HTMLButtonElement>('[data-action="quality"]');
        button.textContent = quality === 'sharp' ? 'Sharp' : 'Balanced';
        button.setAttribute('aria-pressed', String(quality === 'sharp'));
        arena.setRenderQuality(quality); invalidateRender();
        break;
      }
      case 'spectate': {
        followAction = !followAction;
        const spectateBtn = get<HTMLButtonElement>('[data-action="spectate"]');
        spectateBtn.setAttribute('aria-pressed', String(followAction));
        spectateBtn.textContent = followAction ? 'Following live' : 'Follow action';
        if (followAction && navigation) {
          const latestContest = (mode === 'examples' ? EXAMPLE_TIMELINE_EVENTS : bridge.getTimeline())
            .find(e => e.type === 'contest' || e.type === 'arrival');
          if (latestContest) {
            if (arena.avatarRegistry.has(latestContest.agentKey)) arena.selectAgent(latestContest.agentKey);
            else arena.selectZone(latestContest.zoneId);
            navigation.focusSelection();
            refresh();
          }
        }
        break;
      }
    }
  });
  territory.addEventListener('change', () => {
    if (territory.value === 'all') arena.clearSelection(); else arena.selectZone(Number(territory.value));
    refresh();
    if (territory.value !== 'all') showDetails();
  });
  search.addEventListener('input', refresh);
  const observer = new ResizeObserver(resize);
  const visibilityObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === stage);
      if (!entry) return;
      stageVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (stageVisible) invalidateRender();
    }) : undefined;
  for (const event of ['pointermove', 'pointerleave', 'pointerdown']) stage.addEventListener(event, invalidateRender);
  try {
    dialog.showModal();
    buildScene();
    observer.observe(stage);
    visibilityObserver?.observe(stage);
    updateMotion();
    frame = requestAnimationFrame(animate);
  } catch (error) {
    disposed = true;
    observer.disconnect();
    visibilityObserver?.disconnect();
    for (const event of ['pointermove', 'pointerleave', 'pointerdown']) stage.removeEventListener(event, invalidateRender);
    bridge?.disconnect();
    bridge?.detachArena();
    navigation?.destroy();
    arena?.destroy();
    dialog.remove();
    returnFocus?.focus();
    throw error;
  }
  return {
    destroy,
    isFollowingLive: () => followAction,
    setFollowingLive: (following: boolean) => {
      followAction = following;
      const btn = dialog.querySelector<HTMLButtonElement>('[data-action="spectate"]');
      if (btn) {
        btn.setAttribute('aria-pressed', String(followAction));
        btn.textContent = followAction ? 'Following live' : 'Follow action';
      }
      if (followAction && navigation) {
        const latestContest = (mode === 'examples' ? EXAMPLE_TIMELINE_EVENTS : bridge.getTimeline())
          .find(e => e.type === 'contest' || e.type === 'arrival');
        if (latestContest) {
          if (arena.avatarRegistry.has(latestContest.agentKey)) arena.selectAgent(latestContest.agentKey);
          else arena.selectZone(latestContest.zoneId);
          navigation.focusSelection();
          refresh();
        }
      }
    },
    getBridge: () => bridge,
    getArena: () => arena,
    getDialog: () => dialog,
  };
}
