# Pentacles: Solana Play-to-Earn & ESMS Elemental Economy Specification
**Document Version:** 1.0.0-WIP  
**Target Environments:** Solana Devnet / Mainnet-Beta & SpacetimeDB Maincloud (`cookingwithcastrollc`)  
**Status:** Work In Progress — Architecture & Implementation Blueprint

---

## 1. Executive Summary & Vision

**Pentacles** is a location-based, celestial augmented-reality MMO where players' real natal birth charts dictate their planetary factions, the visible heavens serve as the contested 11-zone battleground, and the Tarot forms their strategic arsenal.

This specification details the end-to-end design and engineering roadmap to realize the core economic loop:
1. **Play to Earn Solana (SOL):** Players earn real SOL rewards by engaging in celestial warfare — conquering stars, dominating the 11 Pentacle zones, winning War Table multi-seat trick battles, and prevailing in Word Duels against planetary AI agents.
2. **The 4 Elemental Coins (ESMS):** Players purchase and trade four native Token-2022 SPL coins on Solana:
   * **Spirit (🜂 - Fire / Wands)**
   * **Essence (🜄 - Water / Cups)**
   * **Matter (🜃 - Earth / Pentacles)**
   * **Substance (🜁 - Air / Swords)**
3. **Astrological Resonance Yield Engine:** The distribution of ESMS and SOL is not a generic static drip; it is dynamically modulated by:
   * **The Player's Individual Natal Chart** (birth placements, planetary dignities, house cusps).
   * **The Mundane Chart of the Moment** (real-time ephemeris, transiting planetary dignities, aspects, and rising Ascendant).
   * **Zone-Specific Round Modifiers** (the 11-zone geometry, rotating sidereal suit weather, control delta shift, clean sweep bonuses, and 14-pillar thermodynamic reactions).
4. **The "Earn More" Multiplier & Circular Flywheel:** Holding, staking, or burning the 4 coins elevates the player's **Elemental Resonance Multiplier** ($1.0\times \to 3.5\times$), boosting SOL earnings across all game loops. Crucially, $75\%$ of all SOL spent purchasing ESMS replenishes the on-chain Community Reward Treasury, creating a sustainable, closed-loop token economy.

---

## 2. Omnichain & Web3 Architecture Overview

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                       SOLANA CLUSTER (DEVNET / MAINNET)                │
   │                                                                        │
   │  ┌────────────────────────┐              ┌──────────────────────────┐  │
   │  │  ASOL Mint Authority   │              │     pentacles_solana     │  │
   │  │  (Token-2022 Programs) │              │      (Anchor Program)    │  │
   │  │                        │              │                          │  │
   │  │  • Spirit (🜂) Mint     │◄────────────┤  • SolRewardTreasury PDA │  │
   │  │  • Essence (🜄) Mint    │              │  • buy_esms_with_sol     │  │
   │  │  • Matter (🜃) Mint     │              │  • claim_sol_reward      │  │
   │  │  • Substance (🜁) Mint  │              │  • StarVault (USDC/LST)  │  │
   │  └────────────────────────┘              └─────────────┬────────────┘  │
   └────────────────────────────────────────────────────────┼───────────────┘
                                                            │
                     Ed25519 Signed Claim Vouchers           │ Verified On-Chain
                     & Sync Transactions                    │ Settlement
                                                            │
   ┌────────────────────────────────────────────────────────▼───────────────┐
   │                     RAILWAY FEEDER WORKERS NETWORK                     │
   │                                                                        │
   │   • solana-sync-service.ts    (Ingests on-chain Token-2022 & events)   │
   │   • reward-attestor.ts        (Signs Ed25519 reward vouchers via KMS)  │
   │   • war-ledger.ts             (Tracks 10-day decan champion cycles)    │
   │   • war-table.ts              (Referees 11-zone multi-seat trick play) │
   │   • push-ephemeris.ts         (Computes live JPL Keplerian coordinates)│
   └────────────────────────────────────────────────────────┬───────────────┘
                                                            │
                     Authoritative WASM State & Reducers    │
                                                            │
   ┌────────────────────────────────────────────────────────▼───────────────┐
   │               SPACETIMEDB MAINCLOUD (cookingwithcastrollc)             │
   │                                                                        │
   │   • player_sol_reward         • zone & star_node tables                │
   │   • verified_solana_wallet    • melee_table & melee_trick              │
   │   • natal_chart (private)     • round_state & round_participant        │
   │   • duel_round & word_duel    • alchemical thermodynamic logs          │
   └────────────────────────────────────────────────────────┬───────────────┘
                                                            │
                     Real-Time Client Subscriptions (WSS)   │
                                                            │
   ┌────────────────────────────────────────────────────────▼───────────────┐
   │                   PLAYABLE WEB CLIENT (VITE + CANVAS)                  │
   │                                                                        │
   │   • astro-weather.js (Chart of the moment + synastry engine)          │
   │   • alchemicalPillars.js (14 Alchemical Pillars & reaction physics)   │
   │   • hud.js (ESMS Chips + Live Multiplier + Unclaimed SOL balance)     │
   │   • store-ui.js & claim-ui.js (1-click Phantom/Solflare actions)       │
   └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Astrological Resonance Engine: Chart-Modulated Yield

