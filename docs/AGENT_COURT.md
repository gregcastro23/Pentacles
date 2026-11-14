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

Names, portraits and metrics share one presentation policy across the map,
roster, inspector and vessel card. Screen-space nameplates retain readable text
while the camera moves, prioritize the selected vessel and suppress overlapping
labels; every vessel remains accessible through the roster. Their portrait,
OVR, rating source and activity follow the current snapshot. The court disables
the older canvas identity badges, avoiding duplicate labels and badge textures.
Standalone arena consumers retain those badges by default.

The expanded inspector includes all seven ratings, four ESMS balances, surge,
named seal tiers, signature relic, territory, likeness status and snapshot age.
Missing readings stay unavailable, measured zero balances remain zero, and stale
values are explicitly labeled. Existing SVG cameos match the procedural models;
custom portrait failures fall back to those cameos without retrying every refresh.
This adds no image-generation calls, external asset service or runtime dependency.
The time dimension is expressed through travel, contests, victory/recovery,
surge and rating freshness rather than a separate rendering engine.

Seal descriptions, category, stat target (when supplied) and tier multiplier are
expandable with touch or keyboard. Live activity and age updates replace only
changed inspector sections. Expanded seals, portrait fallbacks and keyboard
focus survive measured updates; removing the focused seal returns focus to
the inspector. Vessel cards retain scroll position during refresh and keep
previous/next navigation focused across agents. Their name, portrait and close
control remain outside the scrolling metrics body, with reduced-motion CSS.
Snapshot ages advance without a new feed event, including the five-minute stale
boundary. The card uses one local timer, pauses it while hidden, and clears it
on close or destroy; there is no added network polling.

The inspector's **Arrival & Contest Timeline** records:
- **Arrivals**: Seated placements on zone pedestals and zone-to-zone deployments with source and destination tags.
- **Contests**: Active card engagements and trick momentum triumphs between rival agents, tied to specific zones and rounds.
- **Rating Shifts**: Live SpacetimeDB table deltas showing OVR updates and delta direction.
- **Interactive selection**: Clicking any timeline item immediately selects and focuses the corresponding agent model or territory.
- **Category Filter Bar**: Multi-category filter pills (`All`, `Contests`, `Arrivals`, `Ratings`) allow players to isolate specific events without clearing active territory or text query filters.
- **Keyboard focus during updates**: Timeline buttons remain in place as timestamps refresh and new events arrive. If a focused event expires, focus returns to the active category filter. Selecting a vessel highlights only that agent's events; territory selection highlights the zone's events.
- **Readable scrolling cards**: Timeline entries keep their content height inside the scroll area, including wrapped summaries on narrow screens.

Map selection exposes an **Inspect** shortcut. Choosing a roster or timeline
entry, a territory label, or the territory selector brings its details into view
and moves keyboard focus to the details panel. **Focus selected model/territory**
returns to the map with focus on the Inspect shortcut. Automatic Follow action
updates selection without changing the inspector's scroll position or keyboard
focus. On phones, the court header stays visible and camera controls use two
rows with 44-pixel touch targets.
- **Data source parity**: In example mode, deterministic reference events feature Leonardo da Vinci defending the Crown, Isaac Newton contesting House of Aries, Hypatia arriving at House 2, and Emily Dickinson igniting Tempest Surge. In live mode, events stream in real time from `SpacetimeDBBridge`.

## Procedural 3D Vessel Avatar System

