// The live leaderboard reads chain rows only, and nothing simulated reaches it:
// not the client's autonomous rounds, not practice melees, not the local decan
// conclusion. The settlement panel shows the real melee_result row.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import vm from "node:vm";
import { createVesselDocument } from "./helpers/vessel-dom";

// ---- browser globals, shared by every module under test ---------------------
const document: any = createVesselDocument();
const toasts: string[] = [];
const win: any = {
  toast: (message: string) => { toasts.push(message); },
  getDecanInfo: (lon: number) => ({ absDecan: Math.floor((((lon % 360) + 360) % 360) / 10), card: `Decan card ${Math.floor(lon / 10)}` }),
};
(globalThis as any).window = win;
(globalThis as any).document = document;

const spacetime: any = {
  isLive: true,
  listeners: new Map<string, (rows: any[]) => void>(),
  subscribe(table: string, cb: (rows: any[]) => void) { this.listeners.set(table, cb); return () => {}; },
  onStatus(cb: (s: string) => void) { cb(this.isLive ? "live" : "offline"); return () => {}; },
  emit(table: string, rows: any[]) { this.listeners.get(table)?.(rows); },
};
mock.module("../src/net/spacetime.js", () => ({ default: spacetime, spacetime }));

const { liveStandings, warDecan } = await import("../src/net/live-standings.js");
const { normalizeSqlResult } = await import("../src/net/sats-json.js");
const { MeleeTableInstance } = await import("../src/alchm-chart/melee-table.js");
const { FactionWarInstance } = await import("../src/alchm-chart/faction-war.js");

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const zone = (zone_id: number, kind: string, owner: string | null, control: number) => ({ zone_id, kind, owner, control });
const standing = (faction_idx: number, decan_points: number, decan_crowns = 0) => ({
  faction_idx, faction: PLANETS[faction_idx], decan_points, decan_crowns, lifetime_points: decan_points * 3,
});

// ---- 1. SATS-JSON: Vec<struct> columns decode to objects ----------------------
describe("HTTP /sql decoding", () => {
  const unit = { Product: { elements: [] } };
  const Planet = { Sum: { variants: PLANETS.map((n) => ({ name: { some: n }, algebraic_type: unit })) } };
  const opt = (t: any) => ({ Sum: { variants: [{ name: { some: "some" }, algebraic_type: t }, { name: { some: "none" }, algebraic_type: unit }] } });
  const col = (name: string, algebraic_type: any) => ({ name: { some: name }, algebraic_type });
  const Seat = { Product: { elements: [col("seat_id", { U64: [] }), col("faction", Planet), col("control_delta", { I32: [] })] } };
  const Ts = { Product: { elements: [col("__timestamp_micros_since_unix_epoch__", { I64: [] })] } };

  test("melee_result seats, options and timestamps", () => {
    const rows = normalizeSqlResult([{
      schema: { elements: [col("table_id", { U64: [] }), col("seats", { Array: Seat }), col("zone_owner_before", opt(Planet)), col("zone_owner_after", opt(Planet)), col("resolved_at", Ts), col("standings", { Array: { U64: [] } })] },
      rows: [[42, [[3, [4, []], 120], [4, [6, []], -40]], [1, []], [0, [4, []]], [1_760_000_000_000_000], [5, 0, 7]]],
    }]);
    expect(rows).toEqual([{
      table_id: 42,
      seats: [{ seat_id: 3, faction: "Mars", control_delta: 120 }, { seat_id: 4, faction: "Saturn", control_delta: -40 }],
      zone_owner_before: null,
      zone_owner_after: "Mars",
      resolved_at: { __timestamp_micros_since_unix_epoch__: 1_760_000_000_000_000 },
      standings: [5, 0, 7],
    }]);
  });
});

