// Pentacles — shared agent-brain HTTP routing: primary → fallback → caller-local.
//
// The word-duel and jing move endpoints are being ported from the AlchmAgents
// Next.js app (Vercel) to the planetary-agents FastAPI backend (Railway). Until
// the port ships, the primary may 404. brainCall therefore tries the PRIMARY
// (PLANETARY_AGENTS_BACKEND_URL, default https://api.agents.alchm.kitchen) and
// on ANY failure — network error, timeout, non-2xx, malformed JSON, or a body
// that fails the caller's contract check — logs one concise line and retries
// the SAME payload against the FALLBACK (BRAIN_FALLBACK_URL, default
// https://alchm-agents-eth.vercel.app, the original Next.js brain). Only when
// BOTH fail does it return null, so the calling service can use its local
// fallback (duel: greedy candidate; jing: counter graph).
//
// Each attempt is individually bounded by BRAIN_TIMEOUT_MS, so a wedged
// primary can never push a call's total latency past ~2× the timeout.
//
// BRAIN_PRIMARY_URL doubles as PA_URL elsewhere: the oracle's live-sky
// enrichment (GET /planetary/current) and the supervisor's /health probe both
// target the same planetary-agents backend, so they import it from here.

export const BRAIN_PRIMARY_URL = (
  process.env.PLANETARY_AGENTS_BACKEND_URL ?? "https://api.agents.alchm.kitchen"
).replace(/\/+$/, "");

export const BRAIN_FALLBACK_URL = (
  process.env.BRAIN_FALLBACK_URL ?? "https://alchm-agents-eth.vercel.app"
).replace(/\/+$/, "");

const BRAIN_TIMEOUT_MS = 15_000; // per attempt (primary and fallback each get one)

export interface BrainCallOptions<T> {
  /** Endpoint path appended to each base URL, e.g. "/api/agents/word-duel". */
  path: string;
  /** JSON POST payload — sent byte-identical to primary and fallback. */
  body: unknown;
  /** Log prefix, e.g. "WordDuel". */
  label: string;
  /** Contract check: extract the usable result from the response JSON, or
   *  return null to treat the body as contract-violating (counts as failure). */
  validate: (json: any) => T | null;
  /** Per-attempt timeout override in ms (default BRAIN_TIMEOUT_MS). */
  timeoutMs?: number;
}

const reason = (err: unknown): string =>
  (((err as Error)?.message || String(err)).split("\n")[0] || "unknown error").slice(0, 120);

async function attempt<T>(base: string, opts: BrainCallOptions<T>): Promise<T> {
  const res = await fetch(`${base}${opts.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? BRAIN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json(); // malformed body throws here
  const out = opts.validate(json);
  if (out === null || out === undefined) throw new Error("contract-violating body");
  return out;
}

// Try primary, then fallback; null only when both fail (caller goes local).
export async function brainCall<T>(opts: BrainCallOptions<T>): Promise<T | null> {
  try {
    return await attempt(BRAIN_PRIMARY_URL, opts);
  } catch (err) {
    console.warn(
      `[${opts.label}] brain primary ${BRAIN_PRIMARY_URL}${opts.path} failed (${reason(err)}); ` +
        `retrying fallback ${BRAIN_FALLBACK_URL}.`,
    );
  }
  try {
    return await attempt(BRAIN_FALLBACK_URL, opts);
  } catch (err) {
    console.warn(
      `[${opts.label}] brain fallback ${BRAIN_FALLBACK_URL}${opts.path} failed (${reason(err)}); ` +
        `using local fallback.`,
    );
    return null;
  }
}
