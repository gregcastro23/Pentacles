/* ============================================================
   PENTACLES — Web Client Game Logic
   ============================================================ */

// ---- ASTROLOGICAL CONSTANTS ----
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_COLORS = [
  "#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", 
  "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"
];

const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_SUITS = ["wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups"];
const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];
const PLANET_SUITS = ["wands", "cups", "swords", "cups", "wands", "wands", "pentacles", "swords", "cups", "swords"];

const SUIT_GLYPHS = { cups: "♥", swords: "♠", pentacles: "♦", wands: "♣" };
const SUIT_NAMES = { cups: "Cups", swords: "Swords", pentacles: "Pentacles", wands: "Wands" };
const OPPOSITE_SUITS = { wands: "cups", cups: "wands", swords: "pentacles", pentacles: "swords" };

const TRUMP_NAMES = ["The Sun", "The High Priestess", "The Magician", "The Empress", "The Tower", "Wheel of Fortune", "The World", "The Fool", "The Hanged Man", "Judgement"];
const TRUMP_ARCANA = ["XIX", "II", "I", "III", "XVI", "X", "XXI", "0", "XII", "XX"];
const TRUMP_MAJOR_INDEX = [19, 2, 1, 3, 16, 10, 21, 0, 12, 20];

function isFixedSign(sign) {
  return [1, 4, 7, 10].includes(sign % 12);
}

function isCardinalSign(sign) {
  return [0, 3, 6, 9].includes(sign % 12);
}

function decan(degree) {
  return Math.min(2, Math.floor(degree / 10));
}

function pipRank(sign, degree) {
  const base = isCardinalSign(sign) ? 2 : (isFixedSign(sign) ? 5 : 8);
  return base + decan(degree);
}

function courtRank(dignity) {
  if (dignity >= 5) return 14;
  if (dignity >= 3) return 13;
  if (dignity >= 1) return 12;
  return 11;
}

function rankName(rank) {
  const pips = ["", "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const courts = { 11: "Page", 12: "Knight", 13: "Queen", 14: "King" };
  return courts[rank] || pips[rank] || "Card";
}

function absoluteMinutes(placement) {
  return placement.sign * 1800 + placement.arc_minutes;
}

function circularDistance(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 21600 - diff);
}

function isAngularPlacement(placement, chart) {
  const pos = absoluteMinutes(placement);
  return circularDistance(pos, chart.ascendant) < 600 || circularDistance(pos, chart.midheaven) < 600;
}

function calculateReceptionBoosts(chart) {
  const boosts = new Array(10).fill(0);
  chart.placements.forEach(p => {
    const ruler = SIGN_RULERS[p.sign];
    if (ruler !== p.body) boosts[p.body] += 0.5;
  });

  for (let i = 0; i < chart.placements.length; i++) {
    for (let j = i + 1; j < chart.placements.length; j++) {
      const a = chart.placements[i];
      const b = chart.placements[j];
      if (SIGN_RULERS[a.sign] === b.body && SIGN_RULERS[b.sign] === a.body) {
        boosts[a.body] += 1.5;
        boosts[b.body] += 1.5;
      }
    }
  }

  return boosts;
}

function elementWeather(suit, favoredSuit) {
  if (suit === favoredSuit) return 1.35;
  if (suit === OPPOSITE_SUITS[favoredSuit]) return 0.75;
  return 1.0;
}

function levelMultiplier(level) {
  return 1.0 + 0.5 * (1.0 - Math.pow(0.6, Math.max(1, level) - 1));
}

function sealedSuitsForFaction(factionId) {
  if (factionId === null || factionId === undefined) return new Set();
  return new Set(state.map.filter(zone => zone.owner === factionId).map(zone => SIGN_SUITS[zone.zone_id % 12]));
}

function sealMultiplier(suit, sealedSuits) {
  return sealedSuits.has(suit) ? 1.15 : 1.0;
}

// ---- WEB AUDIO SYNTHESIZER ENGINE ----
class CosmicSynth {
  constructor() {
    this.ctx = null;
    this.ambience = null;
    this.gain = null;
    this.muted = true;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gain = this.ctx.createGain();
    this.gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    this.gain.connect(this.ctx.destination);
    
    // Start ambient celestial drone
    this.startAmbience();
  }

