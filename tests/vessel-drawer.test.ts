import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createVesselDocument } from "./helpers/vessel-dom";

const ME = "a".repeat(64);
const CACHE_PREFIX = "pentacles:vessel:v1:";
let user: any;
const authListeners = new Set<() => void>();
const spacetime: any = { identity: ME, configured: true, isLive: true, query: async () => [] };

mock.module("../src/net/spacetime.js", () => ({ default: spacetime }));
mock.module("../src/net/auth.js", () => ({
  currentUser: () => user,
  onAuth: (callback: () => void) => { authListeners.add(callback); callback(); return () => authListeners.delete(callback); },
  signIn() {},
}));
mock.module("../src/net/origins.js", () => ({ KITCHEN: "https://alchm.kitchen", AGENTS: "https://agents.alchm.kitchen" }));
mock.module("../src/web3/solana.js", () => ({ readSolanaEsmsBalances: async () => [] }));

const { VesselDrawer, openVesselDrawer, closeVesselDrawer } = await import("../src/ui/vessel-drawer.js");
const originalFetch = globalThis.fetch;
let document: any;
let cache: Map<string, string>;
let drawer: InstanceType<typeof VesselDrawer> | null;

function vessel(spirit = 123) {
  const stream = { ledgerEsms: [0, 0, 0, 0] };
  return {
    version: 1, balances: { spirit, essence: 0, matter: 0, substance: 0 },
    streams: { jingDuels: stream, staking: stream, pentaclesMelee: stream, kitchenAchievements: stream },
  };
}
const response = (value = vessel()) => new Response(JSON.stringify({ ok: true, vessel: value }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setUser(value: any) { user = value; for (const callback of authListeners) callback(); }
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  drawer = new VesselDrawer(host).mount();
  return host;
}

beforeEach(() => {
  document = createVesselDocument();
  cache = new Map();
  user = { id: "account-A" };
  spacetime.identity = ME;
  spacetime.query = async (sql: string) => sql.includes("FROM player") ? [{ identity: ME, tokens: 10, word_wins: 2 }] : [];
  Object.assign(globalThis, {
    document, window: { state: { player: { tokens: 9999, word_wins: 99 } } },
    localStorage: { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) },
    fetch: async () => response(),
  });
});
afterEach(async () => {
  drawer?.destroy();
  drawer = null;
  closeVesselDrawer();
  authListeners.clear();
  globalThis.fetch = originalFetch;
  await flush();
});

describe("Vessel drawer lifecycle", () => {
  test("sign-out cannot be undone by an earlier treasury response", async () => {
    const request = deferred<Response>();
    globalThis.fetch = (() => request.promise) as typeof fetch;
    const host = mount();
    setUser(null);
    await flush();
    expect(host.textContent).toContain("Sign in with your Alchm account");
    request.resolve(response());
    await flush();
    expect(host.textContent).toContain("Sign in with your Alchm account");
    expect(cache.has(CACHE_PREFIX + "account-A")).toBe(false);
  });

  test.each([200, 401])("an old account's HTTP %i response cannot replace the current account", async (status) => {
    const oldRequest = deferred<Response>();
    let requests = 0;
    globalThis.fetch = (() => ++requests === 1 ? oldRequest.promise : Promise.resolve(response(vessel(456)))) as typeof fetch;
    mount();
    setUser({ id: "account-B" });
    await flush();
    expect(drawer!.treasury?.balances.spirit).toBe(456);
    oldRequest.resolve(status === 401 ? new Response(null, { status }) : response(vessel(123)));
    await flush();
    expect(drawer!.treasury?.balances.spirit).toBe(456);
    expect(JSON.parse(cache.get(CACHE_PREFIX + "account-B")!).balances.spirit).toBe(456);
  });

  test.each([true, false])("a failed account change uses only that account's cache (cached: %s)", async (cached) => {
    mount();
    await drawer!.refresh();
    if (cached) cache.set(CACHE_PREFIX + "account-B", JSON.stringify(vessel(456)));
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    setUser({ id: "account-B" });
    await flush();
    expect(drawer!.treasury?.balances.spirit ?? null).toBe(cached ? 456 : null);
    expect(drawer!.treasuryState).toBe(cached ? "reconnecting" : "error");
  });

  test("HTTP 401 clears the current account's cached balances", async () => {
    cache.set(CACHE_PREFIX + "account-A", JSON.stringify(vessel()));
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const host = mount();
    await drawer!.refresh();
    expect(host.textContent).toContain("Sign in with your Alchm account");
    expect(cache.has(CACHE_PREFIX + "account-A")).toBe(false);
  });

  test("closing during a request aborts it and prevents later cache writes", async () => {
    const request = deferred<Response>();
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_url, options) => { signal = options?.signal ?? undefined; return request.promise; }) as typeof fetch;
    const host = mount();
    drawer!.destroy();
    expect(signal?.aborted).toBe(true);
    request.resolve(response());
    await flush();
    expect(host.textContent).toBe("");
    expect(cache.has(CACHE_PREFIX + "account-A")).toBe(false);
  });

  test("a timer refresh shares an outstanding request instead of starving a slow response", async () => {
    const request = deferred<Response>();
    let requests = 0;
    globalThis.fetch = (() => { requests += 1; return request.promise; }) as typeof fetch;
    mount();
    const first = drawer!.refresh();
    const second = drawer!.refresh();
    request.resolve(response());
    await Promise.all([first, second]);
    expect(requests).toBe(1);
    expect(drawer!.treasury?.balances.spirit).toBe(123);
  });

  test("treasury keeps refreshing while an arena request is stalled", async () => {
    const playerRows = deferred<any[]>();
    spacetime.query = async (sql: string) => sql.includes("FROM player") ? playerRows.promise : [];
    mount();
    await flush();
    expect(drawer!.treasury?.balances.spirit).toBe(123);
    globalThis.fetch = (async () => response(vessel(456))) as typeof fetch;
    const refresh = drawer!.refresh();
    await flush();
    expect(drawer!.treasury?.balances.spirit).toBe(456);
    playerRows.resolve([{ identity: ME, tokens: 10, word_wins: 2 }]);
    await refresh;
  });

  test("reads the server player even when local simulation contains larger balances", async () => {
    mount();
    await drawer!.refresh();
    expect(drawer!.arena?.arenaTokens).toBe(10);
    expect(drawer!.arena?.wordWins).toBe(2);
  });

  test("an unavailable server player stays unavailable instead of showing local tokens", async () => {
    spacetime.query = async () => { throw new Error("offline"); };
    mount();
    await drawer!.refresh();
    expect(drawer!.arena?.arenaTokens).toBeNull();
    expect(drawer!.arena?.wordWins).toBeNull();
  });

  test("arena responses for a previous SpacetimeDB identity are discarded", async () => {
    const playerRows = deferred<any[]>();
    spacetime.query = async (sql: string) => sql.includes("FROM player") ? playerRows.promise : [];
    mount();
    const refresh = drawer!.refresh();
    spacetime.identity = "b".repeat(64);
    playerRows.resolve([{ identity: ME, tokens: 10, word_wins: 2 }]);
    await refresh;
    expect(drawer!.arena).toBeNull();
  });
});