- **Combinatorial Trait Mixer (`mixModularTraits`)**: Extends bespoke avatars (such as Newton, Da Vinci, Dickinson, Hypatia, Neo) across all 58 non-bespoke canonical agents with deterministic era-appropriate headwear (`feather-plume`, `circlet-gem`, `crown-spikes`, `laurel-sprig`, `coiffure-ribbon`), facial accents (`wire-spectacles`, `scholar-monocle`, `philosopher-beard`, `mystic-veil`, `goatee-accent`), and collar silhouettes (`winged-pauldrons`, `spiked-guard`, `fur-trim`, `epaulette-tassels`, `stole-brooch`).
- **2D Cameo Portrait Parity**: `createVesselPortraitSvg()` dynamically overlays matching SVG vectors for modular traits onto 2D HUD cameo cards, ensuring complete visual continuity between 2D interface cards and 3D arena models.
- **View-Space Fresnel Rim Shading**: `attachFresnelRim()` injects a lightweight `onBeforeCompile` rim lighting term into torso and garment `MeshStandardMaterial` instances using view-space angle `(1.0 - dot(n, v))^power`, keyed to `material.customProgramCacheKey = () => 'vessel-fresnel-rim'` to avoid shader re-compilations while retaining unique faction rim accents.
- **Instanced Shard Batching (`CourtSealOrbiterBatcher`)**: At 4 or more avatars, shard orbiters use the canonical Copper, Silver, Gold, Astral and Celestial tier buffers. Capacity grows with occupancy; matrices and bounds follow movement. Only represented, visible source shards are hidden, and dropping below the threshold restores them and clears instance counts. Unknown tiers retain their original mesh.
- **Rigid silhouette details**: Compatible opaque siblings sharing a material merge once during construction. Head, garment, relic and other animated attachment boundaries stay intact; transparent and mirrored details remain separate. Geometry, picking, per-vessel materials and live appearance refresh are preserved. `mergeStaticDetails: false` retains the reference path for local comparisons.
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
still applies live destinations and completes contest queues. Quiet scenes draw
approximately four times per second; camera and pointer input invalidate
immediately. When mobile inspection scrolls the map fully offscreen, drawing and
projected labels pause while live state continues advancing. Returning to the
map redraws immediately. Camera controls remain available. Closing releases
animation frames, the resize and visibility observers,
controls, subscriptions and GPU resources. When WebGL is unavailable, the
territory, roster and event timeline inspector remains usable.

The arena limits its drawing buffer to **2,000,000 pixels** and at most 2× device
density, respecting GPU dimension limits. Small displays keep their existing
resolution; larger canvases scale down without changing CSS layout, camera
framing or the HTML inspector. This is a predictable pixel budget, not automatic
FPS-based quality switching. Standalone consumers can set `maxRenderPixels`.

Procedural animation reuses private per-avatar pose and gaze buffers. Each frame
resets targets from immutable rest poses; appearance refresh replaces the cache
so removed relics and surge attachments are no longer animated. Seal instance
updates visit their own branch rather than the entire vessel hierarchy. Lighting,
shadows, animation cadence and visual detail remain unchanged.

Default model loading shares one two-worker Draco pool across overlapping GLTF
requests. Each avatar receives its own scene. When the last load settles, the
pool drains any remaining geometry tasks and releases workers and object URLs;
the next load can initialize a fresh pool. Decoder assets come from the installed
Three package and are served by the same deployment, with notices in
`public/licenses/`. Uncompressed models do not fetch decoder binaries. Existing
custom-loader adapters and procedural fallback remain available.

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

- `bun run test:court` runs 173 tests across 20 test files with 2,878 assertions (100% pass, 0 skipped), verifying identity/portrait parity and fallbacks, missing and measured metrics, nameplate placement, shared geometry lifecycle, reusable-pose isolation and refresh, all 71 silhouettes' shape/triangle parity, merged-detail animation/picking/refresh/disposal, canonical shard counts and capacity growth, pixel limits, decoder sharing/failure/teardown, rendering budgets and offscreen state progression, camera framing, navigation, selection, Fresnel rim shading, 2D/3D trait parity, procedural audio transients, timeline category filtering and keyboard focus, explicit detail inspection and spectator scroll preservation, live rating sweeps, elemental suit mapping, progressive .glb hot-swap, suit-override parity, Solana conversion settlement propagation, non-blocking clash queues, and spectator auto-focus.
- `bun run test:vessel` runs 26 tests (100% pass, 0 skipped, 59 assertions) verifying vessel models, drawer lifecycle, and wallet sync.
- `bun run test:solana` runs 78 tests (100% pass, 0 skipped, 552 assertions) verifying star staking escrow invariants, infallible saturating checkpoints, and CAIP-2 chain boundaries.
- `bun run build` verifies the full production bundle compiles via Vite (with dynamic code-splitting for `court-view.ts` preserved in a separate ~22.6 kB chunk, separate Three core, and async `GLTFLoader`/`DRACOLoader` chunks).
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
  fixture does not connect to a database or write gameplay state. Expand **Local
  render diagnostics** for rendered frames/s, draw calls, triangles and resource
  counts; these local counts are not GPU byte or battery measurements.