  toggleMute() {
    this.init();
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    this.muted = !this.muted;
    this.gain.gain.setValueAtTime(this.muted ? 0.0 : 0.08, this.ctx.currentTime);
    return this.muted;
  }

  startAmbience() {
    // Celestial deep space drone (two detuned low sine/triangle oscillators)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(65.41, this.ctx.currentTime); // C2

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(65.75, this.ctx.currentTime); // slightly detuned

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(0.1, this.ctx.currentTime); // very slow swell
    lfoGain.gain.setValueAtTime(0.02, this.ctx.currentTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(220, this.ctx.currentTime);

    // Wire up
    lfo.connect(lfoGain);
    lfoGain.connect(this.gain.gain); // Swell volume dynamically
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(this.gain);

    osc1.start();
    osc2.start();
    lfo.start();
  }

  playChime(freq, type = "sine", duration = 0.5) {
    if (this.muted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    noteGain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    noteGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(noteGain);
    noteGain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playClick() { this.playChime(600, "sine", 0.08); }
  playSelect() { this.playChime(880, "sine", 0.15); }
  playFuse() {
    this.playChime(440, "triangle", 0.3);
    setTimeout(() => this.playChime(659.25, "sine", 0.4), 100);
    setTimeout(() => this.playChime(880, "sine", 0.5), 200);
  }
  playStrike() {
    if (this.muted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const noise = this.ctx.createOscillator(); // low rumble
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.3);

    noise.type = "triangle";
    noise.frequency.setValueAtTime(60, this.ctx.currentTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(300, this.ctx.currentTime);

    g.gain.setValueAtTime(0.2, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);

    osc.connect(filter);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);

    osc.start();
    noise.start();
    osc.stop(this.ctx.currentTime + 0.4);
    noise.stop(this.ctx.currentTime + 0.4);
  }
  playFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major arpeggio
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playChime(freq, "sine", 0.6), idx * 120);
    });
  }
}

const synth = new CosmicSynth();

// ---- DETERMINISTIC SEED & PLACEMENT CALCULATOR ----
function deriveLocalNatalChart(seedStr) {
  // Deterministic browser-side chart preview for the standalone client.
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) {
    s = (s << 5) - s + seedStr.charCodeAt(i);
    s |= 0;
  }
  const random = () => {
    s = Math.sin(s++) * 10000;
    return s - Math.floor(s);
  };

  const placements = [];
  // Generate the 10 planetary placements used by the submission deck.
  for (let i = 0; i < 10; i++) {
    const sign = Math.floor(random() * 12);
    const degree = Math.floor(random() * 30);
    const minute = Math.floor(random() * 60);
    const retrograde = random() < 0.22;
    // Lightweight dignity approximation; the Unity client uses full chart math.
    let dignity = 0; // neutral
    if (SIGN_RULERS[sign] === i) {
      dignity = 5; // Rulership
    } else if ((i === 5 && sign === 11) || (i === 0 && sign === 0)) {
      dignity = 3; // Exaltation
    } else if ((i === 4 && sign === 6) || (i === 6 && sign === 2)) {
      dignity = -3; // Detriment
    } else if (random() < 0.15) {
      dignity = -5; // Fall
    }

    placements.push({
      body: i,
      sign: sign,
      arc_minutes: degree * 60 + minute,
      retrograde: retrograde,
      dignity: dignity
    });
  }

  // Ascendant & Midheaven
  const ascendant = Math.floor(random() * 360 * 60);
  const midheaven = Math.floor(random() * 360 * 60);

  return { placements, ascendant, midheaven };
}

function scoreFactions(chart) {
  const scores = new Array(10).fill(0);
  const ascSign = Math.floor(chart.ascendant / 1800) % 12;
  scores[SIGN_RULERS[ascSign]] += 3.0;

  chart.placements.forEach(p => {
    scores[p.body] += 1.0 + p.dignity * 0.4;
    if (isAngularPlacement(p, chart)) scores[p.body] += 1.5;

    if (p.body === 0 || p.body === 1) {
      scores[SIGN_RULERS[p.sign]] += 2.0;
    }
  });

  const receptionBoosts = calculateReceptionBoosts(chart);
  receptionBoosts.forEach((boost, idx) => {
    scores[idx] += boost;
  });

  // Convert to sorted faction picks
  const sorted = scores.map((val, idx) => ({ id: idx, score: Math.round(val) }));
  sorted.sort((a, b) => b.score - a.score);
  return sorted.slice(0, 3);
}