Instead of flat game tokens, rewards in Pentacles generate dynamic elemental yields derived from the intersection of the **individual natal chart** and the **mundane sky**.

### 3.1 The Individual Natal Chart ($\mathcal{N}$)
A player's chart is computed deterministically from their birth instant and geographic coordinates (`ChartCalculator` / `AstroWeather.natalChart`):
*   **Natal Elemental Weight ($\mathcal{W}_N(e)$):** The tally of the 10 celestial bodies + Ascendant + Midheaven residing in each triplicity:
    $$\mathcal{W}_N(e) = \sum_{b \in 	ext{Bodies}} \mathbf{1}_{\{	ext{element}(b) = e\}} \times \left(1 + rac{	ext{dignity}(b)}{10}
ight)$$
    Where dignities (Domicile $= +5$, Exaltation $= +4$, Peregrine $= 0$, Detriment $= -5$, Fall $= -4$) weight the planet's elemental purity.
*   **Chart Ruler Affinity:** The ruling planet of the Ascendant injects a permanent $+25\%$ affinity boost to its associated element (e.g. Aries Ascendant $\to$ Mars $\to$ Wands/Fire $\to$ Spirit 🜂).

### 3.2 The Mundane Chart of the Moment ($\mathcal{M}$)
Computed every frame/tick by `AstroWeather.chartOfMoment(lat, lon, date)`:
*   **Active Mundane Voltage ($\mathcal{V}_M(e)$):** The instantaneous concentration of celestial bodies transiting the four triplicities:
    $$\mathcal{V}_M(e) = \sum_{b \in 	ext{Transiting}} \omega_b \times \left(1 + rac{	ext{dignity}_M(b)}{10}
ight)$$
    Weights ($\omega_b$): Sun $= 2.0$, Moon $= 2.0$, Ascendant $= 2.5$, Benefics (Jupiter/Venus) $= 1.5$, Malefics (Mars/Saturn) $= 1.2$, Outer bodies $= 1.0$.
*   **Retrograde Attenuation:** A transiting body in retrograde inverts its flow, diminishing primary elemental yield by $-30\%$ but unlocking reversed "Shadow Arcana" crafting components.

### 3.3 Natal $\times$ Mundane Synastric Aspects ($\mathcal{S}$)
When transiting bodies form harmonic aspects with natal placements:
*   **Trines ($120^\circ \pm 6^\circ$) & Conjunctions ($0^\circ \pm 8^\circ$):** Induce **Harmonic Elemental Resonance**, granting a $+35\%$ to $+75\%$ yield surge in the shared element.
*   **Sextiles ($60^\circ \pm 4^\circ$):** Grant $+20\%$ efficiency and $+10\%$ critical trigger rate in War Table tricks.
*   **Squares ($90^\circ \pm 6^\circ$) & Oppositions ($180^\circ \pm 8^\circ$):** Induce **Alchemical Friction**, increasing the thermodynamic heat and entropy of battle reactions, yielding higher `pentaclesYield` at the cost of increased defense decay.
*   **The Ascendant Burst ("Golden Minute"):** When a star or transiting planet crosses within $\pm 2$ arc-minutes of the player's natal Ascendant or Midheaven, an instant burst awards an **extra $100\%$ bonus yield** on that action.

