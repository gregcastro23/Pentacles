import { BoardAvatarLayer } from '../../src/lib/agents/board-avatar-layer';

import { HISTORICAL_AGENTS } from '../../src/alchm-chart/historical-agents.js';
import type { BoardTables } from '../../src/lib/agents/board-participants';
import catalog from '../../src/lib/agents/historical-vessel-catalog.json';
import { SACRED_STAT_KEYS, ESMS_KEYS } from '../../src/lib/agents/rating-contract';

const host = document.querySelector<HTMLElement>('#sky-map-wrapper')!;
const initial = (): BoardTables => {
  // Multiple historical participants per table, with unrelated/neutral ownership.
  // Exercise coats, robes, dresses and armor rather than only the registry's first era.
  const showcase = ['nikola-tesla-1856', 'albert-einstein', 'charles-darwin-1809', 'william-shakespeare', 'edgar-allan-poe-1809', 'vincent-van-gogh-1853',
    'joan-of-arc', 'alexander-the-great', 'marcus-aurelius', 'isaac-newton', 'lewis-carroll', 'jane-austen',
    'cleopatra', 'siddhartha-gautama-buddha', 'frida-kahlo', 'marie-curie-1867', 'emily-dickinson', 'thomas-aquinas',
    'leonardo-da-vinci', 'socrates', 'plato', 'aristotle', 'galileo-galilei', 'dante-alighieri'];
  const agents = showcase.map(key => HISTORICAL_AGENTS.find(agent => agent.key === key)!);
  const zones = [0, 2, 5, 10];
  return {
    melee_table: zones.map((zone_id, i) => ({ table_id: i + 1, zone_id, state: 'Seated' })),
    melee_seat: agents.map((a, i) => ({ seat_id: i + 1, table_id: Math.floor(i / 6) + 1,
      occupant: `fixture-npc-${i}`, faction: a.faction, is_human: false, score: i * 5 })),
    agent_chart: agents.map((a, i) => ({ identity: `fixture-npc-${i}`, handle: a.handle })),
    agent_rating: [],
  };
};
let tables = initial();
const listeners = new Map<string, (rows: any[]) => void>();
let status = () => {};
const client = { isLive: true, conn: {}, isApplied: () => true,
  onStatus(callback: () => void) { status = callback; callback(); return () => { status = () => {}; }; },
  subscribe(table: keyof BoardTables, callback: (rows: any[]) => void) {
    listeners.set(table, callback); callback(tables[table]); return () => listeners.delete(table);
  },
};
const layer = new BoardAvatarLayer(host, client);
const emit = () => { for (const [table, listener] of listeners) listener(tables[table as keyof BoardTables]); };
const ratingScenario = document.createElement('select');
ratingScenario.setAttribute('aria-label', 'Synthetic rating scenario');
ratingScenario.innerHTML = '<option value="pending">Catalog fallback</option><option value="complete">Synthetic live rating</option><option value="partial">Synthetic partial rating</option>';
document.querySelector('.fixture-tools')!.append(ratingScenario);
ratingScenario.addEventListener('change', () => {
  tables.agent_rating = ratingScenario.value === 'pending' ? [] : tables.agent_chart.map(chart => {
    const agent = HISTORICAL_AGENTS.find(a => a.handle === chart.handle)!;
    const baseline = catalog.agents[agent.key as keyof typeof catalog.agents];
    const complete = ratingScenario.value === 'complete';
    return { identity: chart.identity, agent_key: agent.key, observed_at_ms: Date.now(), snapshot_json: JSON.stringify({
      version: 1, sourceKey: agent.key, chartPlaceholder: baseline.chartPlaceholder,
      ratings: SACRED_STAT_KEYS.map(key => Math.min(99, baseline.ratings[key] + 2)),
      esms: ESMS_KEYS.map(() => 0), esmsSource: complete ? 'database' : 'unavailable', seals: [],
      surge: complete ? { meter: 42, active: false, surgeType: 'inferno', monica: null, monicaState: 'absent', heat: .4, reactivity: .2, statBoosts: {} } : null,
    }) };
  }); emit();
});
const yaw = document.querySelector<HTMLInputElement>('#yaw')!, pitch = document.querySelector<HTMLInputElement>('#pitch')!, zoom = document.querySelector<HTMLInputElement>('#zoom')!;
const project = (alt: number, az: number) => (window as any).project3D(alt, az, Number(pitch.value), Number(yaw.value), Number(zoom.value));
const tips = Array.from({ length: 5 }, (_, i) => [Math.sin(i * Math.PI * 2 / 5), Math.cos(i * Math.PI * 2 / 5)]);
const inner = Array.from({ length: 5 }, (_, i) => [Math.sin((i * 72 + 36) * Math.PI / 180) * .381966, Math.cos((i * 72 + 36) * Math.PI / 180) * .381966]);
function edge(a: number[], b: number[]) {
  return Array.from({ length: 9 }, (_, i) => {
    const x = a[0] + (b[0] - a[0]) * i / 8, y = a[1] + (b[1] - a[1]) * i / 8;
    return project(90 * (1 - Math.hypot(x, y)), Math.atan2(x, y) * 180 / Math.PI);
  });
}
const path = (points: Array<{x:number;y:number}>) => 'M ' + points.map(p => `${p.x},${p.y}`).join(' L ') + ' Z';
document.querySelector('#move')!.addEventListener('click', () => { tables.melee_table[0].zone_id = 4; emit(); });
document.querySelector('#resolve')!.addEventListener('click', () => { tables.melee_table[3].state = 'Resolved'; emit(); });
document.querySelector('#leave')!.addEventListener('click', () => { tables.melee_seat.shift(); emit(); });
document.querySelector('#disconnect')!.addEventListener('click', () => { client.isLive = false; status(); });
document.querySelector('#reset')!.addEventListener('click', () => {
  tables = initial(); ratingScenario.value = 'pending'; client.isLive = true; client.conn = {}; status(); emit(); yaw.value = pitch.value = '0'; zoom.value = '1';
});
let frame = 0, last = 0;
function render(time: number) {
  frame = requestAnimationFrame(render);
  if (time - last < 32) return; last = time;
  for (let id = 0; id < 11; id++) {
    let points;
    if (id === 10) points = inner.flatMap((p, i) => edge(p, inner[(i + 1) % 5]));
    else if (id >= 5) { const k = id - 5; points = [...edge(tips[k], inner[(k + 4) % 5]), ...edge(inner[(k + 4) % 5], inner[k]), ...edge(inner[k], tips[k])]; }
    else points = [...edge(tips[id], inner[id]), ...edge(inner[id], tips[(id + 1) % 5]), ...Array.from({length:17}, (_, i) => project(0, (id + 1) * 72 - i * 72 / 16))];
    document.querySelector(`#zone-shape-${id}`)!.setAttribute('d', path(points));
  }
  document.querySelector('#horizon-rim-path')!.setAttribute('d', path(Array.from({length:65}, (_, i) => project(0, i * 360 / 64))));
  layer.renderFrame({ time, project,
    scale: Number(zoom.value), enabled: true, deploying: document.querySelector<HTMLInputElement>('#deploy')!.checked });
  const canvas = host.querySelector('canvas');
  document.querySelector('#readout')!.textContent = `Framebuffer ${canvas?.width} × ${canvas?.height} · ${host.querySelectorAll('.pk-board-agent').length} historical participants`;
}
frame = requestAnimationFrame(render);
if (import.meta.hot) import.meta.hot.dispose(() => { cancelAnimationFrame(frame); layer.destroy(); });