- `/tests/fixtures/court-performance-test.html` compares 4/12/24 synthetic vessels
  with merged/unmerged details at the same 2 MP budget, or DPR-only/2 MP pixels
  with merged details in both cases. Both paths include corrected seal rendering.
  It includes an explicit
  2× density simulation for ordinary displays, warm-up periods, frame interval
  and CPU submission percentiles, and a model-loader success/failure/retry check.
  Update and render submission timings are separate. **Shadow cost (diagnostic)**
  measures shadow draw calls and compares shadows on/off only in the fixture;
  production shadows remain enabled. This is not a GPU timing measurement.
  Resizing, hiding the tab or pressing Stop discards the in-progress sample.

Validated on 2026-10-30: 136 court tests passed (0 skipped), 26 vessel tests passed, 78 solana tests passed (1,925 total assertions),
and the production build passed cleanly. Browser checks covered both outcome poses,
return to surge, queued strikes, reduced motion, timeline category filtering, and persistent Overview framing.

Validated on 2026-11-01: all 140 court tests and the production build passed.
Browser checks confirmed timeline focus survives timestamp refreshes, Enter selects
the correct vessel, and same-zone agents have distinct selection states. The
synthetic contest preview still displays confirmed trick reactions. Narrow-screen
timeline entries retain their full content height instead of compressing text
past card borders. Existing Three.js mixed-import and chunk-size build warnings
remain non-blocking.

Validated on 2026-11-03: all 141 court tests and the production build passed.
Browser checks at 1280×720 and 320×740 verified detail inspection, the keyboard
round trip back to the map, a visible header, and camera controls within the
viewport. The synthetic preview now uses the reducer's one-based trick numbers;
both the first result and queued second result match their timeline labels.

Rendering audit on 2026-11-03: all 144 court tests and the production build passed.
Browser diagnostics verified a quiet Motion off sample at 4 rendered frames/s,
zero draws while mobile inspection hid the map, and rendering on return. Live
results still update the inspector. The Three core split now handles `.nosync`
dependency paths; the mixed-import warning is resolved, while size warnings
remain. See [technology research and follow-ups](COURT_TECH_RESEARCH.md) for
measurements, compatibility considerations and cost-conscious priorities.

Quality and loader follow-up on 2026-11-04: 151 court tests and the production
build passed. The high-density fixture reduced canvas pixels by 33.9% at a
1,398×540 CSS viewport, with unchanged draw counts and approximately 16.7 ms
median frame intervals. Browser checks verified separate scenes from concurrent
model loads, malformed-GLTF failure and successful retry. Real compressed-asset
download/decode comparisons remain pending an authored model; the current
browser loader check uses a small uncompressed in-memory triangle.
The 320×740 browser check also confirmed a 320×390 canvas, preserved selection
and the inspector-to-map focus round trip, with no browser errors.

Draw-call follow-up on 2026-11-04: 156 court tests and the production build passed.
Fixed a tier-name mismatch that hid seal shards without creating replacement
instances at four or more vessels. The fair, corrected-reference comparison
reduced draw calls by 17.1%, 20.3% and 21.0% at 4/12/24 vessels, with equal
triangle counts. At 24 vessels, calls fell from 3,470 to 2,741 and renderer geometry
objects from 1,038 to 795. CPU submission p50 fell from 34.1 to 29.2 ms in this
short run; frame intervals varied and do not establish an FPS gain. Browser
checks covered example seals, model focus and queued/confirmed contest reactions.
Full measurements and limitations are in [the research record](COURT_TECH_RESEARCH.md).

Animation follow-up on 2026-11-04: 158 court tests and the production build pass.
Across 116 before/after sampled poses, transforms match exactly; temporary math
clones during 896 updates fell from 48,064 to zero. In the 24-vessel browser case,
update p50 fell from 0.6 to 0.3 ms with unchanged draw counts and visual detail.
Frame intervals remained around 16.7 ms. Separate shadow diagnostics identified
833 of 2,741 draws as shadow work; production retains shadows. These are CPU and
draw measurements, not GPU timing, battery savings or a universal FPS guarantee.

