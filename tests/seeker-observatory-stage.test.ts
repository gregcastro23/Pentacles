import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SACRED_STAT_KEYS } from '../src/lib/agents/rating-contract';
import {
  createVesselAvatarMesh,
  disposeVesselAvatar,
  setVesselRimUniforms,
  pulseVesselRelics,
} from '../src/lib/agents/vessel-avatar-3d';
import { CourtAudioSynth } from '../src/lib/agents/court-audio-synth';
import { SpringAnimator } from '../src/alchm-chart/seeker-stage/spring-animator.js';
import {
  HARMONIC_ATTUNEMENT_MULTIPLIER,
  PRE_SURGE_CEILING,
  computeNatalBaselineRatings,
  evaluateCardNatalAttunement,
  computeAstrolabeAspectChords,
  computeSeekerTelemetry,
  computeSeekerPreview,
} from '../src/alchm-chart/seeker-stage/seeker-rating-telemetry.js';
import MyPentacles from '../src/alchm-chart/my-pentacles.js';
import { createVesselDocument } from './helpers/vessel-dom';

function makeNatalChartFixture() {
  return {
    time_known: true,
    ascendant: 4 * 1800 + 12 * 60, // Leo 12° (Fire)
    midheaven: 0 * 1800 + 18 * 60, // Aries 18° (Fire)
    placements: [
      { body: 'Sun', sign: 4, arc_minutes: 15 * 60, retrograde: false, dignity: 5 },     // Leo 15° (Domicile)
      { body: 'Moon', sign: 8, arc_minutes: 14 * 60, retrograde: false, dignity: 0 },    // Sagittarius 14° (120° Trine to Sun)
      { body: 'Mercury', sign: 5, arc_minutes: 8 * 60, retrograde: false, dignity: 5 },  // Virgo 8°
      { body: 'Venus', sign: 3, arc_minutes: 21 * 60, retrograde: false, dignity: 0 },   // Cancer 21°
      { body: 'Mars', sign: 0, arc_minutes: 16 * 60, retrograde: false, dignity: 5 },    // Aries 16° (120° Trine to Sun & Moon)
      { body: 'Jupiter', sign: 3, arc_minutes: 9 * 60, retrograde: false, dignity: 4 },  // Cancer 9°
      { body: 'Saturn', sign: 9, arc_minutes: 22 * 60, retrograde: true, dignity: 5 },   // Capricorn 22°
      { body: 'Uranus', sign: 10, arc_minutes: 11 * 60, retrograde: false, dignity: 5 }, // Aquarius 11°
      { body: 'Neptune', sign: 11, arc_minutes: 6 * 60, retrograde: false, dignity: 4 }, // Pisces 6°
      { body: 'Pluto', sign: 7, arc_minutes: 24 * 60, retrograde: false, dignity: 5 },   // Scorpio 24°
    ],
  };
}

