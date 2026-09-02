// ============================================================
// Pentacles — Cloud Profile Restore & Synchronization from SpacetimeDB
// ============================================================
// When the user connects to SpacetimeDB, this module queries the server's
// tables to authoritatively reconcile or restore their natal chart,
// card collection, deck loadouts, tokens, and player profile.

import { toast } from '../ui/toast.js'
import { letterFor } from './letters.js'
import { ARCANA_NAMES, MAJOR_NAMES, rankName } from '../alchm-chart/deck.js'

const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']

const sameIdentity = (a, b) =>
  !!a && !!b && String(a).toLowerCase().replace(/^0x/, '') === String(b).toLowerCase().replace(/^0x/, '')

function planetIndex(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const i = PLANET_NAMES.indexOf(v)
    return i >= 0 ? i : 0
  }
  if (typeof v === 'object') {
    const key = Object.keys(v)[0]
    const i = PLANET_NAMES.indexOf(key)
    return i >= 0 ? i : 0
  }
  return 0
}

function suitName(v) {
  if (v && typeof v === 'object') return Object.keys(v)[0].toLowerCase()
  return String(v || '').toLowerCase()
}

function loadoutName(v) {
  if (v && typeof v === 'object') return Object.keys(v)[0]
  return String(v || '')
}

function deriveCardTitle(card) {
  const isMajor = !!card.is_major
  const suit = suitName(card.suit)
  const suitCap = suit ? suit.charAt(0).toUpperCase() + suit.slice(1) : 'Wands'
  const rank = Number(card.rank)
  const bodyIdx = planetIndex(card.source_body)
  if (isMajor) {
    return ARCANA_NAMES[rank] || MAJOR_NAMES[bodyIdx] || 'Major Arcana'
  }
  return `${rankName(rank)} of ${suitCap}`
}

