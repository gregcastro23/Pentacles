//! Value types shared across tables and reducers.

use spacetimedb::{Identity, SpacetimeType};

/// The ten planetary factions.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Planet {
    Sun, Moon, Mercury, Venus, Mars,
    Jupiter, Saturn, Uranus, Neptune, Pluto,
}

/// The four Minor-Arcana suits (elementally typed).
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Suit { Cups, Swords, Pentacles, Wands }

/// Zone geometry class within the Pentacle.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ZoneKind { House, Spire, Crown }

/// Where a card currently sits for its owner.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Loadout { Active, Defense, Bench }

/// Combat model in play (season-level switch; resolver serves all three).
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CombatModel { LaneSkirmish, AutoSiege }

/// House-division system a chart's cusps were derived under. Placidus is the
/// default; Whole Sign is the graceful fallback above the polar circle and for
/// time-unknown (solar) charts, where an unequal system can't be trusted.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum HouseSystem { Placidus, WholeSign }

/// Lifecycle of a live 3-lane duel.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DuelState { Active, Resolved }

/// Lifecycle of a War Table melee at a zone.
///
/// `Mustering` → champions chosen, the human queue is open.
/// `Seated`    → seats locked, hands dealt, the trick play is under way.
/// `Resolved`  → scored, control applied; the row is history.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MeleeState { Mustering, Seated, Resolved }

/// One seat the feeder asks `open_melee_round` to create: which faction, who is
/// playing it, and the Zone Claim that won it.
#[derive(SpacetimeType, Clone, Debug)]
pub struct SeatSpec {
    pub faction: Planet,
    pub occupant: Identity,
    pub claim: u16,
}

/// One seat's outcome, submitted by the feeder once the twelve tricks are played.
/// `score` is derived server-side from these, never trusted from the wire.
#[derive(SpacetimeType, Clone, Debug)]
pub struct SeatResult {
    pub seat_id: u64,
    pub counters: u16,
    pub melds_value: u16,
    pub took_final_trick: bool,
}

/// Lifecycle of a two-sided card trade.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TradeState { Open, Committed, Cancelled }

/// Supported ESMS bridge ledgers.
///
/// The first two variants predate any mainnet deployment and are kept exactly
/// where they are: SpacetimeDB 2.x cannot rename or drop, and every settled row
/// in `bridge_transfer` already carries one of them. `SolanaToken2022`
/// therefore keeps meaning *devnet* — relabelling it would retroactively move
/// settled history onto a chain it never touched. New variants are appended, so
/// existing tags keep their ordinals.
///
/// Each variant maps to a CAIP-2 id via `chain_caip2` below; that id, not the
/// variant name, is what reconciles against the AlchmAgentsSolana ledger.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BridgeChain {
    EvmBaseSepolia,
    SolanaToken2022,
    EvmBaseMainnet,
    SolanaMainnetToken2022,
}

impl BridgeChain {
    /// CAIP-2 chain id — the cross-project identity for this ledger.
    pub fn caip2(self) -> &'static str {
        match self {
            BridgeChain::EvmBaseSepolia => "eip155:84532",
            BridgeChain::SolanaToken2022 => "solana:devnet",
            BridgeChain::EvmBaseMainnet => "eip155:8453",
            BridgeChain::SolanaMainnetToken2022 => "solana:mainnet-beta",
        }
    }

    /// Stable key fragment used to scope `processed_tx` idempotency per chain.
    pub fn chain_key(self) -> &'static str {
        match self {
            BridgeChain::EvmBaseSepolia => "evm_base_sepolia",
            BridgeChain::SolanaToken2022 => "solana_devnet",
            BridgeChain::EvmBaseMainnet => "evm_base_mainnet",
            BridgeChain::SolanaMainnetToken2022 => "solana_mainnet_beta",
        }
    }

    /// True when this ledger settles real value. Guards every mainnet path.
    pub fn is_mainnet(self) -> bool {
        matches!(
            self,
            BridgeChain::EvmBaseMainnet | BridgeChain::SolanaMainnetToken2022
        )
    }

    /// True for the two Solana clusters, whatever their token program version.
    pub fn is_solana(self) -> bool {
        matches!(
            self,
            BridgeChain::SolanaToken2022 | BridgeChain::SolanaMainnetToken2022
        )
    }

    /// Bridging is only meaningful between an EVM and a Solana ledger of the
    /// same realness. A testnet burn must never mint on a mainnet ledger.
    pub fn is_valid_pair(source: Self, target: Self) -> bool {
        source.is_solana() != target.is_solana() && source.is_mainnet() == target.is_mainnet()
    }
}

/// Settlement lifecycle for a verified burn-and-mint transfer.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BridgeStatus { PendingMint, Completed }

/// One natal placement, packed to the arc-minute.
#[derive(SpacetimeType, Clone, Debug)]
pub struct Placement {
    pub body: Planet,
    pub sign: u8,          // 0..11 (Aries..Pisces)
    pub arc_minutes: u16,  // 0..1799 within the sign (degree*60 + minute)
    pub retrograde: bool,
    pub dignity: i8,       // -5 fall .. +5 rulership
}

