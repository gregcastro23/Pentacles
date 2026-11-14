import catalogData from './historical-vessel-catalog.json';
import { presentVessel } from './vessel-presentation';
import type { RatedAgentPayload } from './rating-contract';

type CatalogBaseline = Pick<RatedAgentPayload, 'ratings' | 'ovr' | 'archetype' | 'esms' | 'seals'>;
// Shared display data cannot be edited by an inspector or become mutable game state.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const catalog = freeze(catalogData.agents) as Readonly<Record<string, CatalogBaseline>>;

/** Display-only fallback for a canonical NPC. Never inject baseline holdings into live payloads. */
export function presentVesselInspector(payload: RatedAgentPayload, now = Date.now()) {
  const view = presentVessel(payload, now);
  const baseline = payload.ratingSource === 'live' && (payload.provenance === 'historical' || payload.provenance === 'placeholder')
    && Object.hasOwn(catalog, payload.key) ? catalog[payload.key] : undefined;
  const catalogRatings = !view.available && !!baseline;
  const catalogElements = !view.esmsAvailable && !!baseline;
  return {
    ...view,
    ratings: view.available ? payload.ratings : baseline?.ratings ?? null,
    ovr: catalogRatings ? String(baseline!.ovr) : view.ovr,
    archetype: catalogRatings ? baseline!.archetype.title : view.archetype,
    esms: view.esms ?? baseline?.esms ?? null,
    seals: view.seals ?? baseline?.seals ?? null,
    catalogRatings, catalogElements,
    sourceLabel: catalogRatings ? 'Catalog baseline' : view.sourceLabel,
    snapshotLabel: catalogRatings ? 'Awaiting live snapshot' : view.snapshotLabel,
    baselineNote: catalogElements ? 'Catalog elemental values and seals are baseline attributes, not verified wallet holdings or earned live seals.' : '',
  };
}