export async function restoreProfileFromSpacetimeDB(net, state) {
  if (!net || !net.isLive || !net.identity) return

  const myId = net.identity

  try {
    // 1. Fetch player table
    const players = await net.query('SELECT * FROM player').catch(() => [])
    const pRow = players.find(
      (r) => r.identity && (r.identity === myId || sameIdentity(r.identity.__identity__ ?? r.identity, myId))
    )

    if (!pRow) {
      console.info('[CloudSync] No registered player found on SpacetimeDB for this identity.')
      return
    }

    const handle = pRow.handle
    console.info(`[CloudSync] Syncing player "${handle}" with SpacetimeDB authoritative state...`)

    // Start live reactive subscriptions immediately for all users (existing & new)
    startLiveInventorySync(net, state)

    // 2. Fetch natal chart (private table, returns only the owner's row)
    const charts = await net.query('SELECT * FROM natal_chart').catch(() => [])
    const ncRow = charts[0]

    // 3. Fetch cards
    const cards = await net.query('SELECT * FROM card').catch(() => [])
    const myCards = cards.filter(
      (r) => r.owner && (r.owner === myId || sameIdentity(r.owner.__identity__ ?? r.owner, myId))
    )

    // 4. Fetch deck slots
    const slots = await net.query('SELECT * FROM deck_slot').catch(() => [])
    const mySlots = slots.filter(
      (r) => r.owner && (r.owner === myId || sameIdentity(r.owner.__identity__ ?? r.owner, myId))
    )

    // Reconstruct chart placements first so cards can derive sign_idx
    let clientChart = null
    let clientPlacements = []
    if (ncRow) {
      clientPlacements = (ncRow.placements || []).map((p) => ({
        body: planetIndex(p.body),
        sign: Number(p.sign),
        arc_minutes: Number(p.arc_minutes),
        retrograde: !!p.retrograde,
        dignity: Number(p.dignity || 0),
      }))

      clientChart = {
        birth_unix: Number(ncRow.birth_unix),
        birth_lat: Number(ncRow.birth_lat),
        birth_lon: Number(ncRow.birth_lon),
        time_known: !!ncRow.time_known,
        ascendant: Number(ncRow.ascendant),
        midheaven: Number(ncRow.midheaven),
        placements: clientPlacements,
        house_cusps: ncRow.house_cusps || null,
        house_system: ncRow.house_system
          ? typeof ncRow.house_system === 'object'
            ? Object.keys(ncRow.house_system)[0]
            : ncRow.house_system
          : 'WholeSign',
      }
    }

    // Map cards back to client shape with all metadata populated
    let clientCollection = myCards.map((c) => {
      const cardId = Number(c.card_id)
      const isMajor = !!c.is_major
      const sourceBody = planetIndex(c.source_body)
      const placement = clientPlacements.find((p) => p.body === sourceBody)
      const derivedSign = placement ? placement.sign : Number(c.sign_idx ?? 0)
      const rawCard = {
        card_id: cardId,
        suit: suitName(c.suit),
        rank: Number(c.rank),
        health: Number(c.health),
        attack: Number(c.attack),
        armour: Number(c.armour),
        cooldown_ms: Number(c.cooldown_ms),
        source_body: sourceBody,
        inverted: !!c.inverted,
        is_major: isMajor,
        level: Number(c.level || 1),
        minted_at: Number(c.minted_at || Date.now()),
        sign_idx: derivedSign,
        letter: c.letter ? String.fromCharCode(c.letter) : letterFor(cardId),
      }
      rawCard.title = deriveCardTitle(rawCard)
      return rawCard
    })

    // Reconstruct deck slots
    let clientDeck = []
    if (mySlots.length > 0) {
      clientDeck = mySlots.map((s) => ({
        card_id: Number(s.card_id),
        loadout: (loadoutName(s.loadout) || 'active').toLowerCase(),
      }))
    } else if (clientCollection.length > 0) {
      clientDeck = clientCollection.map((c, idx) => ({
        card_id: c.card_id,
        loadout: idx < 8 ? 'active' : 'bench',
      }))
    }

    // Check if a local save already exists
    const saveKey = `pentacles_save_${handle}`
    const rawLocal = localStorage.getItem(saveKey)
    let localData = null
    if (rawLocal) {
      try { localData = JSON.parse(rawLocal) } catch {}
    }

    if (localData) {
      // Reconcile server truth with local presentation
      localData.player = localData.player || {}
      localData.player.handle = handle
      localData.player.faction = planetIndex(pRow.faction)
      localData.player.tokens = Number(pRow.tokens ?? localData.player.tokens ?? 0)
      localData.player.word_wins = Number(pRow.word_wins ?? localData.player.word_wins ?? 0)
      if (clientChart) localData.player.chart = clientChart
      if (clientCollection.length > 0) localData.collection = clientCollection
      if (clientDeck.length > 0) localData.deck = clientDeck

      localStorage.setItem(saveKey, JSON.stringify(localData))
      localStorage.setItem('pentacles_active_profile', handle)

      if (state) {
        if (clientCollection.length > 0) state.collection = clientCollection
        if (clientDeck.length > 0) state.deck = clientDeck
        if (state.player) {
          state.player.tokens = localData.player.tokens
          state.player.word_wins = localData.player.word_wins
          if (clientChart) state.player.chart = clientChart
        }
        if (typeof state.save === 'function') state.save()
      }
      if (window.renderAll) window.renderAll()
      if (window.renderActiveHand) window.renderActiveHand()
      return
    }

    // First load on new machine / cleared storage
    if (clientCollection.length === 0 && window.state && typeof window.state.mintStarterDeck === 'function' && clientChart) {
      window.state.player = {
        handle,
        faction: planetIndex(pRow.faction),
        chart: clientChart,
        deck_seed: Number(pRow.deck_seed || 0),
        tokens: Number(pRow.tokens || 0),
        word_wins: Number(pRow.word_wins || 0),
      }
      clientCollection = window.state.mintStarterDeck(clientChart)
      clientDeck = window.state.deck || []
    }

    const clientState = {
      player: {
        handle,
        faction: planetIndex(pRow.faction),
        chart: clientChart,
        deck_seed: Number(pRow.deck_seed || 0),
        tokens: Number(pRow.tokens || 0),
        word_wins: Number(pRow.word_wins || 0),
      },
      collection: clientCollection,
      deck: clientDeck,
      map: [],
      leaderboard: [],
      seasonDegree: 0,
      wordDuels: [],
      agentChats: {},
      jingPool: null,
      jingDuels: {},
      holdings: {},
      observer: clientChart ? { lat: Number(clientChart.birth_lat), lon: Number(clientChart.birth_lon) } : { lat: 40.7128, lon: -74.006 },
      rituals: {},
    }

    localStorage.setItem(saveKey, JSON.stringify(clientState))
    localStorage.setItem('pentacles_active_profile', handle)

    let list = []
    const listRaw = localStorage.getItem('pentacles_profiles_list')
    if (listRaw) {
      try { list = JSON.parse(listRaw) } catch {}
    }
    if (!list.includes(handle)) {
      list.push(handle)
      localStorage.setItem('pentacles_profiles_list', JSON.stringify(list))
    }

    if (window.CookieSync) window.CookieSync.persistAll()

    if (state && typeof state.load === 'function') {
      state.load()
      if (window.renderAll) window.renderAll()
      if (window.renderActiveHand) window.renderActiveHand()
      toast(`Restored profile "${handle}" from SpacetimeDB!`, { type: 'success', title: 'Cloud Sync' })
    }

    // Start live reactive subscriptions for continuous inventory/deck sync
    startLiveInventorySync(net, state)
  } catch (err) {
    console.error('[CloudSync] Failed to restore profile from SpacetimeDB:', err)
  }
}