---

## 4. Zone-Specific Modifiers & Round Performance

The celestial map partitions the sky into 11 horizon-anchored zones (5 Houses, 5 Spires, 1 Crown Zenith). Performance within a zone dictates both immediate loot and ongoing territorial dividends.

```
                     Zone 10: Crown Zenith (Apex)
                                  /                                 /                     Zone 9       /    \       Zone 5
                   Spire       / Zone \      Spire
                     \        /   10   \       /
                      \      /          \     /
                       \    /------------\   /
                        \  /   5 Houses   \ /
                   Zone 8\/ (Zones 0..4)  \/Zone 6
                   Spire \                / Spire
                          \              /
                           \------------/
                               Zone 7
                               Spire
```

### 4.1 Zone Topography & Inherent Traits
| Zone ID | Classification | Astrological Affinity | Gameplay Role & Economic Modifier |
| :--- | :--- | :--- | :--- |
| **0 – 4** | **The 5 Houses** | Horizon Base / Cardinal Roots | **Territorial Vaults:** Lower combat volatility, high defensive retention, steady territorial yield accumulation. Focuses on **Matter (🜃)** and **Essence (🜄)**. |
| **5 – 9** | **The 5 Spires** | Ecliptic Gateways / Fixed Energy | **Offensive Conduits:** High volatility, rapid control shifts, elevated bonus multiplier for aggressive strikes. Focuses on **Spirit (🜂)** and **Substance (🜁)**. |
| **10** | **The Crown Zenith** | Celestial Apex / Quintessence | **Grand Arena:** Open to all 10 factions; carries $2.5\times$ base reward density. Yields balanced **Quintessence (all 4 elements)**. |

### 4.2 Environmental Sidereal Weather (`zone_favored_suit`)
The rotating sidereal clock (`gmst_deg` relative to zone hour angle `zone_center_ha`) continuously rotates the 12 signs through the 11 zones:
*   **Weather Alignment Bonus:** If a played card/trick matches the zone's active favored suit: **$+35\%$ power & $+35\%$ elemental coin yield**.
*   **Opposite Element Damping:** Cards opposing the zone's active element suffer a **$-25\%$ yield penalty**.

### 4.3 Round Performance Modifiers (War Table & Star Sieges)
At the conclusion of a battle or trick round, the authoritative engine evaluates:
1. **Control Delta ($\Delta 	ext{Control}$):**
   * Pushing the zone meter past $\pm 600$ points triggers a **Zone Capture Bounty**:
     $$	ext{CaptureBounty} = 	ext{BaseSol} \times \left(1 + rac{|\Delta	ext{Control}|}{1000}
ight)$$
2. **Clean Sweep ("Grand Slam"):**
   * Winning all tricks in a War Table match grants a **$+50\%$ Clean Sweep Multiplier**.
3. **Alchemical Reaction Physics (`public/alchemicalPillars.js`):**
   * The 14 Alchemical Pillars (Solution, Filtration, Evaporation, Distillation, Calcination, Rectification, etc.) evaluate card combinations based on:
     * **Heat ($Q$):** Directly scales **Spirit (🜂)** yield.
     * **Free Energy ($\Delta G$):** Directly scales **Essence (🜄)** yield.
     * **Entropy ($S$):** Lower entropy (crystalline order) scales **Matter (🜃)** yield.
     * **Reactivity ($R$):** Directly scales **Substance (🜁)** yield.
     * **Combo Multiplier:** $1.0 + (	ext{cardCount} \times 0.35)$ scales total match `pentaclesYield`.
