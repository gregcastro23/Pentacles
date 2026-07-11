// ============================================================
// Pentacles — Cloud Profile Restore from SpacetimeDB
// ============================================================
// If the user connects to SpacetimeDB successfully but has no local
// profile matching their token/identity (e.g. cleared cookies/cache,
// or first load on a new alchm.kitchen subdomain), this script queries
// the server's public tables to fully reconstruct and restore their
// natal chart, card collection, deck loadout, and player profile.

import { toast } from '../ui/toast.js'
import { letterFor } from './letters.js'

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

export async function restoreProfileFromSpacetimeDB(net, state) {
  if (!net || !net.isLive || !net.identity) return

  const activeHandle = localStorage.getItem('pentacles_active_profile')
  // If we already have a loaded profile save in localStorage, do not overwrite.
  if (activeHandle && localStorage.getItem(`pentacles_save_${activeHandle}`)) {
    return
  }

  // eslint-disable-next-line no-console
  console.info('[CloudSync] No local profile found. Attempting cloud restore from SpacetimeDB...')

  try {
    const myId = net.identity

    // 1. Fetch player table
    const players = await net.query('SELECT * FROM player').catch(() => [])
    const pRow = players.find(
      (r) => r.identity && (r.identity === myId || sameIdentity(r.identity.__identity__ ?? r.identity, myId))
    )

    if (!pRow) {
      // eslint-disable-next-line no-console
      console.info('[CloudSync] No registered player found on SpacetimeDB for this identity.')
      return
    }

    const handle = pRow.handle
    // eslint-disable-next-line no-console
    console.info(`[CloudSync] Found registered player "${handle}". Reconstructing profile...`)

    // 2. Fetch natal chart (private table, returns only the owner's row)
    const charts = await net.query('SELECT * FROM natal_chart').catch(() => [])
    const ncRow = charts[0]

    if (!ncRow) {
      // eslint-disable-next-line no-console
      console.warn('[CloudSync] Player exists but no natal chart found on SpacetimeDB.')
      return
    }

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

    // Map cards back to client shape
    const clientCollection = myCards.map((c) => {
      const cardId = Number(c.card_id)
      return {
        card_id: cardId,
        suit: suitName(c.suit),
        rank: Number(c.rank),
        health: Number(c.health),
        attack: Number(c.attack),
        armour: Number(c.armour),
        cooldown_ms: Number(c.cooldown_ms),
        source_body: planetIndex(c.source_body),
        inverted: !!c.inverted,
        is_trump: !!c.is_trump,
        level: Number(c.level || 1),
        minted_at: Number(c.minted_at || Date.now()),
        letter: c.letter ? String.fromCharCode(c.letter) : letterFor(cardId),
      }
    })

    // Reconstruct active deck
    const activeCardIds = new Set(
      mySlots.filter((s) => loadoutName(s.loadout) === 'Active').map((s) => Number(s.card_id))
    )
    const clientDeck = clientCollection.filter((c) => activeCardIds.has(c.card_id))

    // Reconstruct chart placements
    const clientPlacements = (ncRow.placements || []).map((p) => ({
      body: planetIndex(p.body),
      sign: Number(p.sign),
      arc_minutes: Number(p.arc_minutes),
      retrograde: !!p.retrograde,
      dignity: Number(p.dignity || 0),
    }))

    const clientChart = {
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

    // Reconstruct full profile state object
    const clientState = {
      player: {
        handle: handle,
        faction: planetIndex(pRow.faction),
        chart: clientChart,
        deck_seed: Number(pRow.deck_seed),
        tokens: Number(pRow.tokens || 0),
        word_wins: Number(pRow.word_wins || 0),
      },
      collection: clientCollection,
      deck: clientDeck,
      map: [], // Will be initialized by initDefaultMap
      leaderboard: [],
      seasonDegree: 0,
      wordDuels: [],
      agentChats: {},
      jingPool: null,
      jingDuels: {},
      holdings: {},
      observer: { lat: Number(ncRow.birth_lat), lon: Number(ncRow.birth_lon) },
      rituals: {},
    }

    // Save to localStorage
    localStorage.setItem(`pentacles_save_${handle}`, JSON.stringify(clientState))
    localStorage.setItem('pentacles_active_profile', handle)

    // Update profiles list
    let list = []
    const listRaw = localStorage.getItem('pentacles_profiles_list')
    if (listRaw) {
      try {
        list = JSON.parse(listRaw)
      } catch (e) {}
    }
    if (!list.includes(handle)) {
      list.push(handle)
      localStorage.setItem('pentacles_profiles_list', JSON.stringify(list))
    }

    // Mirror to cookies
    if (window.CookieSync) window.CookieSync.persistAll()

    // Trigger state reload in app
    if (state && typeof state.load === 'function') {
      state.load()
      if (window.renderAll) window.renderAll()
      toast(`Restored profile "${handle}" from SpacetimeDB!`, { type: 'success', title: 'Cloud Sync' })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[CloudSync] Failed to restore profile from SpacetimeDB:', err)
  }
}

export default { restoreProfileFromSpacetimeDB }
