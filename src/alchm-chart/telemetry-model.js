/* ============================================================
   Telemetry Model — the admin observatory's data layer
   ============================================================
   A resilient aggregation layer over the live SpacetimeDB module. It pulls every
   subsystem (players, economy, faction war, AI duels/oracle, agents, the
   constellation DEX, the sky tick) into ONE plain KPI snapshot the admin panel
   renders. Framework-agnostic: it only needs a `spacetime` client exposing
   `query(sql)` / `isLive` / `status` (see src/net/spacetime.js).

     const model = TelemetryModel.create({ spacetime })
     const snap  = await model.snapshot()   // { health, players, economy, … }

   Design rules:
   • Every query is wrapped — a failing/absent table degrades to a null/zero, never
     a thrown snapshot. A half-seeded or offline module still renders a full panel.
   • Big tables (card, natal_decan, constellation_star, star_node) are COUNTED, not
     pulled, with a graceful fallback when the SQL subset lacks COUNT.
   • All timestamps are coerced to epoch-millis via `toMs` (handles both the WS and
     HTTP /sql decodings — see ws-normalize.js).
   ============================================================ */

export const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
export const PLANET_GLYPHS = ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇'];
export const PLANET_COLORS = ['#e8b84b', '#cbd0db', '#9aa7c4', '#d98fb0', '#cf4d4d', '#cf9a52', '#9a937c', '#5fb6c4', '#6470c8', '#8a6aa0'];
export const ESMS_NAMES = ['Spirit', 'Essence', 'Matter', 'Substance'];
export const ZONE_KINDS = ['House', 'Spire', 'Crown'];

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** A `service_status` heartbeat older than this is STALE. A dead service can't
 *  report its own death — it just stops upserting, so staleness IS the failure
 *  signal (see the ServiceStatus table doc in server/src/tables.rs). */
export const SERVICE_STALE_MS = 15 * MIN;

// ── value coercion ─────────────────────────────────────────────────────────
/** Coerce any SpacetimeDB timestamp decoding to epoch-millis (or null). */
export function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts > 1e14 ? ts / 1000 : ts; // micros → ms heuristic
  if (typeof ts === 'bigint') return Number(ts) / 1000;
  if (typeof ts === 'object') {
    const v = ts.__timestamp_micros_since_unix_epoch__ ?? ts.microsSinceUnixEpoch ?? ts.micros ?? null;
    if (v != null) return Number(v) / 1000;
  }
  const n = Number(ts);
  return Number.isFinite(n) ? (n > 1e14 ? n / 1000 : n) : null;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const big = (v) => { try { return BigInt(v); } catch { return 0n; } };

/** Enum value (string | {variant:[]} | index) → canonical planet index, or -1. */
export function planetIdx(v) {
  if (v == null) return -1;
  if (typeof v === 'number') return v;
  const key = typeof v === 'object' ? Object.keys(v)[0] : String(v);
  const i = PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(key).toLowerCase());
  return i;
}
/** Enum value → variant name string (handles string | {variant:[]} | index map). */
function variantName(v, names) {
  if (v == null) return null;
  if (typeof v === 'number') return names ? names[v] : String(v);
  if (typeof v === 'object') return Object.keys(v)[0] || null;
  return String(v);
}
/** Title-case an enum variant name so matching is case-stable across module versions
 *  (SpacetimeDB 1.x decodes Suit/ZoneKind to lowercase, 2.x to PascalCase). */