Identity and metrics follow-up on 2026-11-04: 169 court tests, 26 vessel tests
and the production build pass. Browser checks at 1280×900 and 320×740 verified
loaded portraits, readable names, no horizontal overflow, selection and the
inspector-to-map focus round trip. The synthetic live fixture confirmed matching
victory/recovery labels on nameplates and inspector while unavailable ledger
readings remain explicit. Browser checks reported no errors. Existing bundle-size
warnings remain; no new dependencies or paid services were introduced.

Inspection follow-up on 2026-11-05: 173 court tests (2,878 assertions), 26 vessel
tests and the production build pass. Browser checks confirmed automatic live-to-stale
label changes without a new snapshot, expanded seals and keyboard focus surviving
a queued balance update, and 320×740 court/card layouts without horizontal
overflow. Seal summaries provide 44-pixel touch targets. Both browser harnesses
reported no errors. The new `/tests/fixtures/vessel-card-test.html` fixture exercises
quiet-feed freshness and delayed updates using synthetic data only. Existing
bundle-size warnings remain; this change adds no dependencies or paid services.

## Participating agents on the sky board — corrected 2026-11-09

The main Pentacles sky board renders every participating historical agent from
actual game seats. There are no faction representatives or champion markers.
`BoardParticipantFeed` joins `melee_seat` to `melee_table` for the current zone,
and the seat's occupant identity to `agent_chart` for canonical identity.
Only Mustering or Seated tables appear; resolved, deleted and unknown-state tables,
human seats, unknown NPCs and unseated historical roster entries are excluded.
Zone ownership is not a placement input: participants can play in neutral or
opposing territory. Each seat has its own avatar; multiple agents share a zone.

Seat anchors lie inside the real pentagram polygons and use the same projection
as the SVG sky board. The layer shares its 30 Hz clock, tracks orbit/lean/zoom,
and matches SVG letterboxing. Existing detailed vessel models are the markers,
with larger silhouettes, their authored clothing palettes and subdued rim lighting.
Faction-colored base rings, name underlines and focus outlines identify teams;
planetary-symbol badges are removed. Names appear on larger maps and on
hover/focus, with full identity in the inspector. The roster includes a faction
color key. Generic aura and ESMS rings are hidden on the board to keep the team
ring unambiguous; ratings and ESMS remain available in the inspector.
The Agents roster lists every participant with portrait, faction and zone and
provides larger touch targets when the map is crowded. The inspector includes
the actual table, seat and game score along with available ratings and balances.
Card selection and native dragging let pointer input pass through to the board.
Inspection never invokes a game reducer. Native dialogs contain focus and Escape
returns to the selected map marker or roster row.

Positions come from the existing subscription facade, with an additional
`agent_rating` identity join for measurements. Occupant identity, canonical key
and snapshot source key must agree. Missing or invalid readings remain pending;
measured metrics retain partial/stale labels. Initial incomplete subscriptions
show Syncing; disconnect clears all participants instead of creating simulated
positions. Reconnect must receive fresh tables, seats and chart identities.
No new polling, dependencies or paid services are introduced.

Board and court expose **Sharp / Balanced** rendering. Sharp supersamples
standard-density screens at 1.5×, caps DPR at 2× and framebuffers at four million
pixels; Balanced retains the two-million-pixel ceiling. GPU texture limits still
apply. Switching quality leaves framing, selection and CSS size intact. The board
uses one antialiased context, no shadow passes, reduced-motion rendering and
hidden/offscreen/modal suspension. WebGL loss leaves usable portrait markers.
Disposal removes observers, drag listeners, subscriptions, models and GPU resources.

`tests/fixtures/board-avatar-test.html` now supplies 24 synthetic historical seats
at four active tables, including six participants in a single zone. Controls move
a table, resolve the Crown table, remove a seat, disconnect and reset. The fixture
uses no network or game writes. Regression tests cover all participants, historical
seat exclusion, table movement, identity isolation, disconnect/reconnect, and every
1–6-seat arrangement against the actual `public/sky.js` zone classifier.

