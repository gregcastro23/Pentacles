// One-shot demo driver: register the owner as a Seeker, then cast a Word Duel
// against a planet — creating a duel_challenge the duel feeder will answer via
// the live agent brain. Owner-authed (HTTP /call with the cli.toml token).
//   SPACETIMEDB_DB=pentacles2xtest bun run scripts/duel-demo.ts [WORD] [PLANET]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const DB = process.env.SPACETIMEDB_DB ?? "pentacles2xtest";
const WORD = (process.argv[2] ?? "STAR").toUpperCase();
const OPP = (process.argv[3] ?? "Mars");

function token(): string {
  if (process.env.SPACETIME_TOKEN) return process.env.SPACETIME_TOKEN;
  const m = readFileSync(`${homedir()}/.config/spacetime/cli.toml`, "utf8").match(/^spacetimedb_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("no owner token");
  return m[1];
}
const TOKEN = token();
const planetEnum = (n: string) => ({ [n.charAt(0).toLowerCase() + n.slice(1)]: [] });

async function call(reducer: string, args: any[]) {
  const res = await fetch(`${URI}/v1/database/${DB}/call/${reducer}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.text().catch(() => "") };
}

const P = (body: string, sign: number, deg: number, dignity = 0) => ({ body: planetEnum(body), sign, arc_minutes: Math.round(deg * 60), retrograde: false, dignity });
// Sun-dominant chart → faction Sun is unambiguously top-3 (Leo rising + Sun in Leo, domicile/angular).
const chart = {
  identity: { __identity__: "0x" + "0".repeat(64) },
  birth_unix: Math.round(Date.UTC(1990, 6, 24, 12, 0, 0) / 1000),
  birth_lat: 40.71, birth_lon: -74.0, time_known: true,
  placements: [
    P("Sun", 4, 10, 5), P("Moon", 3, 15, 5), P("Mercury", 4, 2), P("Venus", 5, 20), P("Mars", 0, 8),
  ],
  ascendant: 4 * 1800 + 10 * 60, midheaven: 1 * 1800 + 0, // ASC Leo 10°
  house_cusps: { none: [] }, house_system: { placidus: [] }, intercepted_signs: { none: [] },
};

console.log(`▸ register owner as Seeker (faction Sun) on ${DB}`);
let r = await call("create_player", ["Demo Seeker", chart, planetEnum("Sun")]);
console.log(`  create_player → ${r.status} ${r.status === 200 ? "ok" : r.body}`);

console.log(`▸ cast Word Duel: "${WORD}" vs ${OPP}`);
r = await call("cast_word", [WORD, planetEnum(OPP)]);
console.log(`  cast_word → ${r.status} ${r.status === 200 ? "ok — challenge created" : r.body}`);