// ---- GAME STATE MANAGER ----
class GameState {
  constructor() {
    this.player = null;
    this.collection = [];
    this.deck = [];
    this.map = [];
    this.selectedCards = new Set();
    this.selectedStar = null;
    this.selectedZone = null;
    this.leaderboard = [];
    this.seasonDegree = 0;
  }

  load() {
    // 1. Get active profile handle
    let activeHandle = localStorage.getItem("pentacles_active_profile");
    
    // 2. Fallback/migrate legacy single-profile save
    if (!activeHandle) {
      const rawLegacy = localStorage.getItem("pentacles_save");
      if (rawLegacy) {
        try {
          const data = JSON.parse(rawLegacy);
          if (data.player && data.player.handle) {
            activeHandle = data.player.handle;
            localStorage.setItem("pentacles_active_profile", activeHandle);
            localStorage.setItem(`pentacles_save_${activeHandle}`, rawLegacy);
            this.addProfileToList(activeHandle);
            localStorage.removeItem("pentacles_save");
          }
        } catch (e) {
          console.error("Failed legacy migration", e);
        }
      }
    }

    if (activeHandle) {
      const raw = localStorage.getItem(`pentacles_save_${activeHandle}`);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          this.player = data.player;
          this.collection = data.collection;
          this.deck = data.deck;
          this.map = data.map;
          this.leaderboard = data.leaderboard;
          this.seasonDegree = data.seasonDegree || 0;
          return true;
        } catch (e) {
          console.error("Failed parsing profile state", e);
        }
      }
    }
    
    this.initDefaultMap();
    return false;
  }

  save() {
    if (!this.player || !this.player.handle) return;
    const activeHandle = this.player.handle;
    
    const data = {
      player: this.player,
      collection: this.collection,
      deck: this.deck,
      map: this.map,
      leaderboard: this.leaderboard,
      seasonDegree: this.seasonDegree
    };
    
    localStorage.setItem(`pentacles_save_${activeHandle}`, JSON.stringify(data));
    localStorage.setItem("pentacles_active_profile", activeHandle);
    this.addProfileToList(activeHandle);
  }

  addProfileToList(handle) {
    let list = [];
    const rawList = localStorage.getItem("pentacles_profiles_list");
    if (rawList) {
      try {
        list = JSON.parse(rawList);
      } catch (e) {}
    }
    if (!list.includes(handle)) {
      list.push(handle);
      localStorage.setItem("pentacles_profiles_list", JSON.stringify(list));
    }
  }

  getProfilesList() {
    const rawList = localStorage.getItem("pentacles_profiles_list");
    if (rawList) {
      try {
        return JSON.parse(rawList);
      } catch (e) {}
    }
    return [];
  }

  switchProfile(handle) {
    localStorage.setItem("pentacles_active_profile", handle);
    return this.load();
  }

  deleteProfile(handle) {
    localStorage.removeItem(`pentacles_save_${handle}`);
    let list = this.getProfilesList().filter(h => h !== handle);
    localStorage.setItem("pentacles_profiles_list", JSON.stringify(list));
    
    const activeHandle = localStorage.getItem("pentacles_active_profile");
    if (activeHandle === handle) {
      if (list.length > 0) {
        localStorage.setItem("pentacles_active_profile", list[0]);
      } else {
        localStorage.removeItem("pentacles_active_profile");
      }
    }
  }

  reset() {
    if (this.player && this.player.handle) {
      this.deleteProfile(this.player.handle);
    }
    this.player = null;
    this.collection = [];
    this.deck = [];
    this.selectedCards.clear();
    this.selectedStar = null;
    this.selectedZone = null;
    this.initDefaultMap();
  }

  initDefaultMap() {
    // Inits 11 zones
    this.map = [];
    const kinds = ["house", "house", "house", "house", "house", "spire", "spire", "spire", "spire", "spire", "crown"];
    for (let i = 0; i < 11; i++) {
      this.map.push({
        zone_id: i,
        kind: kinds[i],
        owner: null, // neutral
        control: 0,  // -1000..1000 tug of war meter
        stars: this.generateStarsForZone(i)
      });
    }
    this.recalculateLeaderboard();
  }

  generateStarsForZone(zoneId) {
    // Star details: Hipparcos ID equivalent, name, magnitude (magnitude decides weight), owner
    const starNames = [
      ["Sirius", "Vega", "Altair", "Procyon", "Fomalhaut"], // Zone 0
      ["Capella", "Castor", "Pollux", "Aldebaran", "Elnath"], // Zone 1
      ["Spica", "Arcturus", "Denebola", "Regulus", "Algieba"], // Zone 2
      ["Antares", "Shaula", "Sabik", "Nunki", "Kaus Australis"], // Zone 3
      ["Deneb", "Sadr", "Gienah", "Albireo", "Ruchbah"], // Zone 4
      ["Polaris", "Kochab", "Yildun"], // Zone 5 (Spire)
      ["Mirfak", "Algol", "Atik"], // Zone 6 (Spire)
      ["Bellatrix", "Betelgeuse", "Rigel"], // Zone 7 (Spire)
      ["Acrux", "Mimosa", "Gacrux"], // Zone 8 (Spire)
      ["Canopus", "Miaplacidus", "Avior"], // Zone 9 (Spire)
      ["Zenith Star Alpha", "Zenith Star Beta"] // Zone 10 (Crown)
    ];

    const names = starNames[zoneId] || ["Star A", "Star B"];
    return names.map((name, idx) => {
      const mag = (zoneId >= 5 ? 1.5 : 2.5) + (idx * 0.4);
      return {
        hip_id: zoneId * 10 + idx,
        name: name,
        magnitude: parseFloat(mag.toFixed(2)),
        held_by: null,
        weight: Math.round(50 / mag) // lower magnitude = brighter = heavier weight
      };
    });
  }

  registerPlayer(handle, faction, chart) {
    this.player = {
      handle,
      faction,
      chart,
      deck_seed: Math.floor(Math.random() * 1000000)
    };

    // Mint starting deck
    this.collection = [];
    this.deck = [];

    const chartRuler = SIGN_RULERS[Math.floor(chart.ascendant / 1800) % 12];
    const receptionBoosts = calculateReceptionBoosts(chart);

    chart.placements.forEach(p => {
      const degree = Math.floor(p.arc_minutes / 60);
      const minute = p.arc_minutes % 60;
      const receptionBoost = receptionBoosts[p.body];
      const effectiveDignity = p.dignity + Math.round(receptionBoost * 2);
      const minorRank = p.body === chartRuler
        ? 1
        : ((isAngularPlacement(p, chart) || SIGN_RULERS[p.sign] === p.body)
          ? courtRank(effectiveDignity)
          : pipRank(p.sign, degree));

      const minor = this.createCard(
        p.body,
        false,
        degree,
        minute,
        p.dignity,
        p.retrograde,
        minorRank,
        p.sign,
        receptionBoost
      );
      this.collection.push(minor);
      this.mintSlot(minor.card_id);

      const trump = this.createCard(
        p.body,
        true,
        degree,
        minute,
        p.dignity,
        p.retrograde,
        TRUMP_MAJOR_INDEX[p.body],
        p.sign,
        receptionBoost
      );
      this.collection.push(trump);
      this.mintSlot(trump.card_id);
    });

    this.save();
  }

  mintSlot(cardId) {
    const activeCount = this.deck.filter(d => d.loadout === "active").length;
    this.deck.push({ card_id: cardId, loadout: activeCount < 8 ? "active" : "bench" });
  }

  createCard(bodyIdx, isTrump, degree, minute, dignity, retrograde, rankOverride = null, signIdx = 0, receptionBoost = 0) {
    const cardId = Math.floor(Math.random() * 90000000) + 10000000;
    const suit = isTrump ? PLANET_SUITS[bodyIdx] : SIGN_SUITS[signIdx];
    const rank = rankOverride ?? (isTrump ? TRUMP_MAJOR_INDEX[bodyIdx] : pipRank(signIdx, degree));
    const dignityMult = 1.0 + (dignity + receptionBoost * 2.0) * 0.08;

    let hp = 12 + Math.round(minute * 28 / 59);
    let atk = Math.max(1, Math.floor((6 + degree) * dignityMult));
    let arm = 4 + (isFixedSign(signIdx) ? 8 : 0);
    let cd = Math.max(800, Math.min(3000, 3000 - (isCardinalSign(signIdx) ? 800 : 0) - degree * 20));

    if (isTrump) {
      hp = Math.floor(hp * 1.5);
      atk = Math.floor(atk * 1.5);
      arm = Math.floor(arm * 1.5);
    }

    let title = "";
    if (isTrump) {
      title = TRUMP_NAMES[bodyIdx];
    } else {
      title = rankName(rank) + " of " + SUIT_NAMES[suit];
    }

    return {
      card_id: cardId,
      suit: suit,
      rank: rank,
      health: hp,
      attack: atk,
      armour: arm,
      cooldown_ms: cd,
      source_body: bodyIdx,
      inverted: retrograde,
      is_trump: isTrump,
      level: 1,
      title: title,
      sign_idx: signIdx
    };
  }

  cycleLoadout(cardId) {
    const slot = this.deck.find(d => d.card_id === cardId);
    if (!slot) return;

    const current = slot.loadout;
    let next = "bench";
    
    if (current === "active") {
      next = "defense";
    } else if (current === "defense") {
      next = "bench";
    } else {
      next = "active";
    }

    // Enforce max 8 slots rule
    if (next === "active") {
      const activeCount = this.deck.filter(d => d.loadout === "active").length;
      if (activeCount >= 8) {
        alert("Active slots are full (max 8)! Bench a card first.");
        return;
      }
    } else if (next === "defense") {
      const defenseCount = this.deck.filter(d => d.loadout === "defense").length;
      if (defenseCount >= 8) {
        alert("Defense slots are full (max 8)! Bench a card first.");
        return;
      }
    }

    slot.loadout = next;
    this.save();
    synth.playSelect();
  }

  fuseCards(keepId, consumeId) {
    const keepCard = this.collection.find(c => c.card_id === keepId);
    const consumeCard = this.collection.find(c => c.card_id === consumeId);
    
    if (!keepCard || !consumeCard) return;

    const previousMult = levelMultiplier(keepCard.level);
    keepCard.level++;
    const nextMult = levelMultiplier(keepCard.level);
    const ratio = nextMult / previousMult;
    keepCard.attack = Math.round(keepCard.attack * ratio);
    keepCard.health = Math.round(keepCard.health * ratio);
    keepCard.armour = Math.round(keepCard.armour * ratio);

    // Delete consume card
    this.collection = this.collection.filter(c => c.card_id !== consumeId);
    this.deck = this.deck.filter(d => d.card_id !== consumeId);

    this.save();
    synth.playFuse();
  }

  recalculateLeaderboard() {
    const factionScores = new Array(10).fill(0);
    this.map.forEach(zone => {
      if (zone.owner !== null) {
        const weight = zone.kind === "house" ? 100 : (zone.kind === "spire" ? 200 : 400);
        factionScores[zone.owner] += weight;
      }
    });

    const board = factionScores.map((score, idx) => ({ id: idx, score }));
    board.sort((a, b) => b.score - a.score);
    this.leaderboard = board;
  }

  tick() {
    // Advance season clock degree
    this.seasonDegree = (this.seasonDegree + 1) % 360;

    // Simulate passive decay in uncontrolled zones
    this.map.forEach(zone => {
      if (zone.control !== 0) {
        const decayRate = zone.kind === "crown" ? 15 : 8;
        if (zone.control > 0) {
          zone.control = Math.max(0, zone.control - decayRate);
        } else {
          zone.control = Math.min(0, zone.control + decayRate);
        }
        
        // If control drops back to 0, ownership becomes neutral
        if (zone.control === 0) {
          zone.owner = null;
        }
      }
    });

    // Simulate occasional bot attacks on neutral/opposing zones (keeps map alive)
    if (Math.random() < 0.2) {
      const randomZone = this.map[Math.floor(Math.random() * this.map.length)];
      const botFaction = Math.floor(Math.random() * 10);
      
      // Select random star to capture
      const randomStar = randomZone.stars[Math.floor(Math.random() * randomZone.stars.length)];
      randomStar.held_by = botFaction;
      
      // Shift zone control meter
      const delta = (botFaction === this.player?.faction) ? 100 : -100;
      randomZone.control = Math.max(-1000, Math.min(1000, randomZone.control + delta));
      
      // Update zone ownership if crosses threshold (+600 for player's faction, -600 for bots)
      if (randomZone.control >= 600) {
        randomZone.owner = this.player?.faction;
      } else if (randomZone.control <= -600) {
        randomZone.owner = botFaction;
      }
    }

    this.recalculateLeaderboard();
    this.save();
  }
}