function makeSeekerStateFixture(overrides: Record<string, any> = {}) {
  const chart = makeNatalChartFixture();
  return {
    player: {
      handle: 'HermesSeeker',
      faction: 0, // Sun
      tokens: 2500,
      word_wins: 14,
      chart,
    },
    collection: [
      // Leo Wands pip (Conjunction with Natal Sun in Leo -> 1.15x Harmonic Attunement)
      {
        card_id: 101,
        suit: 'wands',
        rank: 6,
        is_major: false,
        sign_idx: 4,
        source_body: 5,
        attack: 18,
        health: 24,
        armour: 8,
        level: 1,
        cooldown_ms: 2100,
        letter: 'S',
        title: 'Six of Wands',
      },
      // Duplicate copy of Six of Wands for Crucible Fusion
      {
        card_id: 102,
        suit: 'wands',
        rank: 6,
        is_major: false,
        sign_idx: 4,
        source_body: 5,
        attack: 18,
        health: 24,
        armour: 8,
        level: 1,
        cooldown_ms: 2100,
        letter: 'S',
        title: 'Six of Wands',
      },
      // Aries Wands pip (120° Trine with Leo Six of Wands & Natal Sun)
      {
        card_id: 103,
        suit: 'wands',
        rank: 3,
        is_major: false,
        sign_idx: 0,
        source_body: 0,
        attack: 16,
        health: 22,
        armour: 7,
        level: 2,
        cooldown_ms: 2000,
        letter: 'A',
        title: 'Three of Wands',
      },
      // Gemini Swords pip (60° Sextile to Leo & Aries; unattuned to Fire/Virgo/Libra key bodies)
      {
        card_id: 104,
        suit: 'swords',
        rank: 9,
        is_major: false,
        sign_idx: 2,
        source_body: 4,
        attack: 19,
        health: 18,
        armour: 5,
        level: 1,
        cooldown_ms: 1750,
        letter: 'G',
        title: 'Nine of Swords',
      },
      // Taurus Pentacles pip (unattuned Earth card relative to Sun/Moon/Asc/Mercury/Venus/Mars)
      {
        card_id: 105,
        suit: 'pentacles',
        rank: 6,
        is_major: false,
        sign_idx: 1,
        source_body: 1,
        attack: 12,
        health: 28,
        armour: 14,
        level: 1,
        cooldown_ms: 2800,
        letter: 'T',
        title: 'Six of Pentacles',
      },
    ],
    deck: [
      { card_id: 101, loadout: 'active' },
      { card_id: 102, loadout: 'bench' },
      { card_id: 103, loadout: 'active' },
      { card_id: 104, loadout: 'active' },
      { card_id: 105, loadout: 'defense' },
    ],
    selectedCards: new Set<number>(),
    planets: [{ name: 'Sun', alt: -18, apparentAlt: -18, eclLon: 135 }],
    constellations: [],
    sky: [],
    save() {
      this.saved = true;
    },
    ...overrides,
  };
}