function titleCase(s) {
  if (!s) return s;
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export class TelemetryModel {
  constructor(opts = {}) {
    this.spacetime = opts.spacetime || (typeof window !== 'undefined' ? window.__spacetime : null);
    this.now = opts.now || (() => Date.now());
    this._countCache = new Map();
  }

  get live() { return !!(this.spacetime && this.spacetime.isLive); }
  get status() { return (this.spacetime && this.spacetime.status) || 'offline'; }

  // ---- low-level helpers ----------------------------------------------------
  async _q(sql) {
    if (!this.spacetime || typeof this.spacetime.query !== 'function') return [];
    try { return (await this.spacetime.query(sql)) || []; } catch { return []; }
  }
  /** Count a table using COUNT(*); returns 0 if count fails or table is private without dumping whole rows. */
  async _count(table) {
    const rows = await this._q(`SELECT COUNT(*) AS n FROM ${table}`);
    if (rows.length && rows[0] && (rows[0].n != null || rows[0].col0 != null)) {
      return num(rows[0].n ?? rows[0].col0);
    }
    return 0;
  }

  // ---- the full snapshot ----------------------------------------------------
  /** Pull every subsystem concurrently into one KPI snapshot. */
  async snapshot() {
    const [health, players, economy, war, duels, agents, dex, sky, services] = await Promise.all([
      this.health().catch(() => null),
      this.players().catch(() => null),
      this.economy().catch(() => null),
      this.war().catch(() => null),
      this.duels().catch(() => null),
      this.agents().catch(() => null),
      this.dex().catch(() => null),
      this.sky().catch(() => null),
      this.services().catch(() => null),
    ]);
    return {
      at: this.now(),
      live: this.live,
      status: this.status,
      health, players, economy, war, duels, agents, dex, sky, services,
    };
  }

  // ── HEALTH: connection, sky-tick freshness, seeding, ownership ─────────────
  async health() {
    const now = this.now();
    const [cfg, eph, skyTimer] = await Promise.all([
      this._q('SELECT id, owner, season_degree, ascendant_degree, seeded, star_seed_cursor, constellations_seeded FROM game_config'),
      this._q('SELECT body, tick, retrograde, transiting_zone FROM ephemeris'),
      this._q('SELECT scheduled_id FROM sky_tick_timer'),
    ]);
    const c = cfg[0] || null;
    const ticks = eph.map((r) => toMs(r.tick)).filter((x) => x != null);
    const lastTick = ticks.length ? Math.max(...ticks) : null;
    const retro = eph.filter((r) => r.retrograde === true || r.retrograde === 1).length;
    return {
      connection: this.status,
      live: this.live,
      owner: c && (c.owner?.__identity__ ?? c.owner) || null,
      seasonDegree: c ? num(c.season_degree) : null,
      ascendantDegree: c ? num(c.ascendant_degree) : null,
      seeded: c ? !!c.seeded : null,
      starSeedCursor: c ? num(c.star_seed_cursor) : null,
      constellationsSeeded: c ? !!c.constellations_seeded : null,
      ephemerisBodies: eph.length,
      retrogradeBodies: retro,
      lastTickMs: lastTick,
      lastTickAgeMs: lastTick != null ? now - lastTick : null,
      skyTimerArmed: skyTimer.length > 0,
    };
  }

  // ── PLAYERS: growth, activity, factions, leaderboards ─────────────────────
  async players() {
    const now = this.now();
    const rows = await this._q('SELECT identity, handle, faction, tokens, word_wins, created_at, last_active FROM player');
    const total = rows.length;
    const created = rows.map((r) => toMs(r.created_at)).filter((x) => x != null);
    const active = rows.map((r) => toMs(r.last_active)).filter((x) => x != null);
    const new24 = created.filter((t) => now - t < DAY).length;
    const new7d = created.filter((t) => now - t < 7 * DAY).length;
    const active1h = active.filter((t) => now - t < HOUR).length;
    const active24 = active.filter((t) => now - t < DAY).length;

    const factions = new Array(10).fill(0);
    let tokenSupply = 0n, totalWins = 0;
    for (const r of rows) {
      const fi = planetIdx(r.faction);
      if (fi >= 0 && fi < 10) factions[fi] += 1;
      tokenSupply += big(r.tokens);
      totalWins += num(r.word_wins);
    }
    const byTokens = [...rows].sort((a, b) => Number(big(b.tokens) - big(a.tokens))).slice(0, 8)
      .map((r) => ({ handle: r.handle, faction: planetIdx(r.faction), tokens: Number(big(r.tokens)), wins: num(r.word_wins) }));
    const byWins = [...rows].sort((a, b) => num(b.word_wins) - num(a.word_wins)).slice(0, 8)
      .map((r) => ({ handle: r.handle, faction: planetIdx(r.faction), tokens: Number(big(r.tokens)), wins: num(r.word_wins) }));

    const supply = Number(tokenSupply);
    const avgTokens = total ? supply / total : 0;
    const topHolder = byTokens[0] ? byTokens[0].tokens : 0;
    return {
      restricted: total === 0,
      total, new24, new7d, active1h, active24,
      factions, tokenSupply: supply, totalWins,
      avgTokens, topHolderShare: supply ? topHolder / supply : 0,
      retention24: total ? active24 / total : 0,
      withWins: rows.filter((r) => num(r.word_wins) > 0).length,
      topByTokens: byTokens, topByWins: byWins,
    };
  }

  // ── ECONOMY: card supply & composition, trade flow, jing pools, star staking ─
  async economy() {
    const [cardCount, deckCount, decanCount, trades, pools, stakePools] = await Promise.all([
      this._count('card'),
      this._count('deck_slot'),
      this._count('natal_decan'),
      this._q('SELECT trade_id, state, offer, request, created_at FROM trade'),
      this._count('jing_pool'),
      this._q('SELECT star_id, total_principal_usdc, total_shares FROM star_stake_pool'),
    ]);

    // Real card composition (by suit / major / inverted / lettered / level) — pulled
    // only when the supply is small enough to project cheaply; else just the count.
    const SUITS = ['Wands', 'Cups', 'Swords', 'Pentacles'];
    const bySuit = { Wands: 0, Cups: 0, Swords: 0, Pentacles: 0 };
    let majors = 0, inverted = 0, lettered = 0;
    const byLevel = { 'Lv1': 0, 'Lv2–3': 0, 'Lv4+': 0 };
    let composed = false;
    if (cardCount > 0 && cardCount <= 60000) {
      const cards = await this._q('SELECT suit, is_major, inverted, letter, level FROM card');
      if (cards.length) {
        composed = true;
        for (const c of cards) {
          const su = titleCase(variantName(c.suit)); if (su && bySuit[su] != null) bySuit[su] += 1;
          if (c.is_major === true || c.is_major === 1) majors += 1;
          if (c.inverted === true || c.inverted === 1) inverted += 1;
          if (num(c.letter) > 0) lettered += 1;
          const lv = num(c.level);
          if (lv >= 4) byLevel['Lv4+'] += 1; else if (lv >= 2) byLevel['Lv2–3'] += 1; else byLevel['Lv1'] += 1;
        }
      }
    }

    // Trades: state mix + how many cards are escrowed in open trades.
    const tradeStates = {};
    let openTrades = 0, cardsEscrowed = 0;
    for (const t of trades) {
      const s = variantName(t.state) || 'Unknown';
      tradeStates[s] = (tradeStates[s] || 0) + 1;
      const off = Array.isArray(t.offer) ? t.offer.length : 0;
      const req = Array.isArray(t.request) ? t.request.length : 0;
      if (s === 'Open' || s === 'Proposed') { openTrades += 1; cardsEscrowed += off + req; }
    }

    let principal = 0n;
    for (const p of stakePools) {
      principal += big(p.total_principal_usdc);
    }
    return {
      cards: cardCount, deckSlots: deckCount, decanCards: decanCount,
      cardComposed: composed, cardsBySuit: bySuit, cardsByLevel: byLevel,
      majors, inverted, lettered,
      trades: trades.length, tradeStates, openTrades, cardsEscrowed,
      jingPools: pools,
      stakes: stakePools.length,
      stakePrincipalUsdc: Number(principal) / 1e6, // 6-dp USDC
      stakeAccruedEssence: 0,
      stakeClaimedEssence: 0,
      stakesByElement: [0, 0, 0, 0],
    };
  }

  // ── FACTION WAR: zones, star holdings, battles, live PvP duels ────────────
  async war() {
    const [zones, stars, battles, duelRows, queue] = await Promise.all([
      this._q('SELECT zone_id, kind, owner, control, updated_at FROM zone'),
      this._q('SELECT held_by FROM star_node'),
      this._q('SELECT battle_id, won, attacker_score, defense_rating FROM battle'),
      this._q('SELECT duel_id, state FROM duel'),
      this._count('duel_queue'),
    ]);
    const zoneList = zones.map((z) => ({
      id: num(z.zone_id),
      kind: titleCase(variantName(z.kind, ZONE_KINDS)) || 'House',
      owner: planetIdx(z.owner),
      control: num(z.control),
    })).sort((a, b) => a.id - b.id);
    const neutral = zoneList.filter((z) => z.owner < 0).length;

    // Faction standings = zones held + stars held (weighted) per Planet.
    const zonesByFaction = new Array(10).fill(0);
    for (const z of zoneList) if (z.owner >= 0) zonesByFaction[z.owner] += 1;
    const starsByFaction = new Array(10).fill(0);
    let starsHeld = 0;
    for (const s of stars) { const fi = planetIdx(s.held_by); if (fi >= 0) { starsByFaction[fi] += 1; starsHeld += 1; } }

    const battleWins = battles.filter((b) => b.won === true || b.won === 1).length;
    const duelStates = {};
    for (const d of duelRows) { const s = variantName(d.state) || 'Unknown'; duelStates[s] = (duelStates[s] || 0) + 1; }

    // Contested = near the 0 pivot (flippable); crown = zone 10 / kind Crown.
    const contested = zoneList.filter((z) => Math.abs(z.control) < 200).length;
    const crown = zoneList.find((z) => z.kind === 'Crown' || z.id === 10);
    const totalPressure = zoneList.reduce((a, z) => a + Math.abs(z.control), 0);
    const byKind = { House: 0, Spire: 0, Crown: 0 };
    for (const z of zoneList) if (byKind[z.kind] != null && z.owner >= 0) byKind[z.kind] += 1;
    const leader = zonesByFaction.reduce((best, v, i) => (v > best.v ? { i, v } : best), { i: -1, v: 0 });

    return {
      zones: zoneList, neutralZones: neutral, contestedZones: contested,
      crownOwner: crown ? crown.owner : -1,
      heldByKind: byKind, totalPressure,
      leadFaction: leader.i, leadFactionZones: leader.v,
      zonesByFaction, starsByFaction, starsHeld, starsTotal: stars.length,
      battles: battles.length, battleWins,
      battleWinRate: battles.length ? battleWins / battles.length : 0,
      pvpDuels: duelRows.length, pvpDuelStates: duelStates, queueDepth: queue,
    };
  }

  // ── DUELS & ORACLE: word duels, jing arena, Claude oracle backlog ─────────
  async duels() {
    const now = this.now();
    const [word, jingDuels, jingCasts, oReq, oRep, oCache, challenges] = await Promise.all([
      this._q('SELECT duel_id, won, tokens_awarded, player_score, agent_score, created_at FROM word_duel'),
      this._q('SELECT duel_id, state, created_at FROM jing_duel'),
      this._count('jing_cast'),
      this._q('SELECT request_id, answered, cacheable, created_at FROM oracle_request'),
      this._q('SELECT request_id, model, created_at FROM oracle_reply'),
      this._count('oracle_cache'),
      this._q('SELECT challenge_id, answered FROM duel_challenge'),
    ]);
    // Word duels
    const wWins = word.filter((w) => w.won === true || w.won === 1).length;
    let tokensAwarded = 0n;
    for (const w of word) tokensAwarded += big(w.tokens_awarded);
    const word24 = word.map((w) => toMs(w.created_at)).filter((t) => t != null && now - t < DAY).length;

    // Jing arena
    const jingStates = {};
    for (const d of jingDuels) { const s = variantName(d.state) || 'Unknown'; jingStates[s] = (jingStates[s] || 0) + 1; }

    // Oracle — the AI engagement + service-health surface
    const answered = oReq.filter((r) => r.answered === true || r.answered === 1).length;
    const backlog = oReq.length - answered;
    const byModel = {};
    for (const r of oRep) { const m = r.model || 'unknown'; byModel[m] = (byModel[m] || 0) + 1; }
    // Reply latency: match reply→request by id, median + p95 over recent.
    const reqAt = new Map(oReq.map((r) => [String(r.request_id), toMs(r.created_at)]));
    const lats = [];
    for (const rep of oRep) {
      const a = reqAt.get(String(rep.request_id)), b = toMs(rep.created_at);
      if (a != null && b != null && b >= a) lats.push(b - a);
    }
    lats.sort((x, y) => x - y);
    const pct = (p) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] : null);
    const openChallenges = challenges.filter((c) => !(c.answered === true || c.answered === 1)).length;

    // Service quality: how much of the answer load the cache absorbs, and recent throughput.
    const cacheServed = byModel['cache'] || 0;
    const replies = oRep.length;
    const oracle24 = oReq.map((r) => toMs(r.created_at)).filter((t) => t != null && now - t < DAY).length;
    const jing24 = jingDuels.map((d) => toMs(d.created_at)).filter((t) => t != null && now - t < DAY).length;

    return {
      word: word.length, wordWins: wWins, wordWinRate: word.length ? wWins / word.length : 0,
      wordTokensAwarded: Number(tokensAwarded), word24,
      jingDuels: jingDuels.length, jingStates, jingCasts, jing24,
      oracleRequests: oReq.length, oracleAnswered: answered, oracleBacklog: backlog,
      oracleAnsweredRate: oReq.length ? answered / oReq.length : 0,
      oracleCacheHitRate: replies ? cacheServed / replies : 0, oracle24,
      oracleByModel: byModel, oracleCache: oCache, oracleLatencyMs: { p50: pct(0.5), p95: pct(0.95) },
      openChallenges,
    };
  }

  // ── AGENTS: planetary + historical agent charts, star agents, comets ──────
  async agents() {
    const [agentCharts, starAgents, comets] = await Promise.all([
      this._q('SELECT identity, handle, time_known FROM agent_chart'),
      this._q('SELECT hip_id, display_name, element, active FROM star_agent'),
      this._q('SELECT comet_id, name, active FROM comet'),
    ]);
    const starActive = starAgents.filter((s) => s.active === true || s.active === 1).length;
    const cometActive = comets.filter((c) => c.active === true || c.active === 1).length;
    // Star agents split by dominant ESMS element (0..3); agent charts by time-known.
    const starByElement = [0, 0, 0, 0];
    for (const s of starAgents) { const e = num(s.element); if (e >= 0 && e < 4) starByElement[e] += 1; }
    const timed = agentCharts.filter((a) => a.time_known === true || a.time_known === 1).length;
    return {
      agentCharts: agentCharts.length,
      agentTimed: timed, agentSolar: agentCharts.length - timed,
      agentNames: agentCharts.map((a) => a.handle).filter(Boolean).slice(0, 80),
      starAgents: starAgents.length, starAgentsActive: starActive, starByElement,
      comets: comets.length, cometsActive: cometActive,
      cometNames: comets.map((c) => c.name).filter(Boolean),
    };
  }

  // ── CONSTELLATION DEX: pool catalogue, minted blocks, resolutions, attestor ─
  async dex() {
    const [consts, memberStars, blocks, resolutions, intents, attests] = await Promise.all([
      this._q('SELECT constellation_id, abbr, name, elem_a, elem_b, degenerate, fee_bps, member_count FROM constellation'),
      this._count('constellation_star'),
      this._q('SELECT block_id, constellation_id, minter, onchain_block FROM constellation_block'),
      this._q('SELECT constellation_id, resolution_level, added_members FROM constellation_resolution'),
      this._q('SELECT intent_id, attested FROM trace_intent'),
      this._count('trace_attestation'),
    ]);
    const onchain = blocks.filter((b) => (b.onchain_block ?? null) != null).length;
    const attested = intents.filter((i) => i.attested === true || i.attested === 1).length;
    const topResolved = [...resolutions]
      .sort((a, b) => num(b.resolution_level) - num(a.resolution_level))
      .slice(0, 6)
      .map((r) => {
        const c = consts.find((x) => num(x.constellation_id) === num(r.constellation_id));
        return { name: c ? c.name : `#${num(r.constellation_id)}`, level: num(r.resolution_level), added: num(r.added_members) };
      });
    // Pool catalogue composition: ESMS pairs, single-element (degenerate) figures,
    // fee-tier histogram (bps), and how many figures already carry resolution.
    const degenerate = consts.filter((c) => c.degenerate === true || c.degenerate === 1).length;
    const pairCounts = {};
    const feeTiers = {};
    let memberTotal = 0;
    for (const c of consts) {
      const pair = `${ESMS_NAMES[num(c.elem_a)] || '?'}/${ESMS_NAMES[num(c.elem_b)] || '?'}`;
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
      const fee = `${(num(c.fee_bps) / 100).toFixed(2)}%`;
      feeTiers[fee] = (feeTiers[fee] || 0) + 1;
      memberTotal += num(c.member_count);
    }
    const resolvedPools = resolutions.filter((r) => num(r.resolution_level) > 0).length;
    const avgResolution = resolutions.length
      ? resolutions.reduce((a, r) => a + num(r.resolution_level), 0) / resolutions.length : 0;
    const uniqueMinters = new Set(blocks.map((b) => String(b.minter?.__identity__ ?? b.minter))).size;
    return {
      pools: consts.length, degeneratePools: degenerate, esmsPairs: pairCounts, feeTiers,
      memberStarsSeed: memberTotal, memberStars,
      blocks: blocks.length, blocksOnchain: onchain, uniqueMinters,
      resolutions: resolutions.length, resolvedPools, avgResolution, topResolved,
      traceIntents: intents.length, traceAttested: attested, traceBacklog: intents.length - attested,
      attestations: attests,
    };
  }

  // ── SKY: per-body ephemeris snapshot (ra/dec/zone/retro/tick) ─────────────
  async sky() {
    const now = this.now();
    const eph = await this._q('SELECT body, ra, dec, transiting_zone, retrograde, tick FROM ephemeris');
    const bodies = eph.map((r) => {
      const bi = planetIdx(r.body);
      const t = toMs(r.tick);
      return {
        body: bi >= 0 ? bi : null,
        name: bi >= 0 ? PLANET_NAMES[bi] : variantName(r.body),
        ra: num(r.ra), dec: num(r.dec),
        zone: num(r.transiting_zone),
        retrograde: r.retrograde === true || r.retrograde === 1,
        ageMs: t != null ? now - t : null,
      };
    }).sort((a, b) => (a.body ?? 99) - (b.body ?? 99));
    return { bodies };
  }

  // ── SERVICES: cross-service health heartbeats (service_status) ────────────
  /** One row per companion service, written via the owner-gated
   *  `report_service_health` reducer. A dead feeder stops reporting rather than
   *  reporting itself dead, so a row whose `updated_at` is older than
   *  SERVICE_STALE_MS is flagged `stale` — staleness IS the signal, and a stale
   *  row's `healthy` flag is treated as unreliable (it's the last word of a
   *  process that has since gone quiet). */
  async services() {
    const now = this.now();
    const rows = await this._q('SELECT service, healthy, detail, latency_ms, updated_at FROM service_status');
    const list = rows.map((r) => {
      const t = toMs(r.updated_at);
      const ageMs = t != null ? now - t : null;
      return {
        service: String(r.service ?? '—'),
        healthy: r.healthy === true || r.healthy === 1,
        detail: String(r.detail ?? ''),
        latencyMs: num(r.latency_ms),
        updatedMs: t,
        ageMs,
        // An unparseable/absent timestamp is treated as stale too — safe default.
        stale: ageMs == null || ageMs > SERVICE_STALE_MS,
      };
    }).sort((a, b) => a.service.localeCompare(b.service));
    const stale = list.filter((s) => s.stale).length;
    const unhealthy = list.filter((s) => !s.stale && !s.healthy).length;
    const healthy = list.filter((s) => !s.stale && s.healthy).length;
    return { list, total: list.length, healthy, unhealthy, stale, staleAfterMs: SERVICE_STALE_MS };
  }
}

export function create(opts) { return new TelemetryModel(opts); }
export function fmtAge(ms) {
  if (ms == null) return '—';
  if (ms < 0) ms = 0;
  if (ms < MIN) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)}h`;
  return `${(ms / DAY).toFixed(1)}d`;
}
export function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  n = Number(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
const Telemetry = { create, TelemetryModel, toMs, planetIdx, fmtAge, fmtNum, SERVICE_STALE_MS, PLANET_NAMES, PLANET_GLYPHS, PLANET_COLORS, ESMS_NAMES };
export default Telemetry;
if (typeof window !== 'undefined') window.TelemetryModel = Telemetry;
