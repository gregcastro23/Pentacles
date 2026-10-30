# Agent Court

The map's **3D Agent Court** button opens an interactive view of the existing
eleven-zone arena and procedural agent models. The next UX priority was making
those models discoverable and inspectable in the game: previously the arena
was only available through `mountPentacleVesselDemo`.

The court supports orbit and pinch navigation, overview and top views, model
focus, named territories, a searchable roster, an arrival and contest event timeline,
and a shared map/roster selection ring. Its inspector shows identity, faction,
territory, activity, ratings, signature relics, and a live or sample chronological feed
of zone deployments, relocations, card strikes, and trick momentum victories.
Territory details show control, flux and faction access. The layout stacks on phones;
native dialog behavior contains keyboard focus, Escape closes the view, and focus
returns to the launcher.

The inspector's **Arrival & Contest Timeline** records:
- **Arrivals**: Seated placements on zone pedestals and zone-to-zone deployments with source and destination tags.
- **Contests**: Active card engagements and trick momentum triumphs between rival agents, tied to specific zones and rounds.
- **Rating Shifts**: Live SpacetimeDB table deltas showing OVR updates and delta direction.
- **Interactive selection**: Clicking any timeline item immediately selects and focuses the corresponding agent model or territory.
- **Category Filter Bar**: Multi-category filter pills (`All`, `Contests`, `Arrivals`, `Ratings`) allow players to isolate specific events without clearing active territory or text query filters.
- **Data source parity**: In example mode, deterministic reference events feature Leonardo da Vinci defending the Crown, Isaac Newton contesting House of Aries, Hypatia arriving at House 2, and Emily Dickinson igniting Tempest Surge. In live mode, events stream in real time from `SpacetimeDBBridge`.

## Procedural 3D Vessel Avatar System

- **Combinatorial Trait Mixer (`mixModularTraits`)**: Extends bespoke avatars (such as Newton, Da Vinci, Dickinson, Hypatia, Neo) across all 58 non-bespoke canonical agents with deterministic era-appropriate headwear (`feather-plume`, `circlet-gem`, `crown-spikes`, `laurel-sprig`, `coiffure-ribbon`), facial accents (`wire-spectacles`, `scholar-monocle`, `philosopher-beard`, `mystic-veil`, `goatee-accent`), and collar silhouettes (`winged-pauldrons`, `spiked-guard`, `fur-trim`, `epaulette-tassels`, `stole-brooch`).
- **2D Cameo Portrait Parity**: `createVesselPortraitSvg()` dynamically overlays matching SVG vectors for modular traits onto 2D HUD cameo cards, ensuring complete visual continuity between 2D interface cards and 3D arena models.
- **View-Space Fresnel Rim Shading**: `attachFresnelRim()` injects a lightweight `onBeforeCompile` rim lighting term into torso and garment `MeshStandardMaterial` instances using view-space angle `(1.0 - dot(n, v))^power`, keyed to `material.customProgramCacheKey = () => 'vessel-fresnel-rim'` to avoid shader re-compilations while retaining unique faction rim accents.
- **Instanced Shard Batching (`CourtSealOrbiterBatcher`)**: When 4 or more avatars populate the court, shard orbiters automatically transition to 5 tier-specific `THREE.InstancedMesh` buffers (Copper, Bronze, Silver, Gold, Astral) running in a single draw pass per tier. When occupancy drops below threshold, shards safely restore individual mesh visibility and reset instanced counts to 0 to prevent ghost shards.
- **Elemental Combat Web Audio Synthesis (`CourtAudioSynth`)**: Zero-dependency procedural Web Audio synthesizer triggers distinct acoustic transients mapped to the 4 ESMS elemental attack choreographies during zone clashes:
  - **Spirit**: Bandpass-filtered crackle with exponential decay.
  - **Essence**: Dual resonant harmonic sine/triangle wave sweep.
  - **Matter**: Heavy sub-bass pitch drop (140 Hz $\to$ 42 Hz).
  - **Substance**: High-pass filtered noise blade slash.
- **Progressive .glb Hot-Swap & Procedural Fallback**: Zero-latency procedural spawn at frame 0 with background `GLTFLoader` hot-swap into live `avatarRoot`. Swaps only the inner figure/armature child mesh while strictly preserving `SealOrbiters`, `UnderFootResonanceRing`, and overhead HUD badges. Applies `applyVesselShadowPolicy()` and `attachFresnelRim()` to imported materials using faction colors, and retains the procedural rig as an interactive fallback if the URL returns 404 or fails validation.
- **Skeletal Suit-Override Parity**: Setting `winner.avatar.userData.attackElementOverride = element` during trick outcomes and zone contests lets `updateVesselAvatarAnimation()` drive matching 3D skeletal choreography (spirit overhead spear thrust, essence dual-arm wave sweep, matter knee-bend slam, substance pirouette slash) and orbiter velocities, synchronizing visual combat choreography with `CourtAudioSynth` even if the agent's innate dominant ESMS stat differs.
- **Deterministic Solana Settlement & Escrow Sweeps**: `SpacetimeDBBridge` monitors `pentacle_conversion_escrow` and `star_stake` tables. Enforces integer atom bounds without lossy float coercion, formats 6-dp USDC principal and 18-dp claimed essence atoms, propagates confirmed settlements through `liveWalletSync` into seated court avatars (refreshing avatars and upgrading seal tiers in-place), and dispatches settlement updates to the Ratings timeline feed.
- **Live Rating Arena Sweep**: Authoritative table deltas update seated avatars in place: updating overhead OVR badges, pulsing `UnderFootResonanceRing` scale (1.25 on positive delta, 0.85 on negative delta with smooth lerp restoration), and triggering non-interruptive surge or stagger reactions.

