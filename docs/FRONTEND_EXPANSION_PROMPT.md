# Prompt — Flesh out the Pentacles web client

> **Historical implementation brief:** this file preserves requirements from an
> earlier frontend pass. Statements about what is or is not connected are not
> current operational status. See
> [`TESTNET_DEPLOYMENT.md`](TESTNET_DEPLOYMENT.md) for the verified deployment.

> Paste this into a fresh Claude Code session at the repo root
> (`/Users/cookingwithcastro/Desktop/Spacetimedbhackathon/Pentacles`).

---

## Mission

The Pentacles web client (`client.html` + `client.js` + `sky.js` + `constellations.js` +
`star-catalog.js`) is a working single-file, zero-build, **fully-offline** astrology game. Several
flagship surfaces are visually present but only **halfway implemented** — they render UI and then
fall back to local simulation. Turn these into robust, production-grade features: a real
Constellation DEX, a real wallet + ESMS balance HUD, live multiplayer Word Duels, and live
faction/zone dashboards — without regressing the parts that already work.

This is a frontend-robustness pass. **Do not change Solidity contracts or the Rust SpacetimeDB
module's on-chain interface.** Testnet only.

---

## Decisions already made — do not re-litigate

1. **Build system:** migrate the client to **Vite** (npm modules, real bundler). The current
   buildless `<script src=...>` setup is the starting point, not the constraint.
2. **On-chain layer:** **graceful dual-mode.** Every chain-touching action performs a real
   transaction when a wallet + the deployed AMM are reachable, and a rich, clearly-labeled
   simulation otherwise. Never hard-fail just because there's no wallet — but never silently fake
   a "success" that looks identical to a real tx, either. Label the mode.
3. **Robustness everywhere:** (a) explicit **loading / empty / error** states on every async
   surface, (b) replace all `alert()` with a themed non-blocking **toast** system, (c)
   **accessibility** — keyboard nav, ARIA roles, focus management, `prefers-reduced-motion`.
4. **Out of scope this pass:** mobile/touch layout (desktop-first is fine); contract changes;
   mainnet; the AlchmAgentsETH repo (read-only reference).

---

## Current state — ground truth (verified, trust this)

- **Offline by design.** `state` is computed locally and persisted to `localStorage`
  (`pentacles_save_<handle>`, `pentacles_profiles_list`, `pentacles_active_profile`). There is
  **no live SpacetimeDB connection** in the web client today. `client.js:120` flags `castWord()`
  as needing to call the `cast_word` reducer "instead."
- **Tabs** (`client.html` ~178): Cards (`tab-collection`), Siege (`tab-duel`), ✦ Words
  (`tab-word`), ✦ Pools (`tab-pools`). Sign-in modal has Profiles / Astral Key / **Web3 Wallet**.
- **✦ Pools (`renderPoolsPanel`, `traceConstellation` ~1022–1079):** lists constellations with a
  "Trace ✦" button. It calls a **`window.PentaclesBridge.trace()` that does not exist**, then
  falls back to a text-only "Demo mode (no chain configured)" message. No swap, no LP positions,
  no reserves/quotes, no balances. `client.js` imports no web3 library.
- **Web3 Wallet pane (`connectWeb3Wallet`, `loginWithWeb3Wallet` ~1784–1933):** bare
  `window.ethereum` connect + `alert()` errors. No Dynamic SDK, no on-chain registration, no
  balance display.
- **Word Duels:** a local JS mirror of the server `cast_word` solver over `wordlist.txt`. Plays
  offline only; results are not recorded server-side.
- **Faction Standings / Zones panels (`client.html` ~84–96):** mostly static/derived display.
- **The authoritative server** is the Rust SpacetimeDB module in `server/src/` (deployed db name
  default `cookingwithcastrollc`). Read `server/src/reducers.rs` and `server/src/tables.rs` for
  exact reducer signatures and table columns before wiring — do not guess them.

---

## The cross-repo / on-chain contract (verified — use these exact values)

The Constellation DEX contracts live in the sibling repo **AlchmAgentsETH**
(`/Users/cookingwithcastro/Desktop/EthGlobalHackathon/AlchmAgentsETH-main`, read-only reference).
The client integrates with the **Base Sepolia (chain id 84532)** deployment.