// ---- 2. The board itself is a pure function of chain rows --------------------
describe("liveStandings", () => {
  const zones = [zone(0, "House", "Mars", 300), zone(5, "Spire", "Venus", 50), zone(10, "Crown", null, 0)];
  const stars = [{ held_by: "Mars" }, { held_by: "Mars" }, { held_by: null }];

  test("zones, stars, current-decan points and crowns", () => {
    const live = liveStandings({ zones, stars, standings: [standing(4, 40, 1), standing(3, 500)], warState: [{ current_decan: 17 }], sunDecan: 17 });
    const mars = live.ranked.find((f: any) => f.id === 4);
    const venus = live.ranked.find((f: any) => f.id === 3);
    expect(mars.score).toBe(100 + 30 + 10 + 40 + 50);
    expect(venus.score).toBe(200 + 5 + 500);
    expect(live.ranked.map((f: any) => f.id).slice(0, 2)).toEqual([3, 4]);
    expect(live.ranked[0].rank).toBe(1);
    expect(mars.zonesHeld).toEqual([{ zoneId: 0, name: "House 0", control: 300 }]);
    expect(live.decanIsCurrent).toBe(true);
  });

  test("decan points wait until the war clock is on the Sun's decan", () => {
    for (const [warState, sunDecan] of [[[{ current_decan: 16 }], 17], [[{ current_decan: null }], 17], [[{ current_decan: 17 }], null], [null, 17]] as const) {
      const live = liveStandings({ zones, standings: [standing(3, 500, 2)], warState: warState as any, sunDecan: sunDecan as any });
      const venus = live.ranked.find((f: any) => f.id === 3);
      expect(venus.decanPoints).toBe(0);
      expect(venus.score).toBe(205 + 100); // zone + crowns still count
    }
  });

  test("unsynced standings are flagged; war_state decodes", () => {
    expect(liveStandings({ zones }).standingsSynced).toBe(false);
    expect(warDecan([{ current_decan: "35" }])).toBe(35);
    expect(warDecan([{ current_decan: 36 }])).toBe(null);
  });
});

// ---- 3. dashboards: the live panel and the HTTP ledger -----------------------
const container: any = document.createElement("div");
container.setAttribute("id", "leaderboard-container");
const banner: any = document.createElement("div");
banner.setAttribute("id", "decan-status-banner");
document.body.appendChild(container);
document.body.appendChild(banner);

const ledgerPayloads: any[] = [];
let sunLon = 171.17; // decan 17
const classic = mock(() => {});
win.renderLeaderboard = classic;
win.renderZonesList = () => {};
win.state = {
  // Fabricated local numbers that must never reach the live board.
  factionRoundPoints: [9e6, 9e6, 9e6, 9e6, 9e6, 9e6, 9e6, 9e6, 9e6, 9e6],
  decanVictories: [99, 99, 99, 99, 99, 99, 99, 99, 99, 99],
  player: { faction: 4 },
  sunLongitude: () => sunLon,
  getCurrentDecan: () => ({ card: "Card", progressPct: 50 }),
  syncDecanLedger: (p: any) => { ledgerPayloads.push(p); },
};
const realFetch = globalThis.fetch;
const realSetInterval = globalThis.setInterval;
(globalThis as any).fetch = async () => new Response(JSON.stringify({
  success: true,
  activeDecan: { absDecan: 17 },
  factionRoundPoints: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  decanVictories: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  decanHistory: [{ decanId: 16, winnerFaction: 2 }],
  recentRounds: [{ roundId: 9, zoneId: 1 }],
}));
(globalThis as any).setInterval = () => 0;
const { installDashboards, ledgerHistoryOnly } = await import("../src/net/dashboards.js");
installDashboards();
(globalThis as any).setInterval = realSetInterval;
await flush();
(globalThis as any).fetch = realFetch;