describe('Seeker Centralized Rating & Vernier Telemetry (25–99 Scale)', () => {
  test('Tier 1: 0/3 Siege cards yields a coherent Natal Vessel Floor (~48–68 OVR) without collapsing to 25', () => {
    const state = makeSeekerStateFixture();
    const baseline = computeNatalBaselineRatings(state.player.chart, state.player.faction);

    for (const key of SACRED_STAT_KEYS) {
      expect(baseline[key]).toBeGreaterThanOrEqual(45);
      expect(baseline[key]).toBeLessThanOrEqual(72);
    }

    const telemetry = computeSeekerTelemetry({ state });
    expect(telemetry.siegeCards).toHaveLength(0);
    expect(telemetry.ratedPayload.ovr).toBeGreaterThanOrEqual(48);
    expect(telemetry.ratedPayload.ovr).toBeLessThanOrEqual(68);
    expect(telemetry.ratedPayload.archetype.title.length).toBeGreaterThan(3);
  });

  test('Tier 2: Slotting Siege cards produces readable vernier deltas and rewards 1.15x Natal Harmonic Attunement', () => {
    const state = makeSeekerStateFixture();
    const emptyTel = computeSeekerTelemetry({ state });

    const attunedCard = state.collection[0]; // Six of Wands in Leo (Conjunction with Natal Sun)
    const unattunedCard = state.collection[3]; // Nine of Swords in Gemini (Air - no personal bodies in Air)

    const attResult = evaluateCardNatalAttunement(attunedCard, state.player.chart, 0);
    const nonAttResult = evaluateCardNatalAttunement(unattunedCard, state.player.chart, 0);

    expect(attResult.attuned).toBe(true);
    expect(attResult.multiplier).toBe(HARMONIC_ATTUNEMENT_MULTIPLIER);
    expect(nonAttResult.attuned).toBe(false);
    expect(nonAttResult.multiplier).toBe(1.0);

    // Preview slotting 1 attuned card -> readable vernier gains (+3..+9 on primary axes)
    const slotPreview = computeSeekerPreview(emptyTel, state, {
      mode: 'slot',
      card: attunedCard,
      slotIndex: 0,
    });
    expect(slotPreview).not.toBeNull();
    const maxAxisDelta = Math.max(...Object.values(slotPreview!.sacredDeltas) as number[]);
    expect(maxAxisDelta).toBeGreaterThanOrEqual(3);
    expect(maxAxisDelta).toBeLessThanOrEqual(11);
    expect(slotPreview!.ovrDelta).toBeGreaterThanOrEqual(2);
  });

  test('Tier 3: Pre-surge soft ceiling caps strictly <= 94 sub-horizon, unlocking 95–99 ONLY during active Horizon Surge', () => {
    // 3 high-level Lv 5 fused cards, but ruling Sun is sub-horizon (-25°)
    const highCards = [
      { card_id: 1, suit: 'wands', rank: 19, is_major: true, source_body: 0, attack: 38, health: 44, armour: 18, level: 5 },
      { card_id: 2, suit: 'wands', rank: 6, is_major: false, sign_idx: 4, source_body: 0, attack: 34, health: 38, armour: 14, level: 5 },
      { card_id: 3, suit: 'wands', rank: 3, is_major: false, sign_idx: 0, source_body: 0, attack: 32, health: 36, armour: 14, level: 5 },
    ];
    const subHorizonState = makeSeekerStateFixture({
      collection: highCards,
      deck: highCards.map((c) => ({ card_id: c.card_id, loadout: 'active' })),
      selectedCards: new Set([1, 2, 3]),
      planets: [{ name: 'Sun', alt: -25, apparentAlt: -25, eclLon: 135 }],
      constellations: [],
      sky: [],
    });

    const subTel = computeSeekerTelemetry({ state: subHorizonState });
    expect(subTel.horizonDignity.exalted).toBe(false);
    expect(subTel.ratedPayload.surge.active).toBe(false);
    expect(subTel.ratedPayload.ovr).toBeLessThanOrEqual(PRE_SURGE_CEILING);
    for (const key of SACRED_STAT_KEYS) {
      expect(subTel.ratedPayload.ratings[key]).toBeLessThanOrEqual(PRE_SURGE_CEILING);
    }

    // Now exalt the ruling Sun on the ascendant horizon band (+8°) + open a matching Spirit constellation pool
    const exaltedState = makeSeekerStateFixture({
      collection: highCards,
      deck: highCards.map((c) => ({ card_id: c.card_id, loadout: 'active' })),
      selectedCards: new Set([1, 2, 3]),
      planets: [{ name: 'Sun', alt: 8, apparentAlt: 8.2, eclLon: 135 }],
      constellations: [
        { name: 'Leo', tradeable: true, pair: [0, 2], visibleCount: 7, memberCount: 9 },
      ],
      sky: [{ name: 'Regulus', horizonEncounter: true, magnitude: 1.35, alt: 6.4 }],
    });

    const exaltedTel = computeSeekerTelemetry({ state: exaltedState });
    expect(exaltedTel.horizonDignity.exalted).toBe(true);
    expect(exaltedTel.ratedPayload.surge.active).toBe(true);

    const peakStat = Math.max(...Object.values(exaltedTel.ratedPayload.ratings) as number[]);
    expect(peakStat).toBeGreaterThanOrEqual(95);
    expect(peakStat).toBeLessThanOrEqual(99);
    expect(exaltedTel.ratedPayload.ovr).toBeGreaterThan(subTel.ratedPayload.ovr);
  });

  test('Crucible Fusion Preview & Sacred Astrolabe Aspect Chords (Trine, Sextile, Conjunction)', () => {
    const state = makeSeekerStateFixture({
      selectedCards: new Set([101, 103, 104]), // Leo (4), Aries (0), Gemini (2)
    });
    const tel = computeSeekerTelemetry({ state });

    // Leo <-> Aries = 120° Trine; Leo <-> Gemini & Aries <-> Gemini = 60° Sextile; Leo <-> Natal Sun = Conjunction
    const chordTypes = new Set(tel.aspectChords.map((c: any) => c.type));
    expect(chordTypes.has('trine')).toBe(true);
    expect(chordTypes.has('sextile')).toBe(true);
    expect(chordTypes.has('conjunction')).toBe(true);

    // Duplicate fusion preview: Six of Wands #101 (Lv 1) + #102 (Lv 1) -> Lv 2
    const fusePreview = computeSeekerPreview(tel, state, {
      mode: 'fuse',
      keepCard: state.collection[0],
      consumeCard: state.collection[1],
    });
    expect(fusePreview).not.toBeNull();
    expect(fusePreview!.fusedPreviewCard.level).toBe(2);
    expect(fusePreview!.siegeDeltas.attack).toBeGreaterThan(0);
    expect(fusePreview!.siegeDeltas.health).toBeGreaterThan(0);
  });
});