| Contract | Address |
| --- | --- |
| ConstellationAMM (12 pools) | `0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095` |
| ConstellationDeed (LP NFT, ERC-721, transferable) | `0x34eAC0fe797df2889d9dc59Cb98dCe24154BB9B6` |
| EsmsToken (ERC-1155, **soulbound**, 18 decimals) | `0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F` |

**ESMS element ids** (match `EsmsToken.sol` and `client.js` constants — already correct):
`0 = Spirit/Fire`, `1 = Essence/Water`, `2 = Matter/Earth`, `3 = Substance/Air`. ESMS is
**soulbound**: it can be minted/burned but never transferred wallet-to-wallet. The AMM holds
MINTER+BURNER and mints/burns at the edges; **a user must already hold ESMS to seed or swap**
(getting ESMS is the AlchmAgentsETH claim/shop flow — out of scope; in dual-mode, simulate
balances and gate real actions on real balance).

**The 12 pools = the 12 constellations**, id-for-id with `server/src/constellations.rs`
(Orion=id0 pair(0,3) 87bps … Crux=id11 pair(1,2) 182bps). `constellationId` in an attestation
**is** the pool id.

**ConstellationAMM key functions** (confirm exact ABI from AlchmAgentsETH
`contracts/src/ConstellationAMM.sol` / `lib/staking/amm.ts`):
- `seedLiquidity(uint16 constId, uint256 amtA, uint256 amtB, uint256 minShares, VisibilityAttestation att, bytes sig) → uint256 deedId`
- `swap(uint16 constId, uint8 inId, uint256 inAmt, uint256 minOut, VisibilityAttestation att, bytes sig) → uint256 outAmt`
- `getReserves(uint16 constId) → (uint256 rA, uint256 rB)` · `quote(uint16 constId, uint8 inId, uint256 inAmt) → uint256`
- `usedNonce(uint16 constId, address trader) → uint64` (per-(pool,trader) nonce)
- `pools(uint16) → (...elemA, elemB, feeBps...)`
- ConstellationDeed: `positionOf(uint256 deedId) → (uint16 constId, uint256 shares, ...)`, plus standard ERC-721 enumeration to list a wallet's deeds.

**EIP-712** (domain `name:"ConstellationAMM", version:"1", chainId:84532, verifyingContract:AMM`):
`VisibilityAttestation(address trader, uint16 constellationId, bytes32 regionCommit, uint8 visibleStars, uint64 nonce, uint64 deadline)`.

**The attestation is produced off-chain, not by the client.** Flow: client calls the
`trace_constellation` reducer → module emits a `trace_intent` row → the feeder
(`feeder/constellation-service.ts`, already correct) signs the EIP-712 attestation and writes it
back via `answer_trace` → a `trace_attestation` row appears → the client reads that row and
submits `seedLiquidity`/`swap` from the **user's own wallet** with the signature. The client must
read the attestation from the module, never fabricate it.

---

## Work plan

### Phase 0 — Vite migration (foundation; keep the game green at every step)
- Stand up Vite over the existing files. Split `client.html`'s large inline `<script>` (~lines
  343–2000) into ES modules. Preserve all current behavior — onboarding, profiles, sky dome,
  cards, siege, offline word duels — verified working before adding anything new.
- Add `viem` and the **Dynamic SDK** as real deps. Add the **SpacetimeDB TS SDK**
  (`@clockworklabs/spacetimedb-sdk`) for Phase 1.
- Keep `serve.ts`/`vercel.json` working (or update them) so `bun`/Vercel still serve the build.

### Phase 1 — Live SpacetimeDB connection (foundation for live features)
- Add a single connection module: connect to the deployed module (db `cookingwithcastrollc`,
  configurable via env), subscribe to the tables the client needs, and expose a typed reducer-call
  helper. Generate or hand-write bindings from `server/src/tables.rs` + `reducers.rs`.
- **Dual-mode here too:** if the module is unreachable, fall back to today's local simulation with
  a visible "offline" indicator. Online, the live tables drive `state`.