4. **Zodiac Seal Synergy:**
   * Holding contiguous zones activates a **Zodiac Seal**, granting a permanent **$+15\%$ yield dividend** to all faction members fighting in that sector.
5. **10-Day Decan Cycle Champions (`feeder/war-ledger.ts`):**
   * When the Sun advances $10^\circ$ through the zodiac, the faction dominating that decan's minor card is crowned champion. The top $10\%$ contributing players in that faction split a **Bonus Decan SOL Treasury Dividend**.

---

## 5. The "Earn More" Multiplier & Circular Economy

### 5.1 The Elemental Multiplier Curve
Holding the 4 Token-2022 coins in the player's verified Solana wallet establishes their **Elemental Multiplier ($\mathcal{M}_{	ext{ESMS}}$)**:

$$\mathcal{M}_{	ext{ESMS}} = 1.0 + \sum_{i \in \{	ext{Spirit}, 	ext{Essence}, 	ext{Matter}, 	ext{Substance}\}} \min\left(0.5, rac{	ext{Balance}_i}{100}
ight) + \mathcal{Q}$$

*   **Linear Elemental Stacking:** Holding up to $100$ tokens of any element yields up to $+0.5\times$ (max $+2.0\times$ across all four).
*   **Quintessence Quadrature ($\mathcal{Q}$):** If the player maintains a balanced ratio across all 4 coins (where $\min(	ext{Balance}) \ge 0.5 \times \max(	ext{Balance})$ and $\ge 50$ each), they unlock the **$+0.5\times$ Quintessence Bonus**.
*   **Hard Ceiling:** The total passive multiplier is capped at **$3.5\times$**.

### 5.2 Burn-to-Overcharge (Consumable Sinks)
Players can burn or stake ESMS coins into the SpacetimeDB `jing_pool` or on-chain to trigger active overdrives:
*   **Overcharge Strike:** Consuming $10$ Spirit $+$ $10$ Matter doubles card damage for 1 round and guarantees maximum loot drop rarity.
*   **Celestial Ward:** Locking $25$ Matter onto a held star delays decay by $48$ hours, locking in territorial APY.
*   **Alchemical Transmutation:** Burning $15$ of one element in the presence of a favorable transiting aspect transmutes it into $20$ of a deficient element, balancing the player's Quadrature bonus.

### 5.3 The Sustainable Treasury Flywheel
```
    [Player Purchases 100 ESMS with SOL]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
    75% of SOL              25% of SOL
         │                       │
         ▼                       ▼
[SolRewardTreasury PDA]  [Protocol Ops & DEX LP]
         │
         ▼
[Distributed to Active Players]
 (Star Sieges, Decan Triumphs, Word Duels)
         │
         ▼
[Multiplied by ESMS Holdings (1.0x - 3.5x)]
         │
         ▼
[Player Earns More SOL $\to$ Buys More ESMS]
```

---

## 6. Detailed Implementation Phases

### Phase 1: Solana Program (`programs/pentacles-solana`)
*   **`SolRewardTreasury` PDA:**
    *   Initialize PDA with seeds `[b"reward_treasury"]`.
    *   Holds lamports for player rewards.
    *   Maintains `daily_claim_cap`, `epoch_index`, and `total_distributed`.
*   **`claim_sol_reward` Instruction:**
    *   Parameters: `amount: u64`, `claim_nonce: u64`, `deadline: i64`, `oracle_signature: [u8; 64]`.
    *   Validates Ed25519 signature from the Game Authority verifying the claim.
    *   Enforces `Clock::get()?.unix_timestamp <= deadline`.
    *   Transfers lamports from `reward_treasury` PDA to `ctx.accounts.player`.
    *   Emits typed event `SolRewardClaimed`.
*   **`buy_esms_with_sol` Instruction:**
    *   Parameters: `element_id: u8`, `sol_amount: u64`.
    *   Splits SOL: $75\%$ to `reward_treasury` PDA, $25\%$ to protocol wallet.
    *   Mints or transfers corresponding 4-decimal ESMS Token-2022 tokens to player's ATA.