describe('SpringAnimator, Vessel Rim Shaders & Esoteric CourtAudioSynth', () => {
  test('SpringAnimator converges deterministically to target channels and disposes cleanly', () => {
    let latest: Record<string, number> = {};
    const spring = new SpringAnimator({
      stiffness: 320,
      damping: 30,
      onFrame: (vals: Record<string, number>) => {
        latest = { ...vals };
      },
    });

    spring.setTargets({ spirit: 25, essence: 25 }, { immediate: true });
    expect(latest.spirit).toBe(25);

    // Enable manual stepping by temporarily stubbing requestAnimationFrame
    const prevRaf = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = () => 1;
    try {
      spring.setTargets({ spirit: 80, essence: 40 });
      let moving = true;
      for (let i = 0; i < 60 && moving; i++) {
        moving = spring.step(1 / 60);
      }
      expect(moving).toBe(false);
      expect(latest.spirit).toBe(80);
      expect(latest.essence).toBe(40);
    } finally {
      (globalThis as any).requestAnimationFrame = prevRaf;
      spring.dispose();
    }
  });

  test('setVesselRimUniforms and pulseVesselRelics update Vessel Avatar materials in-place', () => {
    const state = makeSeekerStateFixture({ selectedCards: new Set([101]) });
    const tel = computeSeekerTelemetry({ state });
    const avatar = createVesselAvatarMesh(tel.ratedPayload, { loadModelAsync: false });

    try {
      setVesselRimUniforms(avatar, { color: '#f59e0b', power: 2.4, intensity: 0.92 });
      const torsoMesh = avatar.getObjectByName('TorsoMesh') as THREE.Mesh;
      const rim = (torsoMesh.material as THREE.MeshStandardMaterial).userData.fresnelRim;
      expect(rim.power).toBeCloseTo(2.4, 3);
      expect(rim.intensity).toBeCloseTo(0.92, 3);
      expect(rim.color.getHexString()).toBe('f59e0b');

      pulseVesselRelics(avatar, { crownBoost: 0.5, coreBoost: 0.4, relicBoost: 0.3 });
      expect(avatar.userData.circlet.material.emissiveIntensity).toBeCloseTo(1.35, 2);
      expect(avatar.userData.coreGem.material.emissiveIntensity).toBeCloseTo(1.3, 2);
    } finally {
      disposeVesselAvatar(avatar);
    }
  });

  test('CourtAudioSynth synthesizes esoteric foley and respects window.synth.muted', () => {
    let nodesStarted = 0;
    const fakeGainParam = {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    const fakeCtx = {
      state: 'running',
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      createBuffer: (_ch: number, len: number) => ({
        length: len,
        getChannelData: () => new Float32Array(len),
      }),
      createBufferSource: () => ({
        buffer: null,
        connect: () => {},
        disconnect: () => {},
        stop: () => {},
        start: () => {
          nodesStarted++;
        },
      }),
      createOscillator: () => ({
        type: 'sine',
        frequency: fakeGainParam,
        connect: () => {},
        start: () => {
          nodesStarted++;
        },
        stop: () => {},
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: fakeGainParam,
        Q: fakeGainParam,
        connect: () => {},
      }),
      createGain: () => ({
        gain: fakeGainParam,
        connect: () => {},
      }),
      close: async () => {},
    };

    const prevWin = (globalThis as any).window;
    (globalThis as any).window = {
      AudioContext: function () {
        return fakeCtx;
      },
      synth: { muted: false },
    };

    const audio = new CourtAudioSynth();
    try {
      audio.triggerCardBrush();
      expect(nodesStarted).toBe(1);

      // Rapid sweep within 40ms (e.g. +18ms) is debounced to prevent stacking
      fakeCtx.currentTime = 0.018;
      audio.triggerCardBrush();
      expect(nodesStarted).toBe(1);

      // Sweep after 40ms (e.g. +65ms) steals the active voice and plays cleanly
      fakeCtx.currentTime = 0.065;
      audio.triggerCardBrush();
      expect(nodesStarted).toBe(2);

      audio.triggerAstrolabeDetent(340);
      expect(nodesStarted).toBe(4); // 2 damped oscillators

      audio.triggerCrucibleHarmonic(432);
      expect(nodesStarted).toBe(6); // root + Pythagorean 3:2 fifth

      // Mute globally via window.synth.muted -> zero new nodes started
      (globalThis as any).window.synth.muted = true;
      audio.triggerCardBrush();
      audio.triggerAstrolabeDetent();
      audio.triggerCrucibleHarmonic();
      expect(nodesStarted).toBe(6);
    } finally {
      audio.dispose();
      (globalThis as any).window = prevWin;
    }
  });
});

describe('3-Zone MyPentacles Hermetic Observatory UI & Interactions', () => {
  test('Mounts 3 zones, projects vernier hover deltas in-place, slots Siege cards, and fuses duplicates', () => {
    const prevDoc = (globalThis as any).document;
    const prevWin = (globalThis as any).window;
    const doc = createVesselDocument();

    const reducerCalls: Array<{ name: string; args: any[] }> = [];
    const state = makeSeekerStateFixture();

    (globalThis as any).document = doc;
    (globalThis as any).window = {
      state,
      Pentacles: {
        net: {
          isLive: true,
          callReducer: async (name: string, args: any[]) => {
            reducerCalls.push({ name, args });
          },
        },
      },
      renderActiveHand: () => {},
      renderCollection: () => {},
    };

    const hostEl = doc.createElement('div');
    doc.body.appendChild(hostEl);

    const inst = MyPentacles.create({ el: hostEl, state });
    try {
      inst.mount();

      // Verify 3-column Observatory layout zones
      expect(hostEl.querySelector('.mc-zone--left')).not.toBeNull();
      expect(hostEl.querySelector('.mc-zone--center')).not.toBeNull();
      expect(hostEl.querySelector('.mc-zone--right')).not.toBeNull();
      expect(hostEl.querySelector('.svs-astrolabe')).not.toBeNull();

      // Verify interactive Natal Astrolabe planet nodes
      const planetNodes = hostEl.querySelectorAll('.svs-planet-node');
      expect(planetNodes.length).toBe(10);
      const sunNode = hostEl.querySelector('.svs-planet-node[data-body-idx="0"]');
      expect(sunNode).not.toBeNull();
      sunNode!.dispatchEvent({ type: 'pointerenter' });
      const readoutText = hostEl.querySelector('.svs-readout-bar')?.textContent || '';
      expect(readoutText).toContain('Leo');
      expect(readoutText).toContain('6 of Wands');

      // Hover a card in Zone 3 -> verify brass vernier delta updates in-place without destroying DOM
      const ovrBefore = hostEl.querySelector('.mc-ovr-value')?.textContent;
      const cards = hostEl.querySelectorAll('.mc-card');
      expect(cards.length).toBe(5);
      cards[0].dispatchEvent({ type: 'pointerenter' });
      const deltaText = hostEl.querySelector('.mc-ovr-delta')?.textContent || '';
      expect(deltaText.startsWith('+')).toBe(true);

      // Clear hover -> restores baseline OVR
      inst._clearCardHover();
      expect(hostEl.querySelector('.mc-ovr-value')?.textContent).toBe(ovrBefore);

      // Equip Six of Wands (#101) into Siege Loadout
      inst._toggleSiegeCard(101);
      expect(state.selectedCards.has(101)).toBe(true);
      expect(hostEl.querySelectorAll('.mc-siege-slot.is-filled').length).toBe(1);

      // Enter Crucible Fusion mode -> camera switches to 'crucible' framing
      expect(inst._vesselStage.framing).toBe('observatory');
      inst.fuseMode = true;
      inst.paint();
      expect(inst._vesselStage.framing).toBe('crucible');

      // Execute Duplicate Card Fusion (#101 + #102 -> #101 becomes Lv 2, combine_cards reducer called)
      const fusedOk = inst._executeCardFusion(state.collection[0], state.collection[1]);
      expect(fusedOk).toBe(true);
      const upgraded = state.collection.find((c: any) => c.card_id === 101);
      expect(upgraded?.level).toBe(2);
      expect(state.collection.find((c: any) => c.card_id === 102)).toBeUndefined();
      expect(reducerCalls.some((r) => r.name === 'combine_cards' && r.args[0] === 101 && r.args[1] === 102)).toBe(true);

      // Switch to Natal & Decans tab -> renders full 10-planet placements & Golden Dawn Decans
      inst.leftTab = 'natal';
      inst.paint();
      expect(hostEl.querySelectorAll('.mc-place').length).toBe(10);
      expect(hostEl.querySelectorAll('.mc-decan').length).toBe(10);
    } finally {
      inst.destroy();
      expect(inst._vesselStage).toBeNull();
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWin;
    }
  });
});