### Phase 2 — Web3 wallet + ESMS HUD
- Replace the bare `window.ethereum` flow with **Dynamic SDK**: connect, network-switch to Base
  Sepolia, account/disconnect, persistent connection across reloads. Keep the existing Astral-Key
  and Profiles auth paths intact alongside it.
- Add a persistent **ESMS balance HUD** (Spirit/Essence/Matter/Substance with their glyphs/colors
  from `client.js`) reading `EsmsToken.balanceOfBatch` on Base Sepolia; simulated balances in
  offline/no-wallet mode, clearly tagged.
- Wire the modal's implied on-chain sign-in/registration (EIP-191/712 sign-in) honestly — if a
  step isn't real yet, label it, don't fake it.

### Phase 3 — Constellation Pools / DEX (the headline)
- **Remove the missing-bridge stub.** Implement the real trace → seed flow: call
  `trace_constellation`, poll/subscribe for the `trace_attestation`, then submit `seedLiquidity`
  via the user's wallet; surface the minted Constellation Deed id.
- Add a full **swap UI** per risen pool: pick in-element, amount, live `quote()` + price impact +
  min-out/slippage, then `swap(...)` with the attestation.
- Add an **LP positions panel**: enumerate the wallet's Constellation Deeds, show pool/shares/
  underlying reserves, and a **withdraw** action.
- Show **live reserves & price** per pool (`getReserves`/`quote`), and keep the existing
  horizon-gating (a pool only trades while risen) — including the **multi-city horizon preview**
  (`renderPoolsCityToggle`) so users can see which pools light up from other cities.
- Honor per-(pool,trader) **nonce** and **deadline**; show clear errors for `AttestationBadNonce`,
  `NoSuchPool`, set-below-horizon, insufficient ESMS, expired attestation.
- Dual-mode: with no wallet/chain, drive the entire UI from simulated reserves/balances/positions,
  banner-labeled "Simulation."

### Phase 4 — Word Duels live
- Wire `castWordOfPower()` to the live `cast_word` reducer (exact signature from `reducers.rs`):
  submit the word + opponent, render the planetary agent's reply and the server-scored result,
  and reflect token/economy changes from the live tables. Keep the offline solver as the
  dual-mode fallback.

### Phase 5 — Faction & Zone dashboards
- Make **Faction Standings** and **Zones weather & ownership** live and interactive: drive from
  subscribed tables, add drill-in detail, and reflect real-time changes (zone control, faction
  scores). Add empty/loading states. Keep derived/offline rendering as fallback.

### Cross-cutting robustness (apply throughout)
- **Loading / empty / error** for every async surface — no bare "Charting the sky…" hangs, no
  silent catches. Errors are actionable.
- **Toasts:** a themed, non-blocking, stacking notification system; replace **every** `alert()`.
- **Accessibility:** keyboard navigation for tabs/modals/pool actions, ARIA roles/labels, focus
  trapping in modals, visible focus rings, and `prefers-reduced-motion` (the sky dome animates).

---

## Acceptance criteria
- The existing game (onboarding, profiles, sky dome, cards, siege, offline duels) still works
  end-to-end after the Vite migration.
- With a Base Sepolia wallet holding ESMS: trace → seed mints a real Deed; swap executes; LP
  positions list and withdraw work; ESMS HUD reflects real balances — all confirmable on
  Basescan.
- With no wallet: every surface renders a complete, clearly-labeled simulation; nothing throws.
- Word Duels record server-side when online; fall back to the offline solver when not.
- Zero `alert()` calls remain. Every async surface has loading/empty/error states. Keyboard-only
  users can reach and operate tabs, modals, and pool actions.
- `npm run build` (Vite) succeeds; type-check/lint clean.

## Guardrails
- No Solidity or Rust on-chain-interface changes. Testnet only. Read `reducers.rs`/`tables.rs` and
  AlchmAgentsETH `ConstellationAMM.sol`/`lib/staking/amm.ts` for exact signatures rather than
  guessing. Never fabricate a visibility attestation client-side — always read it from the module.
  Commit in phases; keep the app runnable between phases.
