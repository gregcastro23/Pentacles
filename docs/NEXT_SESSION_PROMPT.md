# Prompt — Next Development Session

> **Session Context:** The 3D Vessel Avatar & Agent Court subsystem has reached 100% feature-complete parity across all 71 canonical agents, procedural rendering, shaders, instancing, Web Audio spatial transients, and live SpacetimeDB table deltas.
> **Baseline State:** 127 passing court tests (0 skipped) + 26 passing vessel tests (1,313 total assertions across 16 files, all green in <600ms). Full production build compiles cleanly with code-split court view chunks.
> Paste this into a fresh session at repo root (`/Users/cookingwithcastro/Desktop/Spacetimedbhackathon/Pentacles`).

---

## Current Operational State (Verified & Tested)

1. **Procedural 3D Vessel Avatar Engine (`vessel-avatar-3d.ts`, `vessel-silhouettes.ts`)**:
   - 13 bespoke historical silhouettes (Newton, Da Vinci, Dickinson, Hypatia, Neo, etc.).
   - `mixModularTraits(agentId, era, seed)` dynamically provisions the remaining 58 canonical agents with deterministic, era-appropriate headwear (`feather-plume`, `circlet-gem`, `crown-spikes`, `laurel-sprig`, `coiffure-ribbon`), facial accents (`wire-spectacles`, `scholar-monocle`, `philosopher-beard`, `mystic-veil`, `goatee-accent`), and collar accents (`winged-pauldrons`, `spiked-guard`, `fur-trim`, `epaulette-tassels`, `stole-brooch`).
   - Smooth cylinder limb geometry (14–16 radial segments) with smooth normals.
   - View-space Fresnel rim lighting hook (`attachFresnelRim`) on primary garments and torsos with shared shader program cache key `vessel-fresnel-rim`.

2. **2D Cameo SVG Trait Parity (`vessel-appearance-manifest.ts`)**:
   - `createVesselPortraitSvg()` renders SVG paths and circles for all modular traits, locking 2D HUD cameo cards and 3D arena models together in visual identity.

3. **5-Tier Instanced Shard Batching (`pentacle-arena-3d.ts`)**:
   - `CourtSealOrbiterBatcher` transitions avatar shard orbiters to 5 tier `THREE.InstancedMesh` buffers (Copper, Bronze, Silver, Gold, Astral) when occupancy $\ge 4$.
   - Seamlessly falls back to individual meshes when occupancy drops below 4, resetting instanced counts to 0 to prevent ghost shards.
   - Disposes all 5 tier geometries and materials upon arena teardown.

4. **Elemental Combat Web Audio Synth (`court-audio-synth.ts`, `pentacle-arena-3d.ts`)**:
   - Standalone zero-dependency procedural Web Audio synthesizer mapped to the 4 ESMS elemental attack choreographies:
     - **Spirit**: Bandpass flame crackle.
     - **Essence**: Dual resonant harmonic wave sweep.
     - **Matter**: Sub-bass pitch slam (140 Hz $\to$ 42 Hz).
     - **Substance**: High-pass filtered noise blade slash.

5. **Arrival & Contest Timeline with Multi-Category Filtering (`court-view.ts`, `court-view.css`, `spacetimedb-bridge.ts`)**:
   - Filter bar pills (`All`, `Contests`, `Arrivals`, `Ratings`) allow players to isolate specific events without clearing active territory or text query filters.
   - Interactive item selection aligns camera focus with chosen agents and territories.
   - 100% accessible keyboard navigation and modal lifecycle.

6. **SpacetimeDB `agent_rating` Live Arena Sweep (`agent-rating-feed.ts`, `pentacle-arena-3d.ts`)**:
   - Seated avatars update overhead OVR badges in place from live table deltas.
   - Triggers `surge` + foot ring scale pulse (`1.25`) on positive delta, and `stagger` + foot ring compression (`0.85`) on negative delta with smooth lerp recovery, without disrupting active combat or travel.

---

## Verification Commands

- `bun run test:court` — Runs all 127 court tests across 14 files (1,254 assertions, 0 skipped, 0 failed).
- `bun run test:vessel` — Runs all 26 vessel and drawer lifecycle tests (59 assertions, 0 skipped, 0 failed).
- `bun run build` — Full production build producing `dist/` with separate `court-view` dynamic chunks.
- `bun test` — Full repository test suite.

---

## Next Backlog Targets

1. **Authored 3D Asset Loading**:
   - Connect authored GLTF likenesses via the external-model adapter in `vessel-avatar-3d.ts` with procedural fallbacks when remote GLTF assets fail or load slowly.
2. **Real-time Live Table Melee Choreography**:
   - Bridge live game table trick resolution directly into the 3D court arena so spectator mode reflects ongoing multiplayer trick matches in real time.
3. **Solana Settlement Conformance**:
   - Complete on-chain star staking verification and conversion escrow sweeps per `SOLANA_MAINNET_CONFORMANCE.md`.