describe("Vessel drawer keyboard access", () => {
  test("opening enters the dialog, Tab wraps, and closing restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    openVesselDrawer();
    await flush();
    const close = document.querySelector(".pv-close");
    expect(document.activeElement === close).toBe(true);
    const links = document.querySelectorAll?.("a") || document.body.querySelectorAll("a");
    const last = links[links.length - 1];
    last.focus();
    const tab = { type: "keydown", key: "Tab", shiftKey: false, preventDefault: mock(), stopPropagation() {} };
    document.dispatchEvent(tab);
    expect(document.activeElement === close).toBe(true);
    expect(tab.preventDefault).toHaveBeenCalled();
    document.dispatchEvent({ ...tab, shiftKey: true });
    expect(document.activeElement === last).toBe(true);
    closeVesselDrawer();
    expect(document.activeElement === opener).toBe(true);
  });

  test("handoff controls and their focus survive a data refresh", async () => {
    const host = mount();
    await drawer!.refresh();
    const transmute = host.querySelector("a");
    transmute.focus();
    await drawer!.refresh();
    expect(document.activeElement === transmute).toBe(true);
    expect(transmute.isConnected).toBe(true);
    expect(transmute.getAttribute("href")).toBe("https://alchm.kitchen/feed?tab=transmute");
  });

  test("sign-in focus survives refresh and stays inside the dialog when sign-in disappears", async () => {
    user = null;
    openVesselDrawer();
    await flush();
    document.querySelector(".pv-btn").focus();
    setUser(null);
    await flush();
    expect(document.activeElement === document.querySelector(".pv-btn")).toBe(true);
    setUser({ id: "account-A" });
    await flush();
    expect(document.activeElement === document.querySelector(".pv-close")).toBe(true);
  });

  test("repeated opens keep one Escape listener and restore the original opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    openVesselDrawer();
    openVesselDrawer();
    const escape = { type: "keydown", key: "Escape", preventDefault: mock(), stopPropagation() {} };
    document.dispatchEvent(escape);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement === opener).toBe(true);
    document.dispatchEvent(escape);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
  });

  test("restores a persistent return target when the My Pentacles launcher is removed", () => {
    const mainButton = document.createElement("button");
    mainButton.setAttribute("id", "my-pentacles-btn");
    const launcher = document.createElement("button");
    document.body.appendChild(mainButton);
    document.body.appendChild(launcher);
    launcher.focus();
    // My Pentacles destroys its drawer host before opening the Vessel.
    document.body.removeChild(launcher);
    openVesselDrawer({ returnTo: mainButton });
    closeVesselDrawer();
    expect(document.activeElement === mainButton).toBe(true);
  });
});