impl Placement {
    /// 0..29 — whole degree within the sign.
    pub fn degree(&self) -> u8 { (self.arc_minutes / 60) as u8 }
    /// 0..59 — arc-minute within the degree.
    pub fn minute(&self) -> u8 { (self.arc_minutes % 60) as u8 }
    /// Absolute zodiac longitude in arc-minutes (0..21599).
    pub fn abs_minutes(&self) -> u16 { self.sign as u16 * 1800 + self.arc_minutes }
}

/// Client-submitted record of a duel, re-simulated authoritatively on the server.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BattleLog {
    pub model: CombatModel,
    pub plays: Vec<u64>, // attacker card_ids, in the order they were played
}

pub const ALL_PLANETS: [Planet; 10] = [
    Planet::Sun, Planet::Moon, Planet::Mercury, Planet::Venus, Planet::Mars,
    Planet::Jupiter, Planet::Saturn, Planet::Uranus, Planet::Neptune, Planet::Pluto,
];

impl Planet {
    pub fn idx(self) -> usize {
        match self {
            Planet::Sun => 0, Planet::Moon => 1, Planet::Mercury => 2, Planet::Venus => 3,
            Planet::Mars => 4, Planet::Jupiter => 5, Planet::Saturn => 6, Planet::Uranus => 7,
            Planet::Neptune => 8, Planet::Pluto => 9,
        }
    }

    /// The suit a faction's deck generation is biased toward (GDD §03).
    pub fn biased_suit(self) -> Suit {
        match self {
            Planet::Sun | Planet::Mars | Planet::Jupiter => Suit::Wands,
            Planet::Moon | Planet::Venus | Planet::Neptune => Suit::Cups,
            Planet::Mercury | Planet::Uranus | Planet::Pluto => Suit::Swords,
            Planet::Saturn => Suit::Pentacles,
        }
    }

    /// Map a 0..9 index back to a planet (for machine feeds / CLI calls).
    pub fn from_idx(i: u8) -> Planet {
        ALL_PLANETS[(i as usize).min(9)]
    }
}

// ── The Jing Arena — elemental duel moves ───────────────────────────────────
// Ported from the planetary_agents "Jing" metagame. The five moves map onto the
// four ESMS elements (0=Spirit/Fire, 1=Essence/Water, 2=Matter/Earth,
// 3=Substance/Air); Erode is the Water·Earth compound. A cast drains a Sacred-7
// stat + an ESMS pool; moves beat each other on a fixed counter graph.

/// The five elemental Jing moves.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JingMove { Meltdown, Freeze, TectonicRoot, Vacuum, Erode }

/// Lifecycle of a standalone cast→counter Jing duel thread.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JingState { Open, Countered, Resolved }

impl JingMove {
    /// Stable index (also the order shown to the client).
    pub fn idx(self) -> usize {
        match self {
            JingMove::Meltdown => 0, JingMove::Freeze => 1, JingMove::TectonicRoot => 2,
            JingMove::Vacuum => 3, JingMove::Erode => 4,
        }
    }
    /// Primary ESMS element id drained (0=Spirit,1=Essence,2=Matter,3=Substance).
    pub fn esms(self) -> u8 {
        match self {
            JingMove::Meltdown => 0, JingMove::Freeze => 1, JingMove::TectonicRoot => 2,
            JingMove::Vacuum => 3, JingMove::Erode => 1,
        }
    }
    /// Sacred-7 stat index drained: [power,resonance,wisdom,charisma,intuition,adaptability,vitality].
    pub fn sacred7(self) -> usize {
        match self {
            JingMove::Meltdown => 6,      // vitality
            JingMove::Freeze => 5,        // adaptability
            JingMove::TectonicRoot => 2,  // wisdom
            JingMove::Vacuum => 3,        // charisma
            JingMove::Erode => 4,         // intuition
        }
    }
    /// The moves that beat `self` (the counter graph from constants.ts).
    pub fn countered_by(self) -> &'static [JingMove] {
        match self {
            JingMove::Meltdown => &[JingMove::Vacuum],
            JingMove::Freeze => &[JingMove::Meltdown],
            JingMove::TectonicRoot => &[JingMove::Erode],
            JingMove::Vacuum => &[JingMove::Freeze],
            JingMove::Erode => &[JingMove::Vacuum],
        }
    }
    /// Resolve initiator vs responder → Some(true) initiator wins, Some(false)
    /// responder wins, None = draw (neither counters the other).
    pub fn resolve(initiator: JingMove, responder: JingMove) -> Option<bool> {
        let resp_beats_init = initiator.countered_by().contains(&responder);
        let init_beats_resp = responder.countered_by().contains(&initiator);
        if init_beats_resp && !resp_beats_init { Some(true) }
        else if resp_beats_init && !init_beats_resp { Some(false) }
        else { None }
    }
}