const state = new GameState();

// ---- AUTO-SIEGE COMBAT RESOLVER ----
// ---- MULTI-FACTION BATTLE HELPERS & RESOLVER ----
function getStarContesters(zone, star) {
  if (!star.contesters) {
    const contesters = new Set();
    // 1. Add player faction
    if (state.player) {
      contesters.add(state.player.faction);
    }
    // 2. Add owner faction
    if (star.held_by !== null) {
      contesters.add(star.held_by);
    }
    // 3. Add random other factions
    let numOthers = 2; // default
    if (zone.kind === "spire") numOthers = Math.floor(Math.random() * 3) + 2; // 2..4 others
    else if (zone.kind === "crown") numOthers = Math.floor(Math.random() * 4) + 5; // 5..8 others (up to all 10 factions)
    else numOthers = Math.floor(Math.random() * 2) + 1; // 1..2 others

    while (contesters.size < Math.min(10, numOthers + 1)) {
      const randomFaction = Math.floor(Math.random() * 10);
      contesters.add(randomFaction);
    }
    star.contesters = Array.from(contesters);
  }
  return star.contesters;
}

// ---- AUTO-SIEGE COMBAT RESOLVER ----
function runAutoSiege(teams, zoneElement) {
  const logs = [];
  logs.push({ type: "system", text: "⚔ Auto-Siege started under " + zoneElement.toUpperCase() + " weather ⚔" });

  // Clone teams to keep local combat state
  const combatTeams = teams.map(t => ({
    ...t,
    cards: t.cards.map(c => ({ ...c, maxHp: c.health, curHp: c.health }))
  })).filter(t => t.cards.length > 0);

  if (combatTeams.length === 0) {
    logs.push({ type: "system", text: "No combatants present!" });
    return { victory: false, winnerFactionId: null, logs };
  }

  // Map faction seals for each combat team
  combatTeams.forEach(t => {
    t.seals = sealedSuitsForFaction(t.faction);
  });

  let round = 1;
  while (combatTeams.length > 1 && round <= 30) {
    logs.push({ type: "system", text: `✦ Round ${round} ✦` });

    // Collect all alive cards and sort them by speed/cooldown
    const turnQueue = [];
    combatTeams.forEach(t => {
      t.cards.forEach(c => {
        if (c.curHp > 0) {
          turnQueue.push({ team: t, card: c });
        }
      });
    });

    // Sort queue by cooldown ascending (lower cooldown = faster = goes first)
    turnQueue.sort((a, b) => a.card.cooldown_ms - b.card.cooldown_ms);

    turnQueue.forEach(actor => {
      const { team, card } = actor;
      if (card.curHp <= 0 || combatTeams.length <= 1) return;

      // Find target: choose a card from any other team
      const enemyTeams = combatTeams.filter(t => t.faction !== team.faction);
      if (enemyTeams.length === 0) return;

      // Target the team with the highest remaining total HP to focus the strongest threat
      enemyTeams.sort((a, b) => {
        const aHp = a.cards.reduce((sum, c) => sum + Math.max(0, c.curHp), 0);
        const bHp = b.cards.reduce((sum, c) => sum + Math.max(0, c.curHp), 0);
        return bHp - aHp;
      });

      const targetTeam = enemyTeams[0];
      const targetCard = targetTeam.cards.find(c => c.curHp > 0);
      if (!targetCard) return;

      // Calculate damage using multiplier
      const mult = elementWeather(card.suit, zoneElement)
        * sealMultiplier(card.suit, team.seals)
        * levelMultiplier(card.level);

      let dmg = Math.round(card.attack * mult) - targetCard.armour;
      dmg = Math.max(1, dmg);
      targetCard.curHp -= dmg;

      const actorStr = team.isPlayer ? `${card.title} (You)` : `[${team.glyph} ${team.name}] ${card.title}`;
      const targetStr = targetTeam.isPlayer ? `${targetCard.title} (You)` : `[${targetTeam.glyph} ${targetTeam.name}] ${targetCard.title}`;

      logs.push({
        type: team.isPlayer ? "combat" : "hit",
        text: `⚔ ${actorStr} strikes ${targetStr} for ${dmg} dmg (${targetCard.curHp}/${targetCard.maxHp} HP left)`
      });

      if (targetCard.curHp <= 0) {
        logs.push({ type: "hit", text: `☠ ${targetStr} has collapsed!` });
        
        // Clean up dead cards in target team
        targetTeam.cards = targetTeam.cards.filter(c => c.curHp > 0);
        
        // If team is fully eliminated, log it
        if (targetTeam.cards.length === 0) {
          logs.push({ type: "system", text: `💥 Faction [${targetTeam.glyph} ${targetTeam.name}] has been eliminated from the round!` });
        }
      }
    });

    // Remove eliminated teams from turn list
    for (let i = combatTeams.length - 1; i >= 0; i--) {
      if (combatTeams[i].cards.length === 0) {
        combatTeams.splice(i, 1);
      }
    }

    // Support passive heal tick for Cups suits in all remaining teams
    combatTeams.forEach(t => {
      t.cards.forEach(c => {
        if (c.suit === "cups" && c.curHp > 0) {
          t.cards.forEach(h => {
            if (h.curHp > 0 && h.curHp < h.maxHp) {
              const healVal = Math.round(h.maxHp * 0.12);
              h.curHp = Math.min(h.maxHp, h.curHp + healVal);
              const nameStr = t.isPlayer ? `${h.title} (You)` : `[${t.glyph} ${t.name}] ${h.title}`;
              logs.push({ type: "heal", text: `💚 Cups healing swells ${nameStr} by +${healVal} HP` });
            }
          });
        }
      });
    });

    round++;
  }

  // Determine winner
  let winner = null;
  if (combatTeams.length > 0) {
    combatTeams.sort((a, b) => {
      const aHp = a.cards.reduce((sum, c) => sum + c.curHp, 0);
      const bHp = b.cards.reduce((sum, c) => sum + c.curHp, 0);
      return bHp - aHp;
    });
    winner = combatTeams[0];
  }

  if (winner) {
    const isPlayerWin = winner.isPlayer;
    if (isPlayerWin) {
      logs.push({ type: "victory", text: `✦ VICTORY: You won the battle! Faction [${winner.glyph} ${winner.name}] claims the star.` });
    } else {
      logs.push({ type: "defeat", text: `✦ DEFEAT: Faction [${winner.glyph} ${winner.name}] won the battle and claims the star.` });
    }
    return { victory: isPlayerWin, winnerFactionId: winner.faction, logs };
  } else {
    logs.push({ type: "defeat", text: "✦ DRAW: No faction emerged victorious." });
    return { victory: false, winnerFactionId: null, logs };
  }
}

// ---- DEVICE ORIENTATION & CAMERA HANDLERS ----
let cameraStream = null;
async function toggleARCamera() {
  const video = document.getElementById("ar-video-bg");
  if (!video) return false;

  if (cameraStream) {
    // Shut down camera
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    video.srcObject = null;
    video.classList.remove("active");
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    cameraStream = stream;
    video.srcObject = stream;
    video.play();
    video.classList.add("active");
    
    // Attempt gyro permissions
    requestGyroscopePermission();
    return true;
  } catch (e) {
    console.error("Camera access failed", e);
    alert("Camera permission denied. Enabling interactive sky sphere fallback instead!");
    return false;
  }
}

function requestGyroscopePermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('deviceorientation', handleOrientation);
  }
}

function handleOrientation(event) {
  const map = document.getElementById("sky-map-wrapper");
  if (!map) return;

  const alpha = event.alpha || 0; // z axis (heading)
  const beta = event.beta || 0;   // x axis (tilt)
  const gamma = event.gamma || 0; // y axis

  // Apply smooth 3D CSS rotate based on orientation
  map.style.transform = `rotateZ(${-alpha}deg) rotateX(${beta - 70}deg) rotateY(${gamma}deg)`;
}
