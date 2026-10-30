# Prompt — Next Development Session

> **Session Context:** The 3D Vessel Avatar & Agent Court subsystem has reached 100% feature-complete parity across all 71 canonical agents, procedural rendering, shaders, instancing, Web Audio spatial transients, live SpacetimeDB table deltas, and live table melee choreography.
> **Baseline State:** 130 passing court tests (0 skipped, 1,278 assertions) + 26 passing vessel tests (59 assertions across 16 files, all green in <600ms, 1,337 total assertions). Full production build compiles cleanly with code-split court view chunks (~17 kB).
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
     - **Spirit** (Wands): Bandpass flame crackle.
     - **Essence** (Cups): Dual resonant harmonic wave sweep.
     - **Matter** (Pentacles): Sub-bass pitch slam (140 Hz $\to$ 42 Hz).
     - **Substance** (Swords): High-pass filtered noise blade slash.

5. **Live Table Melee Choreography Bridge (`spacetimedb-bridge.ts`, `pentacle-arena-3d.ts`, `court-view.ts`)**:
   - Maps confirmed trick winning card suits directly to ESMS elemental attack choreographies and acoustic transients.
   - Non-blocking pedestal clash queue (`cancelContestsForZone`) fast-forwards prior stages when rapid successive tricks resolve on the same zone pedestal, preventing dropped animations or desync from live multiplayer card tables.
   - Spectator auto-focus mode (`Follow action` toggle button `[data-action="spectate"]` in Court HUD) smoothly pans camera look-at and selects the active pedestal when live trick outcomes or arrivals occur.

6. **Arrival & Contest Timeline with Multi-Category Filtering (`court-view.ts`, `court-view.css`, `spacetimedb-bridge.ts`)**:
   - Filter bar pills (`All`, `Contests`, `Arrivals`, `Ratings`) allow players to isolate specific events without clearing active territory or text query filters.
   - Interactive item selection aligns camera focus with chosen agents and territories.
   - 100% accessible keyboard navigation and modal lifecycle.

7. **SpacetimeDB `agent_rating` Live Arena Sweep (`agent-rating-feed.ts`, `pentacle-arena-3d.ts`)**:
   - Seated avatars update overhead OVR badges in place from live table deltas.
   - Triggers `surge` + foot ring scale pulse (`1.25`) on positive delta, and `stagger` + foot ring compression (`0.85`) on negative delta with smooth lerp recovery, without disrupting active combat or travel.

---

## Verification Commands

- `bun run test:court` — Runs all 130 court tests across 14 files (1,278 assertions, 0 skipped, 0 failed).
- `bun run test:vessel` — Runs all 26 vessel and drawer lifecycle tests (59 assertions, 0 skipped, 0 failed).
- `bun run build` — Full production build producing `dist/` with separate `court-view` dynamic chunks (~17 kB).
- `bun test` — Full repository test suite.

---

## Next Backlog Targets

1. **Solana Settlement Conformance (`docs/SOLANA_MAINNET_CONFORMANCE.md`)**:
   - Complete on-chain star staking verification, conversion escrow sweeps, and wallet sync invariants across Mainnet/Devnet.
   - Wire deterministic escrow settlement reducers and client listeners (`escrow_pentacles_for_conversion`, `settle_pentacle_conversion`, `refund_pentacle_conversion`).
2. **Authored 3D Asset Loading (`vessel-avatar-3d.ts`, `vessel-appearance-manifest.ts`)**:
   - Connect authored GLTF/GLB likenesses via the external-model adapter (`GLTFLoader` + `DRACOLoader`) with non-blocking manifest probe and graceful procedural fallbacks when remote assets fail or load slowly.