*   **Security & Guardrails:**
    *   Infallible checked/saturating arithmetic throughout.
    *   Per-wallet 24-hour claim ceiling.

### Phase 2: SpacetimeDB Server Module (`server/src/`)
*   **New Tables in `tables.rs`:**
    *   `player_sol_reward`: tracks `identity`, `solana_pubkey`, `unclaimed_lamports`, `lifetime_earned`, `claim_nonce`, `current_multiplier_bps`.
    *   `sol_claim_history`: records settled on-chain claims.
    *   `zone_yield_pool`: tracks accrued territory dividends per zone and faction.
*   **Reducers in `reducers.rs` & `combat.rs`:**
    *   Integrate natal chart dignity + mundane weather multiplier into battle resolutions (`resolve_star_battle`, `strike_star_single`).
    *   Integrate Word Duel word score $\to$ SOL bounty scaling in `cast_word`.
    *   Add reducer `request_sol_claim_voucher`: checks minimum threshold, locks pending balance, and prepares claim payload for the attestor.

### Phase 3: Off-Chain Feeder Attestor (`feeder/`)
*   **`feeder/reward-attestor.ts`:**
    *   Subscribes to `request_sol_claim_voucher` events on SpacetimeDB.
    *   Constructs deterministic binary payload: `[player_pubkey, amount_lamports, nonce, deadline]`.
    *   Signs via Cloud KMS / Authority Ed25519 keypair.
    *   Writes signed voucher back to `sol_claim_voucher` table for client access.
*   **`feeder/war-ledger.ts`:**
    *   Tracks 10-day decan progress and triggers decan champion dividend distribution.

### Phase 4: Web Client HUD & In-Game Store (`src/web3/`, `public/`)
*   **Interactive ESMS HUD (`src/web3/hud.js`):**
    *   Renders real-time SOL balance and Unclaimed SOL reward badge.
    *   Renders active **Elemental Multiplier Chip** (e.g. `⚡ 2.45x Multiplier`).
    *   Click opens the **Alchemical Store & Claim Portal**.
*   **Store & Swap Modal (`src/web3/store-ui.js`):**
    *   Allows 1-click purchase of Spirit, Essence, Matter, and Substance with connected Phantom/Solflare wallet.
    *   Displays real-time transparent economics: "75% of your purchase directly funds player gameplay rewards".
*   **Claim Portal (`src/web3/claim-ui.js`):**
    *   One-click "Claim SOL" button.
    *   Fetches signed voucher, submits `claim_sol_reward` transaction, and triggers victory fanfare on settlement.
*   **Victory Screen Integration (`public/client.js` & `public/app.js`):**
    *   Post-battle and Word-Duel popups display itemized earnings:
        *   Base Combat Reward
        *   Natal $\times$ Transit Synastry Bonus
        *   Zone Weather Alignment ($+$35\%$)
        *   Alchemical Thermodynamic Multiplier
        *   ESMS Resonance Multiplier ($1.0\times \to 3.5\times$)
        *   **Total SOL & ESMS Credited**

---

## 7. Verification, Testing & Cutover Matrix

| Stage | Target / Test Suite | Success Criteria |
| :--- | :--- | :--- |
| **Program Unit Tests** | `cargo test` in `programs/pentacles-solana` | Valid claim execution, replay rejection, expired deadline rejection, exact 75/25 SOL split. |
| **Module Check** | `cargo check` in `server/` | Zero compilation errors, compatible schema updates. |
| **Feeder Tests** | `bun test tests/solana-sync-service.test.ts` | Lossless u64/u128 parsing, program-ID scoped event decoding. |
| **End-to-End Integration** | `bun scripts/solana-settlement-e2e.test.mjs` | Full loop: Play match $\to$ Earn reward $\to$ Attest voucher $\to$ Claim SOL on Devnet $\to$ Verify wallet balance. |
| **Frontend Production Build** | `bun run build` | Vite build completes cleanly with zero asset bundle regressions. |