Local startup also exposed the `.nosync` dependency symlink being treated as
source code, serving CommonJS Buffer directly and aborting the ESM entry. Vite now
preserves the `node_modules` symlink and deduplicates Three.js. This follows Vite's
[linked-dependency behavior](https://vite.dev/guide/dep-pre-bundling.html) and
[symlink resolution option](https://vite.dev/config/shared-options#resolve-preservesymlinks).
The browser then loaded the main ESM app and board layer successfully.

Participant correction verification on 2026-11-09: 185 court tests (3,138
assertions) and the production build pass. The 24-seat browser fixture verified
six agents moving together with their table, six departing on resolution, one
individual seat departure, disconnect clearing, reconnect hydration, and nested
roster/inspector focus return. At 390px all 24 participants remain represented,
roster rows measure at least 58px high, and controls sit below the board without
horizontal overflow. The browser reported no errors. The test suite also checks
66 actual seats across eleven full tables without selecting representatives.
These checks use synthetic subscriptions, not a production database mutation.
Existing bundle-size warnings remain.

Detailed-avatar presentation verified on 2026-11-09: the same 185 court tests and
production build pass after removing symbol badges and enlarging the existing
models. Browser checks confirm avatar-body inspection, the named faction color
key, all 24 participants, and a 390px layout without horizontal overflow. Model
materials are adjusted only in the board layer; the full court retains its
existing effects. No additional assets, dependencies or services are required.

## Full-body likeness upgrade — 2026-11-09

The historical rig was traced to [Pentacles PR #75](https://github.com/gregcastro23/Pentacles/pull/75)
and its articulated-body upgrade (`1d4c80a`). The checked PRs, branches and local
ASOL asset folders did not contain a separate authored GLB collection. Following
the requested build direction, the existing full-detail rig now uses shaped
shoulders and waists, pleated garments, rounded sleeves and legs, necks, cuffs,
thumbs, and fitted coat seams/buttons. Existing historical headgear, hair, armor,
relics and animation pivots remain. Geometry sharing and static merging continue;
the board does not substitute a simplified LOD.

All 71 existing ASOL painted portraits are mapped by canonical agent ID and
encoded offline at their original 512×512 resolution. WebP assets total
3,518,658 bytes versus 33,242,279 bytes of PNG originals. This first pass attached
a framed portrait to the articulated head pivot. The portrait-derived 3D face
pass below supersedes those medallions; the source pictures remain in profiles.

The shared roster, inspector and vessel-card presentation uses the same portraits,
with the existing SVG cameo fallback. `scripts/sync-avatar-portraits.mjs` rebuilds
assets from a local ASOL checkout using its installed Sharp package; source paths
and original-image hashes are recorded in `public/avatars/historical/sources.json`.
No generation API, external image host or new package is required.

Selecting a board participant now opens a larger full-body model preview with
drag and arrow-key rotation, faction base ring and the existing measured metrics.
It allocates one extra WebGL context only while open, uses the board's clock at
up to 15 frames/s, and stops idle drawing with reduced motion. Closing destroys
the model, texture and renderer. The main board retains all active seats at their
actual table zones, with authored clothing colors and faction-colored bases.

Validation: 191 court tests pass across 22 files (3,601 assertions), and the Vite
production build passes with the existing chunk-size warning. New checks cover
all 71 shipped portrait mappings, texture-load failure, head-pivot attachment,
late completion and idempotent resource disposal. Browser verification at the
available 461×747 viewport found no horizontal overflow and confirmed 24 seats,
table relocation, resolved-seat removal, disconnect/reset, visible clothing and
armor, keyboard rotation and Escape focus return. The inspector adds one canvas
while open and removes it when closed. The fixture deliberately includes coats,
dresses, robes and armor across four synthetic tables and makes no game writes.

## Lighting and inspection refinement — 2026-11-10

Board figures and their inspector now share a small, locally generated studio
reflection environment. Three softbox surfaces provide readable highlights on
metal armor, trim and relics. The 64px source cubemap is prefiltered once per
renderer, rebuilt after context restoration, and disposed with that renderer.
It requires no HDR image download, paid service, new dependency or shadow pass.

The inspector offers **Full figure** and **Face & attire**, plus drag/arrow-key
rotation and a reset button/Home shortcut. Framing measures the visible body,
head and held props in local coordinates, excludes aura/orbiters, and leaves
room for a full yaw rotation. The name, faction, current seat and Close control
remain in a sticky header. Wide screens show the figure and metrics side by side;
phones use a single column. Unmeasured data remains explicitly unavailable.

The preview retains the existing 15 Hz clock and reduced-motion behavior, with a
650,000-pixel ceiling and a maximum 2× density. Visibility monitoring accounts for
both scroll clipping and coverage by the sticky header, including header resizing.
Offscreen/hidden previews stop drawing and redraw when visible. Context loss
reveals the portrait and measurements, moves focus out of hidden controls, and
restores the model after recovery. Closing disconnects both observers and releases
the environment render target along with the existing model/texture resources.

Validation: 194 court tests pass across 23 files (3,820 assertions); production
build and whitespace checks pass. New geometric checks cover all 71 figures and
props at three aspect ratios and eight yaw angles, detail framing, exclusion of
hidden geometry, and independence from board position/scale. Browser checks cover
1280×720 and 390×844 layouts, visible metal reflections, detail selection, sticky
identity while reading the final metrics, keyboard reset and Escape focus return.
Existing bundle-size warnings remain. This pass changes no seats or game state.

## Portrait-derived 3D faces — 2026-11-10

All 71 historical profile pictures now supply a distinct, offline-generated face
mesh shared by the board, inspector and court. The picture stays in the profile
header; the model has a lit nose, cheeks, lips, jaw, ears, eyes and a closed skull
instead of a framed image. Face materials use vertex pigmentation, with no UVs,
portrait planes or image textures. Existing articulated bodies and faction rings
remain, with hair/headgear moved behind the face and facial accessories fitted
to the estimated landmarks. Long beards curve forward to clear the collar.
Random face accents from the older trait mixer are hidden when a measured face
loads; character-specific authored facial hair remains. This prevents seeded
beards, veils or eyewear from overriding the portrait likeness.

The local authoring script uses [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
to estimate landmarks and depth from each painted portrait. These are stylized
likenesses estimated from one image, not scans or photoreal reconstructions. The
71 JSON meshes plus provenance manifest total 1,206,731 bytes and load only when
their avatar is used. A bounded canonical-identity cache stores data, while each
avatar owns and disposes its scene resources. Invalid/missing assets preserve the
original head; late loads cannot recreate removed avatars. Appearance refresh
retains the same face and refits newly created hair and accessories.

No portrait uploads, generation API charges, inference server or runtime ML
dependency are required. The authoring model remains outside the repository.
[Reproduction instructions](../public/avatars/faces/README.md) document pinned
Python packages, official model/topology sources and source hashes. The shipped
canonical topology carries its Apache-2.0 attribution in `public/licenses/mediapipe.txt`.

Validation: 197 court tests across 23 files pass (4,685 assertions), covering all
71 source-image hashes, distinct finite meshes, actual depth, absence of image
maps, framing, failed/late loads, shared avatar refresh, disposal and beard/collar
occlusion and exclusion of random facial accents. Browser checks confirm side
rotation, beard/collar clearance, visible profile photos, a 390px layout without
horizontal overflow, Escape focus return and preview-canvas removal on close.
The browser reports no errors. The production build passes with existing
bundle-size warnings.

## Pentacle floor outline & conduit alignment — 2026-11-13

`PentacleArena3D` now aligns `getZonePosition3D` directly with the canonical 2D
sky partition (`public/sky.js` and `src/alchm-chart/zone-access.js`), placing
**Spire I** at North (`-Z`), keeping every Spire equidistant from its two adjacent
Houses, and removing the overview `House I` / `Crown` label overlap.

`buildSacredFloor()` renders `SacredPentacleFloor` using planar XZ ribbon, ring,
and partition geometries (outer double gold bezel and inscribed circle, 5-pointed
pentagram star with underglow, central Crown pentagon and tangent circle, 11-zone
floor shading, and House/Spire anchor medallions). `buildLeyLineConduits()` pairs
the bright centerline with instanced 3D conduits (`LeyLineStarBeams` and
`LeyLineCrownBeams`) anchored to the upper pedestal rims, with `castShadow = false`
and no-op raycasting on all decorative overlays. `scripts/smoke.test.mjs` also mocks
`document.getElementsByTagName` and `document.head.appendChild` for Vite dynamic
CSS preloading when `main.js` boots `BoardAvatarLayer`.

Validation: `bun run test:court` passes 201 tests across 24 files (5,530 assertions),
`bun run test:all` passes cleanly, `cargo test --locked --manifest-path server/Cargo.toml`
passes 127 tests (1 ignored), and `bun run build` succeeds. Browser verification
confirmed both Overview and Top view pentacle geometry with zero console errors.
