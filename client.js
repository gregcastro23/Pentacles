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

const SUIT_GLYPHS = { cups: "♥", swords: "♠", pentacles: "♦", wands: "♣" };
const SUIT_NAMES = { cups: "Cups", swords: "Swords", pentacles: "Pentacles", wands: "Wands" };

const TRUMP_NAMES = ["The Sun", "The High Priestess", "The Magician", "The Empress", "The Tower", "Wheel of Fortune", "The World", "The Fool", "The Hanged Man", "Judgement"];
const TRUMP_ARCANA = ["XIX", "II", "I", "III", "XVI", "X", "XXI", "0", "XII", "XX"];

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
function generateMockNatalChart(seedStr) {
  // Simple LCG hash function to make inputs deterministic
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
  // Generate 10 planetary placements
  for (let i = 0; i < 10; i++) {
    const sign = Math.floor(random() * 12);
    const degree = Math.floor(random() * 30);
    const minute = Math.floor(random() * 60);
    const retrograde = random() < 0.22;
    // Essential dignity mapping based on planet and sign
    let dignity = 0; // neutral
    if ((i === 4 && sign === 0) || (i === 6 && sign === 9) || (i === 0 && sign === 4)) {
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
  // dignity vector: Chart ruler (Ascendant lord) x3, Sun/Moon rulers x2, angular x1.5, dignity matching x1.5
  const scores = new Array(10).fill(10); // base score is 10

  chart.placements.forEach((p, idx) => {
    // Add essential dignity score
    scores[p.body] += p.dignity * 1.5;
    
    // stelliums (same element signs)
    const suit = SIGN_SUITS[p.sign];
    chart.placements.forEach((other, oIdx) => {
      if (idx !== oIdx && SIGN_SUITS[other.sign] === suit) {
        scores[p.body] += 1.0;
      }
    });
  });

  // Chart ruler boost (mocking Ascendant lord index mapping)
  const ascSign = Math.floor(chart.ascendant / 1800) % 12;
  const rulerBody = [4, 6, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8][ascSign]; // sign ruling planet
  scores[rulerBody] += 15;

  // Sun and Moon rulers boost
  scores[chart.placements[0].body] += 10; // Sun
  scores[chart.placements[1].body] += 8;  // Moon

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
    const raw = localStorage.getItem("pentacles_save");
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
        console.error("Failed parsing state", e);
      }
    }
    this.initDefaultMap();
    return false;
  }

  save() {
    const data = {
      player: this.player,
      collection: this.collection,
      deck: this.deck,
      map: this.map,
      leaderboard: this.leaderboard,
      seasonDegree: this.seasonDegree
    };
    localStorage.setItem("pentacles_save", JSON.stringify(data));
  }

  reset() {
    localStorage.removeItem("pentacles_save");
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
    
    // 1. Major Arcana Hero Trump
    const trumpCard = this.createCard(faction, true, 0, 0, 5, false);
    this.collection.push(trumpCard);
    this.deck.push({ card_id: trumpCard.card_id, loadout: "active" });

    // 2. Mint placements
    chart.placements.forEach((p, idx) => {
      const degree = Math.floor(p.arc_minutes / 60);
      const minute = p.arc_minutes % 60;
      const isCourt = (idx === 0 || idx === 4 || idx === 6); // Angular bodies (Sun, Mars, Saturn)
      
      const card = this.createCard(
        p.body,
        false,
        degree,
        minute,
        p.dignity,
        p.retrograde,
        isCourt,
        p.sign
      );
      this.collection.push(card);
      
      // Auto-assign first 7 pips/courts to Active, others to Bench
      const loadout = this.deck.filter(d => d.loadout === "active").length < 8 ? "active" : "bench";
      this.deck.push({ card_id: card.card_id, loadout: loadout });
    });

    this.save();
  }

  createCard(bodyIdx, isTrump, degree, minute, dignity, retrograde, isCourt = false, signIdx = 0) {
    const cardId = Math.floor(Math.random() * 90000000) + 10000000;
    const suit = SIGN_SUITS[signIdx];
    
    // Suit stats
    let baseAtk = 25, baseHp = 50, baseArm = 10, baseCd = 700;
    if (suit === "wands") { baseAtk = 30; baseHp = 45; baseArm = 8; baseCd = 600; }
    else if (suit === "swords") { baseAtk = 40; baseHp = 40; baseArm = 5; baseCd = 750; }
    else if (suit === "pentacles") { baseAtk = 18; baseHp = 60; baseArm = 20; baseCd = 900; }

    const scale = 1.0 + (degree / 15.0);
    const dignityMult = dignity >= 3 ? 1.35 : (dignity <= -3 ? 0.75 : 1.0);

    let atk = Math.round(baseAtk * scale * dignityMult);
    let hp = Math.round(baseHp * scale * dignityMult);
    let arm = Math.round(baseArm * scale * dignityMult);
    let cd = Math.round(baseCd / scale);

    hp += Math.round(minute * 0.4);
    atk += Math.round(minute * 0.15);

    if (retrograde) {
      let temp = atk;
      atk = arm;
      arm = temp;
      if (atk < 5) atk = 5;
      cd = Math.round(cd * 1.15);
    }

    let title = "";
    if (isTrump) {
      title = TRUMP_NAMES[bodyIdx];
    } else if (isCourt) {
      const courts = ["Page", "Knight", "Queen", "King"];
      title = courts[degree % 4] + " of " + SUIT_NAMES[suit];
    } else {
      const pips = ["Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
      title = pips[Math.min(9, Math.floor((degree / 30) * 10))] + " of " + SUIT_NAMES[suit];
    }

    return {
      card_id: cardId,
      suit: suit,
      rank: isTrump ? bodyIdx : (isCourt ? 11 + (degree % 4) : Math.floor((degree / 30) * 10) + 1),
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

    // Level up keep card
    keepCard.level++;
    // Scale stats with leveling diminishing ceiling (level multiplier: Level 1 = 1.0, 2 = 1.15, 3 = 1.25, 4 = 1.32, etc.)
    const mult = 1.0 + (keepCard.level * 0.12);
    keepCard.attack = Math.round(keepCard.attack * mult / (1 + (keepCard.level - 1) * 0.12));
    keepCard.health = Math.round(keepCard.health * mult / (1 + (keepCard.level - 1) * 0.12));

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
function runAutoSiege(attackerCards, defenderCards, zoneElement, attackerFaction, zoneOwnerFaction) {
  const logs = [];
  logs.push({ type: "system", text: "⚔ Duel started inside zone (" + zoneElement.toUpperCase() + " element) ⚔" });

  // Clone cards to simulate HP decay during fight
  const aTeam = attackerCards.map(c => ({ ...c, maxHp: c.health, curHp: c.health }));
  const dTeam = defenderCards.map(c => ({ ...c, maxHp: c.health, curHp: c.health }));

  if (dTeam.length === 0) {
    logs.push({ type: "system", text: "No defensive sentinels deployed! Attacker breaches base easily." });
    return { victory: true, logs };
  }

  let round = 1;
  while (aTeam.length > 0 && dTeam.length > 0 && round <= 20) {
    logs.push({ type: "system", text: `✦ Round ${round} ✦` });

    // Attacker turns
    aTeam.forEach(a => {
      if (a.curHp <= 0 || dTeam.length === 0) return;
      const target = dTeam[0]; // focus target
      
      // Calculate multipliers
      let mult = 1.0;
      
      // 1. Suit triangle (Wands > Swords > Pentacles > Wands)
      if (a.suit === "wands" && target.suit === "swords") mult = 1.5;
      else if (a.suit === "swords" && target.suit === "pentacles") mult = 1.5;
      else if (a.suit === "pentacles" && target.suit === "wands") mult = 1.5;
      else if (target.suit === "wands" && a.suit === "swords") mult = 0.66;
      else if (target.suit === "swords" && a.suit === "pentacles") mult = 0.66;
      else if (target.suit === "pentacles" && a.suit === "wands") mult = 0.66;

      // 2. Zone element weather match
      if (SIGN_SUITS[SIGN_SUITS.indexOf(a.suit)] === zoneElement) {
        mult *= 1.35;
      }

      // 3. Zodiac seal bonus (+15% attack if faction holds sign element)
      if (attackerFaction === state.player?.faction) {
        mult *= 1.15;
      }

      let dmg = Math.round(a.attack * mult) - target.armour;
      dmg = Math.max(1, dmg);
      target.curHp -= dmg;
      
      logs.push({ 
        type: "hit", 
        text: `⚔ Attacker's ${a.title} strikes Sentinel's ${target.title} for ${dmg} dmg (${target.curHp}/${target.maxHp} HP left)` 
      });

      if (target.curHp <= 0) {
        logs.push({ type: "combat", text: `☠ Sentinel's ${target.title} has collapsed!` });
      }
    });

    // Clean up dead sentinels
    while (dTeam.length > 0 && dTeam[0].curHp <= 0) dTeam.shift();

    // Defender turns
    dTeam.forEach(d => {
      if (d.curHp <= 0 || aTeam.length === 0) return;
      const target = aTeam[0];

      let mult = 1.0;
      if (d.suit === "wands" && target.suit === "swords") mult = 1.5;
      else if (d.suit === "swords" && target.suit === "pentacles") mult = 1.5;
      else if (d.suit === "pentacles" && target.suit === "wands") mult = 1.5;
      
      if (SIGN_SUITS[SIGN_SUITS.indexOf(d.suit)] === zoneElement) {
        mult *= 1.35;
      }

      let dmg = Math.round(d.attack * mult) - target.armour;
      dmg = Math.max(1, dmg);
      target.curHp -= dmg;

      logs.push({ 
        type: "hit", 
        text: `🛡 Sentinel's ${d.title} strikes Attacker's ${target.title} for ${dmg} dmg (${target.curHp}/${target.maxHp} HP left)` 
      });

      if (target.curHp <= 0) {
        logs.push({ type: "combat", text: `☠ Attacker's ${target.title} has collapsed!` });
      }
    });

    // Clean up dead attackers
    while (aTeam.length > 0 && aTeam[0].curHp <= 0) aTeam.shift();

    // Cups heal tick support
    aTeam.forEach(a => {
      if (a.suit === "cups" && a.curHp > 0) {
        aTeam.forEach(h => {
          if (h.curHp > 0 && h.curHp < h.maxHp) {
            const healVal = Math.round(h.maxHp * 0.15);
            h.curHp = Math.min(h.maxHp, h.curHp + healVal);
            logs.push({ type: "heal", text: `💚 Cups healing swells friendly ${h.title} by +${healVal} HP` });
          }
        });
      }
    });

    dTeam.forEach(d => {
      if (d.suit === "cups" && d.curHp > 0) {
        dTeam.forEach(h => {
          if (h.curHp > 0 && h.curHp < h.maxHp) {
            const healVal = Math.round(h.maxHp * 0.15);
            h.curHp = Math.min(h.maxHp, h.curHp + healVal);
            logs.push({ type: "heal", text: `💚 Cups healing swells Sentinel's ${h.title} by +${healVal} HP` });
          }
        });
      }
    });

    round++;
  }

  const victory = aTeam.length > 0;
  if (victory) {
    logs.push({ type: "victory", text: "✦ VICTORY: Star breached! Zone control meter shifts." });
  } else {
    logs.push({ type: "defeat", text: "✦ DEFEAT: Attacker team repelled by defensive sentinels." });
  }

  return { victory, logs };
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
