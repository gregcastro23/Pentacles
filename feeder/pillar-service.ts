// Pentacles — Fourteen Pillars Arena Companion Service.
//
// Subscribes to SpacetimeDB over WebSocket for OPEN 14-Pillars duels aimed at a
// planetary agent, asks the agent brain for the pillar and voice line,
// and answers each via the owner-gated `answer_pillar` reducer: the agent declares
// a counter pillar and a characterful voice line, resolving the duel.

import { startFeed } from "./stdb-feed";
import { cliCall, resolveFeederEnv } from "./spacetime-cli";
import { brainCall, BRAIN_PRIMARY_URL, BRAIN_FALLBACK_URL } from "./brain";

const { db: DB, uri: SPACETIMEDB_URI, token: SPACETIME_TOKEN } = resolveFeederEnv();

export const PILLAR_NAMES = [
  "Solution",
  "Filtration",
  "Evaporation",
  "Distillation",
  "Separation",
  "Rectification",
  "Calcination",
  "Comixion",
  "Purification",
  "Inhibition",
  "Fermentation",
  "Fixation",
  "Multiplication",
  "Protection",
] as const;

export type PillarName = typeof PILLAR_NAMES[number];

// SpacetimeDB 2.x sum variant camelCase encoder
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

async function answerPillar(duelId: number, pillar: string, voice: string): Promise<void> {
  const argPillar = { [lowerFirst(pillar)]: [] };
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/answer_pillar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([duelId, argPillar, voice]),
    });
    if (!res.ok) {
      throw new Error(`HTTP answer_pillar failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    await cliCall(DB, "answer_pillar", [duelId, { raw: JSON.stringify(argPillar) }, voice]);
  }
}

// Fallback pillar selections for each planet under Diurnal and Nocturnal skies
const AGENT_DEFAULT_PILLARS: Record<string, { diurnal: PillarName; nocturnal: PillarName }> = {
  Sun: { diurnal: "Rectification", nocturnal: "Protection" },
  Moon: { diurnal: "Purification", nocturnal: "Solution" },
  Mercury: { diurnal: "Distillation", nocturnal: "Filtration" },
  Venus: { diurnal: "Fixation", nocturnal: "Comixion" },
  Mars: { diurnal: "Calcination", nocturnal: "Fermentation" },
  Jupiter: { diurnal: "Rectification", nocturnal: "Multiplication" },
  Saturn: { diurnal: "Fixation", nocturnal: "Inhibition" },
  Uranus: { diurnal: "Evaporation", nocturnal: "Multiplication" },
  Neptune: { diurnal: "Distillation", nocturnal: "Solution" },
  Pluto: { diurnal: "Separation", nocturnal: "Fermentation" },
};

function fallbackVoice(planet: string, opening: string, answer: string): string {
  return `${planet} invokes ${answer} against your ${opening}, transmuting the elemental circuit.`;
}

export interface PillarDuelRow {
  duel_id: number | string;
  opening_pillar?: string;
  target_agent?: string | null;
  sky?: string;
  state?: string;
}

function isOpenAgentPillarDuel(row: PillarDuelRow): boolean {
  const agent = row.target_agent;
  return row.state === "Open" && typeof agent === "string" && /^[A-Za-z]+$/.test(agent);
}

async function backendPillarMove(
  planet: string,
  opening: string,
  sky: string
): Promise<{ pillar: string; voice: string } | null> {
  return brainCall<{ pillar: string; voice: string }>({
    path: "/api/agents/pillar",
    label: "Pillar",
    body: { planet, opening, sky, source: "pentacles-pillar-feeder" },
    validate: (json) =>
      json?.success === true &&
      typeof json.pillar === "string" &&
      PILLAR_NAMES.includes(json.pillar as PillarName)
        ? { pillar: json.pillar, voice: String(json.voice ?? "") }
        : null,
  });
}

async function processPillarDuel(row: PillarDuelRow): Promise<void> {
  const duelId = Number(row.duel_id);
  const opening = String(row.opening_pillar ?? "");
  const agent = typeof row.target_agent === "string" ? row.target_agent : "";
  const sky = String(row.sky ?? "Diurnal").toLowerCase();

  if (isNaN(duelId)) {
    console.error(`[Pillar] Skipping invalid duel row:`, row);
    return;
  }

  const planet = agent && /^[A-Za-z]+$/.test(agent) ? agent : "Sun";
  console.log(`[Pillar] Duel #${duelId}: ${planet} faces ${opening} under ${sky} sky`);

  const fromBackend = await backendPillarMove(planet, opening, sky);
  const defaults = AGENT_DEFAULT_PILLARS[planet] ?? { diurnal: "Calcination", nocturnal: "Solution" };
  const pillar = fromBackend?.pillar ?? (sky === "nocturnal" ? defaults.nocturnal : defaults.diurnal);
  const voice = fromBackend?.voice || fallbackVoice(planet, opening, pillar);

  try {
    await answerPillar(duelId, pillar, voice);
    console.log(`[Pillar] Duel #${duelId} answered with ${pillar}.`);
  } catch (err) {
    console.error(`[Pillar] Failed to answer #${duelId}:`, (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Fourteen Pillars companion starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Brain: ${BRAIN_PRIMARY_URL} (fallback ${BRAIN_FALLBACK_URL}; local archetypes last)`);
  console.log(`  Transport: WebSocket subscription + periodic /sql re-sweep
`);

  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "pillar_duel",
    query: "SELECT * FROM pillar_duel",
    idField: "duel_id",
    accept: isOpenAgentPillarDuel,
    label: "Pillar",
    onRow: processPillarDuel,
  });
}

if (import.meta.main) {
  main();
}
