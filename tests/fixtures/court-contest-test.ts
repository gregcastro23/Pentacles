import { openPentacleCourt } from '../../src/lib/agents/court-view';
import { FIXTURE_AGENTS, computeOvr } from '../../src/lib/agents/rating-contract';
import { normalizeApiRating } from '../../src/lib/agents/agent-rating-feed';

const launcher = document.querySelector<HTMLButtonElement>('#open')!;
launcher.onclick = () => {
  const agents = ['isaac-newton', 'emily-dickinson'].map(key => FIXTURE_AGENTS.find(agent => agent.key === key)!);
  const listeners = new Map<string, (rows: any[]) => void>();
  const tables: Record<string, any[]> = {
    zone: [{ zone_id: 0, owner: 6, control: 720 }],
    agent_chart: agents.map((agent, i) => ({ identity: `preview-npc-${i}`, handle: agent.handle })),
    melee_table: [{ table_id: 1, zone_id: 0, round_index: 0 }],
    melee_seat: agents.map((agent, i) => ({ seat_id: i + 1, table_id: 1,
      occupant: `preview-npc-${i}`, faction: agent.faction, is_human: false })),
    agent_rating: agents.map((agent, i) => ({ identity: `preview-npc-${i}`, agent_key: agent.key,
      observed_at_ms: Date.now(), snapshot_json: JSON.stringify(normalizeApiRating({
        ...agent, ovr: computeOvr(agent.ratings), esmsSource: 'fallback', degraded: { esms: true },
      }, agent.key)) })),
    // Initial plays are historical; only newly emitted rows trigger animations.
    melee_play: [1, 2].map(seat_id => ({ play_id: seat_id, seat_id, table_id: 1, trick_number: 0 })),
    melee_trick: [],
  };
  const client = { isLive: true, conn: {}, isApplied: () => true,
    subscribe(table: string, callback: (rows: any[]) => void) {
      listeners.set(table, callback); callback(tables[table] ?? []);
      return () => listeners.delete(table);
    },
  };
  openPentacleCourt({ client, faction: 6, zoneId: 0 });
  const controls = document.createElement('div');
  controls.className = 'contest-preview-controls';
  controls.innerHTML = `<p class="pk-court-notice">LOCAL PREVIEW · Synthetic subscriptions. Territory control stays at 72%.</p>
    <label class="pk-court-field">Preview winner<select aria-label="Preview winner">
      <option value="1">Isaac Newton</option><option value="2">Emily Dickinson</option>
    </select></label>
    <button type="button" data-preview="inspect">Inspect selected winner</button>
    <button type="button" data-preview="result">Show confirmed trick result</button>
    <button type="button" data-preview="next">Play next trick</button>
    <p role="status" class="preview-status">Select a vessel, then show the result to inspect its reaction.</p>`;
  document.querySelector('.pk-court-inspector-heading')!.append(controls);
  const result = controls.querySelector<HTMLButtonElement>('[data-preview="result"]')!;
  const next = controls.querySelector<HTMLButtonElement>('[data-preview="next"]')!;
  const winner = controls.querySelector<HTMLSelectElement>('select')!;
  const status = controls.querySelector<HTMLElement>('.preview-status')!;
  controls.querySelector<HTMLButtonElement>('[data-preview="inspect"]')!.onclick = () => {
    const handle = agents[Number(winner.value) - 1].handle;
    [...document.querySelectorAll<HTMLButtonElement>('.pk-court-agent')]
      .find(button => button.querySelector('strong')?.textContent === handle)?.click();
  };
  let trickNumber = 0;
  next.disabled = true;
  result.onclick = () => {
    const winnerSeat = Number(winner.value);
    tables.melee_trick.push({ trick_id: trickNumber + 1, table_id: 1, winner_seat: winnerSeat, trick_number: trickNumber });
    listeners.get('melee_trick')?.(tables.melee_trick);
    status.textContent = `${agents[winnerSeat - 1].handle} wins trick ${trickNumber + 1}. Reactions follow any queued card strikes.`;
    result.disabled = true;
    next.disabled = false;
  };
  next.onclick = () => {
    trickNumber++;
    tables.melee_play.push(...[1, 2].map(seat_id => ({ play_id: trickNumber * 2 + seat_id,
      table_id: 1, seat_id, trick_number: trickNumber })));
    listeners.get('melee_play')?.(tables.melee_play);
    result.disabled = false;
    next.disabled = true;
    status.textContent = 'Two card strikes queued. Choose the winner, then resolve this trick.';
  };
};
launcher.disabled = false;
launcher.textContent = 'Open contest preview';