Live court uses the application's SpacetimeDB facade and the existing seat
bridge. Offline and syncing states are explicit. Example vessels are a separate,
opt-in preview; switching modes destroys the old scene and its subscriptions.
Missing ratings display as pending rather than presenting fallback values as
measured ratings. Historical NPC ratings now arrive through the owner-authenticated
[ASOL rating feed](AGENT_RATING_FEED.md). Example/cache ratings cannot populate live
seats. The inspector identifies current, partial, and stale snapshots, including
unavailable ESMS/seals or sky readings. A provisional natal chart can have valid
ratings; chart provenance is separate from a missing rating feed.

Motion defaults to the user's reduced-motion preference. Disabling motion
still applies live destinations and completes contest queues. Camera controls
remain available. Closing releases animation frames, the resize observer,
controls, subscriptions and GPU resources. When WebGL is unavailable, the
territory, roster and event timeline inspector remains usable.

This is a read-only inspection surface. It does not move agents, submit
contests, change ownership or edit models on the server.

## Confirmed trick reactions & Live Table Melee Choreography

Fresh card plays animate attack and defense. A new `melee_trick` result queues
a separate reaction after the preceding strikes: the recorded winner raises
its relic in victory, and its last opposing participant recoils. A card play
alone never implies a winner. Both reactions run for 1.6 seconds, then restore
the latest idle or surge state. The inspector labels the winner as celebrating
and the opponent as recovering.

### Live Table Melee Choreography Bridge & Elemental Suit Mapping
- **Winning Card Suit to ESMS Elemental Attack**:
  - **Wands** $\to$ `spirit`: triggers flame crackle audio transient and spirit strike choreography.
  - **Cups** $\to$ `essence`: triggers dual resonant harmonic wave sweep and essence arc choreography.
  - **Pentacles** $\to$ `matter`: triggers heavy sub-bass pitch drop (140 Hz $\to$ 42 Hz) and matter slam choreography.
  - **Swords** $\to$ `substance`: triggers high-pass filtered noise blade slash and substance slash choreography.
- **Non-Blocking Pedestal Clash Queue (`cancelContestsForZone`)**:
  - When rapid successive tricks resolve on the same zone pedestal before the 1.1s clash window or 1.6s outcome window elapses, the prior stage fast-forwards immediately into the new clash. Active combat state never drops frames, leaks unresolved promises, or desyncs from the live multiplayer card table.
- **Spectator Auto-Focus Mode (`Follow action`)**:
  - The Court HUD includes an interactive `Follow action` toggle button (`[data-action="spectate"]`).
  - When enabled, incoming live trick outcomes, combat beats, or agent arrivals smoothly re-orient camera look-at and focus on the contested pedestal, keeping spectators centered on the table's highest-intensity action in real time.

Reactions preserve seat positions, selection, ratings and authoritative
territory control. A departed or travelling participant is not pulled back into
an old result. Movement, removal and scene teardown settle pending reactions;
reduced motion skips them and drains the queue. Repeated snapshots and the
initial reconnect snapshot do not replay recorded outcomes. Foot rings now
apply the victory pulse and stagger ripple to the rendered transform.

Camera controls share the animated look-at target while focus is moving.
Overview, zoom and manual orbit cancel automatic focus, so inspection no longer
pulls the camera back to a previously selected vessel after a navigation action.

## Verification

- `bun run test:court` runs 136 tests across 14 test files with 1,314 assertions (100% pass, 0 skipped), verifying camera framing, navigation, selection, avatar batching, Fresnel rim shading, 2D/3D trait parity, procedural audio transients, timeline category filtering, live rating sweeps, elemental suit mapping, progressive .glb hot-swap, suit-override parity, Solana conversion settlement propagation, non-blocking clash queues, and spectator auto-focus.
- `bun run test:vessel` runs 26 tests (100% pass, 0 skipped, 59 assertions) verifying vessel models, drawer lifecycle, and wallet sync.
- `bun run test:solana` runs 78 tests (100% pass, 0 skipped, 552 assertions) verifying star staking escrow invariants, infallible saturating checkpoints, and CAIP-2 chain boundaries.
- `bun run build` verifies the full production bundle compiles via Vite (with dynamic code-splitting for `court-view.ts` preserved in a separate ~17.2 kB chunk, and async `GLTFLoader`/`DRACOLoader` chunks).
- `/tests/fixtures/court-test.html` is a local UI harness with no network or
  gameplay writes. Open it under the Vite development server.
- Check live/offline labels, explicit example mode, event timeline items and category filters,
  model focus, search and territory filters, drag without selecting, Escape/reopen,
  and a phone viewport.
- `/tests/fixtures/court-contest-test.html` previews synthetic Newton/Dickinson
  seats and partial ratings through the actual subscription bridge. Use **Inspect
  selected winner** and **Show confirmed trick result** for a reaction, then **Play next
  trick** to check queued strikes before the next result. Change **Preview winner**
  to inspect either outcome; use **Motion off** to check queue completion. The
  fixture does not connect to a database or write gameplay state.

Validated on 2026-10-30: 136 court tests passed (0 skipped), 26 vessel tests passed, 78 solana tests passed (1,925 total assertions),
and the production build passed cleanly. Browser checks covered both outcome poses,
return to surge, queued strikes, reduced motion, timeline category filtering, and persistent Overview framing.