let unsubCards = null
let unsubSlots = null

/**
 * Subscribes to live `card` and `deck_slot` tables over WebSocket.
 * Updates state.collection and state.deck reactively when deltas occur on-chain.
 */
export function startLiveInventorySync(net, state) {
  if (!net || typeof net.subscribe !== 'function' || !net.identity) return

  const myId = net.identity

  if (unsubCards) {
    try { unsubCards() } catch {}
    unsubCards = null
  }
  if (unsubSlots) {
    try { unsubSlots() } catch {}
    unsubSlots = null
  }

  unsubCards = net.subscribe('card', (cards) => {
    if (!Array.isArray(cards) || !state) return
    const myCards = cards.filter(
      (r) => r.owner && (r.owner === myId || sameIdentity(r.owner.__identity__ ?? r.owner, myId))
    )
    if (!myCards.length) return

    const clientPlacements = state.player?.chart?.placements || []
    const updatedCollection = myCards.map((c) => {
      const cardId = Number(c.card_id)
      const isMajor = !!c.is_major
      const sourceBody = planetIndex(c.source_body)
      const placement = clientPlacements.find((p) => p.body === sourceBody)
      const derivedSign = placement ? placement.sign : Number(c.sign_idx ?? 0)
      const rawCard = {
        card_id: cardId,
        suit: suitName(c.suit),
        rank: Number(c.rank),
        health: Number(c.health),
        attack: Number(c.attack),
        armour: Number(c.armour),
        cooldown_ms: Number(c.cooldown_ms),
        source_body: sourceBody,
        inverted: !!c.inverted,
        is_major: isMajor,
        level: Number(c.level || 1),
        minted_at: Number(c.minted_at || Date.now()),
        sign_idx: derivedSign,
        letter: c.letter ? String.fromCharCode(c.letter) : letterFor(cardId),
      }
      rawCard.title = deriveCardTitle(rawCard)
      return rawCard
    })

    state.collection = updatedCollection
    if (typeof state.save === 'function') state.save()
    if (window.renderAll) window.renderAll()
    if (window.renderActiveHand) window.renderActiveHand()
  })

  unsubSlots = net.subscribe('deck_slot', (slots) => {
    if (!Array.isArray(slots) || !state) return
    const mySlots = slots.filter(
      (r) => r.owner && (r.owner === myId || sameIdentity(r.owner.__identity__ ?? r.owner, myId))
    )
    if (!mySlots.length) return

    state.deck = mySlots.map((s) => ({
      card_id: Number(s.card_id),
      loadout: (loadoutName(s.loadout) || 'active').toLowerCase(),
    }))
    if (typeof state.save === 'function') state.save()
    if (window.renderAll) window.renderAll()
    if (window.renderActiveHand) window.renderActiveHand()
  })
}

export default { restoreProfileFromSpacetimeDB, startLiveInventorySync }

