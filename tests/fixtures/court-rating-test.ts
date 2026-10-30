// Synthetic subscription harness. Does not connect to or write a database.
import { openPentacleCourt } from '../../src/lib/agents/court-view';
import { FIXTURE_AGENTS, computeOvr } from '../../src/lib/agents/rating-contract';
import { normalizeApiRating } from '../../src/lib/agents/agent-rating-feed';

const source = structuredClone(FIXTURE_AGENTS[0]);
source.ovr = computeOvr(source.ratings);
const snapshot = normalizeApiRating({ ...source, esmsSource: 'database' }, source.key);
const tables: Record<string, any[]> = {
  zone: [{ zone_id: 0, owner: 6, control: 720 }],
  agent_chart: [{ identity: 'synthetic-npc', handle: 'Isaac Newton' }],
  melee_table: [{ table_id: 1, zone_id: 0 }],
  melee_seat: [{ seat_id: 1, table_id: 1, occupant: 'synthetic-npc', faction: 6, is_human: false }],
  agent_rating: [],
};
const listeners = new Map<string, (rows: any[]) => void>();
const client = { isLive: true, conn: {}, isApplied: () => true,
  subscribe(table: string, callback: (rows: any[]) => void) {
    listeners.set(table, callback); callback(tables[table] ?? []);
    return () => listeners.delete(table);
  },
};
document.querySelector<HTMLButtonElement>('#open')!.onclick = () => {
  tables.agent_rating = [];
  openPentacleCourt({ client, faction: 6 });
  const label = document.createElement('label'); label.className = 'pk-court-field';
  label.textContent = 'Synthetic rating state';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Synthetic rating state');
  for (const state of ['Pending', 'Current', 'Partial', 'Stale', 'Deleted']) select.add(new Option(state, state));
  select.onchange = () => {
    const partial = select.value === 'Partial';
    const data = partial ? { ...snapshot, chartPlaceholder: true, esms: [0, 0, 0, 0], esmsSource: 'unavailable', seals: [], surge: null } : snapshot;
    tables.agent_rating = ['Pending', 'Deleted'].includes(select.value) ? [] : [{
      identity: 'synthetic-npc', agent_key: 'isaac-newton',
      observed_at_ms: Date.now() - (select.value === 'Stale' ? 360_000 : 0), snapshot_json: JSON.stringify(data),
    }];
    listeners.get('agent_rating')?.(tables.agent_rating);
  };
  label.append(select);
  document.querySelector('.pk-court-inspector-heading')!.append(label);
};