describe("live leaderboard panel", () => {
  const board = () => [...String(container.innerHTML).matchAll(/#(\d+) &nbsp; \S+ (\w+)[\s\S]*?(\d+) pts/g)]
    .map((m) => ({ rank: Number(m[1]), name: m[2], score: Number(m[3]) }));

  test("the ledger supplies history and rounds only", () => {
    expect(ledgerPayloads.length).toBe(1);
    expect(ledgerPayloads[0]).toEqual({ success: true, decanHistory: [{ decanId: 16, winnerFaction: 2 }], recentRounds: [{ roundId: 9, zoneId: 1 }] });
    expect(ledgerHistoryOnly({ success: true, factionRoundPoints: [1] })).toEqual({ success: true });
  });

  test("zones and stars alone until faction_war_standing syncs", () => {
    spacetime.emit("zone", [zone(0, "House", "Mars", 300), zone(1, "House", "Venus", 100)]);
    spacetime.emit("star_node", [{ held_by: "Venus", region_hint: 1 }]);
    expect(container.innerHTML).toContain("War Table standings not synced");
    expect(board().slice(0, 2)).toEqual([{ rank: 1, name: "Mars", score: 130 }, { rank: 2, name: "Venus", score: 115 }]);
    expect(container.innerHTML).not.toContain("9000000");
  });

  test("chain standings drive the board; local points and victories never do", () => {
    spacetime.emit("war_state", [{ id: 0, current_decan: 17 }]);
    spacetime.emit("faction_war_standing", [standing(3, 400, 1), standing(4, 10)]);
    expect(container.innerHTML).not.toContain("not synced");
    expect(board().slice(0, 2)).toEqual([{ rank: 1, name: "Venus", score: 115 + 400 + 50 }, { rank: 2, name: "Mars", score: 140 }]);
    expect(container.innerHTML).toContain("👑 1");
    expect(container.innerHTML).not.toContain("👑 99");
    expect(win.Pentacles.liveStandings().ranked[0].id).toBe(3);
  });

  test("a war clock behind the Sun holds its points back, and says so", () => {
    sunLon = 181; // decan 18; the chain is still on 17
    win.renderLeaderboard();
    expect(board().slice(0, 2)).toEqual([{ rank: 1, name: "Venus", score: 165 }, { rank: 2, name: "Mars", score: 130 }]);
    expect(banner.innerHTML).toContain("War Table clock is on Decan card 17, not the Sun's decan");
    sunLon = 171.17;
  });

  test("offline, the classic local board renders", () => {
    spacetime.isLive = false;
    classic.mockClear();
    win.renderLeaderboard();
    expect(classic).toHaveBeenCalledTimes(1);
    spacetime.isLive = true;
  });
});

// ---- 4. The classic client simulation stands down while live -----------------
describe("client.js simulation gate", () => {
  const ctxWindow: any = {
    localStorage: (() => { const m: Record<string, string> = {}; return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = String(v); }, removeItem: (k: string) => { delete m[k]; }, clear() {} }; })(),
    toast: (message: string, opts: any = {}) => { ctxToasts.push(opts.title || message); },
    CookieSync: { persistAll() {}, persist() {} },
    renderLeaderboard() {},
    renderZonesList() {},
    Pentacles: { net: { isLive: true } },
  };
  const ctxToasts: string[] = [];
  const context = vm.createContext({
    window: ctxWindow, localStorage: ctxWindow.localStorage, globalThis: ctxWindow, console, Math, Date, Array, Object, Set, Map,
    Number, String, parseInt, parseFloat, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(fs.readFileSync(new URL("../public/arcanaTrickEngine.js", import.meta.url), "utf8"), context);
  vm.runInContext(fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8"), context);
  const state = ctxWindow.state;
  const setSun = (eclLon: number) => { state.planets = [{ eclLon }]; };

  beforeEach(() => {
    ctxWindow.Pentacles.net.isLive = true;
    state.reset();
    state.planets = [];
    state.currentDecanId = null;
    state.decanHistory = [];
    state.decanVictories = new Array(10).fill(0);
    state.factionRoundPoints = new Array(10).fill(0);
    state.roundResults = [];
    ctxToasts.length = 0;
  });

  test("live ticks play no autonomous rounds and record nothing", () => {
    setSun(171.17);
    for (let i = 0; i < 6; i++) state.tick();
    expect([...state.factionRoundPoints]).toEqual(new Array(10).fill(0));
    expect(state.roundResults.length).toBe(0);
    expect(state.recordRoundResult({ zoneId: 1, winnerFaction: 2, seats: [{ faction: 2, score: 80 }], capturedZone: true })).toBe(null);
    expect([...state.factionRoundPoints]).toEqual(new Array(10).fill(0));
  });

  test("live, a decan crossing follows the Sun without crowning anyone", () => {
    setSun(179.9);
    state.tick();
    expect(state.currentDecanId).toBe(17);
    state.factionRoundPoints[4] = 3000; // e.g. left over from an offline session
    setSun(180.1);
    state.tick();
    expect(state.currentDecanId).toBe(18);
    expect([...state.factionRoundPoints]).toEqual(new Array(10).fill(0)); // never carried into the next decan
    expect(state.decanHistory.length).toBe(0);
    expect([...state.decanVictories]).toEqual(new Array(10).fill(0));
    expect(ctxToasts).not.toContain("Decan Round Reset");
  });

  test("offline, the simulation runs as before", () => {
    ctxWindow.Pentacles.net.isLive = false;
    setSun(179.9);
    state.tick();
    expect(state.roundResults.length).toBeGreaterThan(0);
    setSun(180.1);
    state.tick();
    expect(state.decanHistory.length).toBe(1);
    expect(ctxToasts).toContain("Decan Round Reset");
  });
});

// ---- 5. Practice melees never touch the live war ------------------------------
describe("practice melee gate", () => {
  function finishPractice(isLive: boolean) {
    const fw: any = Object.create(FactionWarInstance.prototype);
    Object.assign(fw, {
      spacetime: { isLive }, PN: PLANETS, myFaction: 0, myIdentity: "0xme", paint() {},
      data: { zones: [{ zone_id: 3, owner: 4, control: 500 }] },
    });
    const table: any = {
      tableId: 9003, zoneId: 3, trumpSuit: "wands", currentTrick: 12, isPractice: true, ladder: {}, plays: [], trickPlays: [],
      seats: [
        { seatId: 1, faction: 0, handle: "You", isHuman: true, score: 50, hand: [{ card_id: 1, suit: "wands", rank: 5, played: false }] },
        { seatId: 2, faction: 4, handle: "Newton", isHuman: false, score: 10, hand: [] },
      ],
    };
    const recorded: any[] = [];
    win.state = {
      map: Array.from({ length: 11 }, (_, i) => ({ zone_id: i, kind: i < 5 ? "house" : "spire", owner: i === 3 ? 4 : null, control: i === 3 ? 500 : 0 })),
      recordRoundResult: (r: any) => { recorded.push(r); },
    };
    toasts.length = 0;
    fw._handlePracticeCardPlay(table, 1, { setData() {} });
    return { table, recorded, fw };
  }

  test("live: no round recorded, no zone moved, toast says so", () => {
    const { table, recorded, fw } = finishPractice(true);
    expect(table.state).toBe("Resolved");
    expect(recorded.length).toBe(0);
    expect(win.state.map[3]).toEqual({ zone_id: 3, kind: "house", owner: 4, control: 500 });
    expect(fw.data.zones[0]).toEqual({ zone_id: 3, owner: 4, control: 500 });
    expect(table.practiceOutcome).toEqual({ winnerFaction: 0, controlShift: 0, capturedZone: false, recorded: false });
    expect(toasts.at(-1)).toContain("don't move the live war");
  });

  test("offline: plays into the local simulation as before", () => {
    const { table, recorded } = finishPractice(false);
    expect(recorded.length).toBe(1);
    expect(win.state.map[3].control).not.toBe(500);
    expect(table.practiceOutcome.recorded).toBe(true);
  });
});

// ---- 6. Settlement panel: the real melee_result row ---------------------------
describe("settlement panel", () => {
  const seats = [
    { seatId: 3, handle: "Ada", faction: 4, score: 140, counters: 120, meldsValue: 20, isHuman: true, occupant: "0xada" },
    { seatId: 4, handle: "Newton", faction: 6, score: 60, counters: 60, meldsValue: 0, isHuman: false, occupant: "0xnew" },
  ];
  const resolved = { tableId: 42, zoneId: 6, roundIndex: 77, state: "Resolved", tricks: [] };
  const result = (over: Record<string, unknown> = {}) => ({
    table_id: 42, round_index: 77, resolved_at: { __timestamp_micros_since_unix_epoch__: Date.UTC(2026, 9, 13, 12, 30) * 1000 },
    is_void: false, refereed: true, tricks_played: 12,
    winner_seat_id: 3, winner_faction: "Mars", winner_handle: "Ada", winning_score: 140, winner_control_delta: 120,
    seats: [
      { seat_id: 3, faction: "Mars", handle: "Ada", counters: 130, melds_value: 20, score: 150, took_final_trick: true, control_delta: 120 },
      { seat_id: 4, faction: "Saturn", handle: "Newton", counters: 60, melds_value: 0, score: 60, took_final_trick: false, control_delta: -40 },
    ],
    zone_owner_before: "Saturn", zone_control_before: 30, zone_owner_after: "Mars", zone_control_after: 50,
    captured: true, flux_active: false, winner_esms: 500, agent_turns: 2, fallback_turns: 1,
    ...over,
  });
  function render(table: any, fetchResult: any) {
    const mt: any = new MeleeTableInstance({ table, seats, fetchResult, myIdentity: "0xada" });
    mt.dom.settlement = document.createElement("div");
    mt._renderSettlement();
    return { mt, text: () => mt.dom.settlement.textContent as string };
  }
  const PLACEHOLDERS = ["+85 Influence", "The World", "0x7f2a", "ATK 42", "Sol-Net"];

  test("reads the row once and renders its real values", async () => {
    const fetch = mock(async () => result());
    const { mt, text } = render(resolved, fetch);
    expect(text()).toContain("reading the settled result");
    expect(text()).toContain("Table settled"); // nobody named before the chain says who won
    expect(text()).not.toContain("Triumphs");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([42]);
    const t = text();
    expect(t).toContain("Faction Mars Triumphs");
    expect(t).toContain("Settled on chain · Table #42 · 2026-10-13 12:30 UTC");
    expect(t).toContain("(+120 control)");
    expect(t).toContain("Saturn 30 → Mars 50 · captured from Saturn");
    expect(t).toContain("0.0500");
    expect(t).toContain("ESMS to Ada");
    expect(t).toContain("150 pts"); // the chain's final score, not the live seat's 140
    expect(t).toContain("-40");
    expect(t).toContain("ASOL turns 2 (1 fallback)");
    for (const p of PLACEHOLDERS) expect(t).not.toContain(p);
    mt._renderSettlement();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a void table pays nothing and names no winner", async () => {
    const { text } = render(resolved, async () => result({ is_void: true, winner_esms: 0, captured: false }));
    await flush();
    expect(text()).toContain("Void Table");
    expect(text()).toContain("no control moved");
    expect(text()).toContain("No ESMS paid");
  });

  test("a missing or unreadable row shows no made-up numbers", async () => {
    const missing = render(resolved, async () => null);
    await flush();
    expect(missing.text()).toContain("no settled result on chain");
    const failed = render(resolved, async () => { throw new Error("sql 500"); });
    await flush();
    expect(failed.text()).toContain("couldn't read the settled result");
    for (const p of [...PLACEHOLDERS, "+120"]) {
      expect(missing.text()).not.toContain(p);
      expect(failed.text()).not.toContain(p);
    }
  });

  test("practice and unsettled tables never query the chain", () => {
    const fetch = mock(async () => result());
    const practice = render({ ...resolved, isPractice: true, practiceOutcome: { controlShift: 0, recorded: false } }, fetch);
    expect(practice.text()).toContain("not recorded on chain");
    expect(practice.text()).toContain("don't move the live war");
    const playing = render({ ...resolved, state: "Playing" }, fetch);
    playing.mt.showSettlement = true;
    playing.mt._renderSettlement();
    expect(playing.text()).toContain("Table in play");
    expect(fetch).toHaveBeenCalledTimes(0);
  });
});

// ---- 7. Faction dossier: chain board while live, never the simulation --------
describe("faction dossier while live", () => {
  const els: Record<string, any> = {};
  const el = (id?: string) => ({ id, style: {}, innerHTML: "", setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {} }, querySelectorAll: () => [] });
  const fwin: any = {
    state: {
      leaderboard: [{ id: 6, score: 1531 }, { id: 4, score: 900 }], // simulated
      decanVictories: { 6: 7 },
      map: [{ zone_id: 2, kind: "house", owner: 6, control: 777 }],
      getCurrentDecan: () => ({ absDecan: 19, card: "3 of Swords", rulerFaction: 6, rulerName: "Saturn", rulerGlyph: "♄", signName: "Libra", signGlyph: "♎", startDeg: 10, endDeg: 20, progressPct: 35 }),
      player: { handle: "Seeker", faction: 6 },
    },
    Pentacles: { net: { isLive: true }, liveStandings: () => null },
    document: {
      getElementById: (id: string) => (els[id] ||= el(id)),
      createElement: () => el(),
      body: { classList: { add() {}, remove() {} }, appendChild(e: any) { if (e.id) els[e.id] = e; } },
      addEventListener() {}, removeEventListener() {},
    },
  };
  new Function("window", "document", "globalThis", fs.readFileSync(new URL("../public/faction-page.js", import.meta.url), "utf8"))(fwin, fwin.document, fwin);
  const page = () => { fwin.openFactionPage(6); return els["faction-page-overlay"].innerHTML as string; };

  test("before the zones sync it shows a neutral placeholder", () => {
    const html = page();
    expect(html).toContain("#7 <span");
    expect(html).not.toContain("1,531");
    expect(html).not.toContain("777");
  });

  test("once synced it shows the chain board", () => {
    fwin.Pentacles.liveStandings = () => liveStandings({
      zones: [zone(3, "House", "Saturn", 200)], standings: [standing(6, 300, 1)], warState: [{ current_decan: 19 }], sunDecan: 19,
    });
    const html = page();
    expect(html).toContain("#1 <span");
    expect(html).toContain("470 <span"); // 100 + 20 + 300 + 50
    expect(html).toContain("1 <span class=\"f-stat-sub\">👑 crowns");
    expect(html).not.toContain("1,531");
  });
});
