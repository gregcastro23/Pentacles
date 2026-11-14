import { ratingFeedStatus, RATING_MAX_AGE_MS } from './agent-rating-feed';
import type { RatedAgentPayload } from './rating-contract';
import { createVesselPortraitSvg, resolveAgentAppearance, VESSEL_RELIC_LABELS } from './vessel-appearance-manifest';

const portraitCache = new WeakMap<RatedAgentPayload, {
  input: RatedAgentPayload['appearance']; key: string; faction: number; archetype: string;
  appearance: ReturnType<typeof resolveAgentAppearance>; portrait: string; fallbackPortrait: string;
}>();

/** One identity and measurement policy for the map, inspector and vessel card. */
export function presentVessel(payload: RatedAgentPayload, now = Date.now()) {
  const status = ratingFeedStatus(payload, now);
  const available = status !== 'pending';
  let identity = portraitCache.get(payload);
  if (!identity || identity.input !== payload.appearance || identity.key !== payload.key || identity.faction !== payload.faction
    || identity.archetype !== payload.archetype.title) {
    const appearance = payload.appearance ?? resolveAgentAppearance(payload.key, payload.faction, payload.archetype);
    const fallbackPortrait = createVesselPortraitSvg(appearance);
    const candidate = appearance.portraitUrl ?? appearance.portraitSvgDataUri;
    const portrait = candidate && /^(?:data:image\/(?:svg\+xml|png|jpeg|webp)[;,]|https?:\/\/|\/(?!\/))/i.test(candidate)
      ? candidate : fallbackPortrait;
    identity = { input: payload.appearance, key: payload.key, faction: payload.faction, archetype: payload.archetype.title, appearance, portrait, fallbackPortrait };
    portraitCache.set(payload, identity);
  }
  const { appearance, portrait, fallbackPortrait } = identity;
  const esmsAvailable = available && (status === 'example' || payload.ratingFeed?.esmsAvailable === true);
  const skyAvailable = available && (status === 'example' || payload.ratingFeed?.skyAvailable === true);
  const receivedAt = payload.ratingFeed?.receivedAt;
  const minutes = Math.max(0, Math.floor((now - (receivedAt ?? now)) / 60000));
  const age = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago`
    : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return {
    key: payload.key, name: payload.handle, appearance, portrait, fallbackPortrait,
    status, available, esmsAvailable, skyAvailable,
    sourceLabel: { pending: 'Ratings pending', current: 'Live rating', partial: 'Partial live rating', stale: 'Stale rating', example: 'Example ratings' }[status],
    snapshotLabel: receivedAt == null ? status === 'example' ? 'Sample snapshot' : 'Awaiting first snapshot'
      : `Updated ${age}`,
    snapshotTimestamp: receivedAt == null ? '' : new Date(receivedAt).toISOString(),
    receivedAt,
    ovr: available ? String(payload.ovr) : '—',
    archetype: available ? payload.archetype.title : 'Ratings pending',
    relic: VESSEL_RELIC_LABELS[appearance.signatureRelic],
    esms: esmsAvailable ? payload.esms : null,
    seals: esmsAvailable ? payload.seals : null,
    surge: skyAvailable ? payload.surge : null,
  };
}

/** One timer at the next visible age/status boundary, with no network polling. */
export function nextVesselFreshnessUpdate(payload: RatedAgentPayload, now = Date.now()): number | null {
  const receivedAt = payload.ratingFeed?.receivedAt;
  if (receivedAt == null) return null;
  const age = Math.max(0, now - receivedAt);
  const unit = age < 3_600_000 ? 60_000 : age < 86_400_000 ? 3_600_000 : 86_400_000;
  const nextAge = Math.max(0, receivedAt - now) + unit - age % unit;
  const untilStale = receivedAt + RATING_MAX_AGE_MS + 1 - now;
  return Math.max(1, untilStale > 0 ? Math.min(nextAge, untilStale) : nextAge);
}

export function vesselActivity(payload: RatedAgentPayload, state?: string, destination?: string): string {
  if (destination) return `Travelling to ${destination}`;
  if (state === 'victory') return 'Celebrating a trick win';
  if (state === 'stagger') return 'Recovering from a lost trick';
  if (state === 'contest-attack' || state === 'contest-defend') return 'Contesting territory';
  const skyAvailable = payload.ratingFeed ? payload.ratingFeed.skyAvailable : payload.ratingSource !== 'live' && !payload.isPlaceholder;
  return skyAvailable && payload.surge.active ? 'Resonance surge active' : 'Holding position';
}

const balances = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const formatVesselBalance = (value: number): string => balances.format(value);

const portraitBindings = new WeakMap<HTMLImageElement, { requested: string; fallback: string; failed: boolean }>();
/** Keep image nodes and failed-source fallbacks stable across live refreshes. */
export function updateVesselPortrait(image: HTMLImageElement, view: ReturnType<typeof presentVessel>): void {
  let binding = portraitBindings.get(image);
  if (!binding) {
    binding = { requested: '', fallback: '', failed: false };
    portraitBindings.set(image, binding);
    image.addEventListener('error', () => {
      const current = portraitBindings.get(image)!;
      if (current.failed) return;
      current.failed = true;
      image.setAttribute('src', current.fallback);
    });
  }
  if (binding.requested !== view.portrait || binding.fallback !== view.fallbackPortrait) {
    binding.requested = view.portrait;
    binding.fallback = view.fallbackPortrait;
    binding.failed = false;
    image.setAttribute('src', view.portrait);
  }
  image.setAttribute('alt', `Portrait of ${view.name}`);
}
