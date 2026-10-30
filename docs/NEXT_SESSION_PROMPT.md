# Prompt — Next Development Session

> **Session Context:** The 3D Vessel Avatar & Agent Court subsystem, Solana Settlement Conformance, and Progressive .glb Hot-Swap systems have reached 100% feature-complete parity across all 71 canonical agents, procedural rendering, shaders, instancing, Web Audio spatial transients, live SpacetimeDB table deltas, live table melee choreography, and on-chain escrow/staking sweeps.
> **Baseline State:** 136 passing court tests (0 skipped, 1,314 assertions) + 26 passing vessel tests (59 assertions) + 78 passing Solana tests (552 assertions across 6 suites, 1,925 total assertions). Full production build compiles cleanly with code-split court view chunks (~17.2 kB) and async GLTF/DRACO loader chunks.
> Paste this into a fresh session at repo root (`/Users/cookingwithcastro/Desktop/Spacetimedbhackathon/Pentacles`).

---

## Current Operational State (Verified & Tested)

1. **Procedural 3D Vessel Avatar Engine (`vessel-avatar-3d.ts`, `vessel-silhouettes.ts`)**:
   - 13 bespoke historical silhouettes (Newton, Da Vinci, Dickinson, Hypatia, Neo, etc.).
   - `mixModularTraits(agentId, era, seed)` dynamically provisions the remaining 58 canonical agents with deterministic, era-appropriate headwear (`feather-plume`, `circlet-gem`, `crown-spikes`, `laurel-sprig`, `coiffure-ribbon`), facial accents (`wire-spectacles`, `scholar-monocle`, `philosopher-beard`, `mystic-veil`, `goatee-accent`), and collar accents (`winged-pauldrons`, `spiked-guard`, `fur-trim`, `epaulette-tassels`, `stole-brooch`).
   - Smooth cylinder limb geometry (14–16 radial segments) with smooth normals.
   - View-space Fresnel rim lighting hook (`attachFresnelRim`) on primary garments and torsos with shared shader program cache key `vessel-fresnel-rim`.

2. **Progressive .glb Hot-Swap & Suit Pose Override (`vessel-avatar-3d.ts`, `vessel-appearance-manifest.ts`)**:
   - Zero-latency procedural spawn at frame 0 with background `GLTFLoader` hot-swap into live `avatarRoot`.
   - Swaps only the inner figure child mesh (`wrapper`) while preserving `SealOrbiters`, `UnderFootResonanceRing`, and overhead HUD badges.
   - Runs `applyVesselShadowPolicy()` and `attachFresnelRim()` on imported materials and falls back to the procedural rig if the model fails or 404s.
   - Dynamic card-suit elemental override (`avatar.userData.attackElementOverride = element`) lets `updateVesselAvatarAnimation()` drive the matching 3D skeletal choreography (spirit thrust, essence wave sweep, matter ground slam, substance pirouette slash) and orbiter velocities, synchronizing visual combat choreography with `CourtAudioSynth`.

3. **2D Cameo SVG Trait Parity (`vessel-appearance-manifest.ts`)**:
   - `createVesselPortraitSvg()` renders SVG paths and circles for all modular traits, locking 2D HUD cameo cards and 3D arena models together in visual identity.

4. **5-Tier Instanced Shard Batching (`pentacle-arena-3d.ts`)**:
   - `CourtSealOrbiterBatcher` transitions avatar shard orbiters to 5 tier `THREE.InstancedMesh` buffers (Copper, Bronze, Silver, Gold, Astral) when occupancy $\ge 4$.
   - Seamlessly falls back to individual meshes when occupancy drops below 4, resetting instanced counts to 0 to prevent ghost shards.
   - Disposes all 5 tier geometries and materials upon arena teardown.

5. **Elemental Combat Web Audio Synth (`court-audio-synth.ts`, `pentacle-arena-3d.ts`)**:
   - Standalone zero-dependency procedural Web Audio synthesizer mapped to the 4 ESMS elemental attack choreographies:
     - **Spirit** (Wands): Bandpass flame crackle.
     - **Essence** (Cups): Dual resonant harmonic wave sweep.
     - **Matter** (Pentacles): Sub-bass pitch slam (140 Hz $\to$ 42 Hz).
     - **Substance** (Swords): High-pass filtered noise blade slash.

6. **Live Table Melee Choreography Bridge (`spacetimedb-bridge.ts`, `pentacle-arena-3d.ts`, `court-view.ts`)**:
   - Maps confirmed trick winning card suits directly to ESMS elemental attack choreographies and acoustic transients.
   - Non-blocking pedestal clash queue (`cancelContestsForZone`) fast-forwards prior stages when rapid successive tricks resolve on the same zone pedestal, preventing dropped animations or desync from live multiplayer card tables.
   - Spectator auto-focus mode (`Follow action` toggle button `[data-action="spectate"]` in Court HUD) smoothly pans camera look-at and selects the active pedestal when live trick outcomes or arrivals occur.

7. **Solana Settlement & Escrow Conformance (`spacetimedb-bridge.ts`, `live-wallet-sync.ts`)**:
   - Monitors `pentacle_conversion_escrow` and `star_stake` SpacetimeDB tables with strict integer/atom precision bounds.
   - Formats 6-dp USDC principal and 18-dp claimed essence atoms without lossy float coercion.
   - Propagates confirmed conversion settlements into `liveWalletSync`, refreshing seated avatars (`refreshAvatar`) and upgrading seal tiers in-place, while recording settlement events in the Ratings timeline.

8. **Arrival & Contest Timeline with Multi-Category Filtering (`court-view.ts`, `court-view.css`, `spacetimedb-bridge.ts`)**:
   - Filter bar pills (`All`, `Contests`, `Arrivals`, `Ratings`) allow players to isolate specific events without clearing active territory or text query filters.
   - Interactive item selection aligns camera focus with chosen agents and territories.
   - 100% accessible keyboard navigation and modal lifecycle.

---

## Verification Commands

- `bun run test:court` — Runs all 136 court tests across 14 files (1,314 assertions, 0 skipped, 0 failed).
- `bun run test:vessel` — Runs all 26 vessel and drawer lifecycle tests (59 assertions, 0 skipped, 0 failed).
- `bun run test:solana` — Runs all 78 Solana conformance tests across 6 files (552 assertions, 0 skipped, 0 failed).
- `bun run build` — Full production build producing `dist/` with separate `court-view` dynamic chunks (~17.2 kB) and async loader chunks.
- `bun test` — Full repository test suite.
