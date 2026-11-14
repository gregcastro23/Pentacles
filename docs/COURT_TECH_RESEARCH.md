# Court technology decisions — 2026-11-03

The best next step is to make the existing court measurably efficient and
resilient. Keep the current renderer while improving its scheduling, asset
lifecycle, and delivery. None of the proposed first steps requires a paid API,
hosted analytics service, or new rendering framework. Engineering time and
browser compatibility are the main costs.

Sources were checked on 2026-11-03. The starting-point observations below precede
this audit's changes; the implementation section records what is now verified
locally. Remaining recommendations are proposals, not deployed features.

## Implemented and verified locally

- Added a small rendering budget: animated scenes retain their normal cadence;
  quiet **Motion off** scenes draw approximately four times per second. Camera,
  pointer, resize, selection and live event changes invalidate immediately.
  A periodic redraw also covers asynchronous model/rating changes.
- An Intersection Observer suspends drawing and projected-label updates when
  the map is fully offscreen. Simulation and subscription processing continue;
  reentry redraws immediately. Browsers without this observer retain normal
  visibility behavior. Closing disconnects the observer and input listeners.
- The contest fixture now exposes local rendered-frame, draw-call, triangle,
  geometry and texture counts. It handles scene replacements and the WebGL
  fallback without wrapping the renderer. No telemetry leaves the browser.
- Fixed the Three core chunk matcher for both ordinary and `.nosync` dependency
  paths, retaining async GLTF/Draco loader chunks. Replaced the deprecated soft
  PCF shadow setting with the PCF setting it already fell back to.

Validation: 144 court tests passed (1,370 assertions, 15 files). The production
build passed. A deterministic 60-frame sample yielded 60 draws with motion and
four quiet draws without it; an integration test completed travel while drawing
was suspended and checked reentry, input invalidation and teardown. In the
browser's two-vessel fixture, the diagnostic sample changed from 60 to 4 rendered
frames/s; mobile inspection showed 0 while the map was offscreen, then resumed
on return. These are renderer-submission counts, not measured battery savings.
The simulation RAF remains active while the document is visible.

| Audit build sample | Before | After |
| --- | ---: | ---: |
| Main JS | 1,679.87 kB / 454.42 kB gzip | 955.13 kB / 269.18 kB gzip |
| Separate Three core | Included in main | 724.98 kB / 184.97 kB gzip |
| Court JS | 18.22 kB / 6.54 kB gzip | 19.10 kB / 6.83 kB gzip |

This split does **not** reduce total startup bytes: main still eagerly imports
Three. It allows the core's cache entry to survive unrelated application edits.
The mixed static/dynamic Three import warning is gone; the large-chunk warning
remains. Actual network request measurements and adaptive resolution are still
follow-up work. The next implementation below adds frame-time distributions and
4/12/24-vessel load comparisons.

## Pixel budget and decoder follow-up — verified 2026-11-04

Implemented a default two-million-pixel drawing-buffer limit alongside the
existing 2× DPR ceiling. The limit also respects texture, renderbuffer and
viewport dimensions reported by WebGL. Resizing preserves CSS dimensions and
camera aspect, and unchanged dimensions do not reallocate the drawing buffer.
The cap can reduce resolution on large displays; it does not change HTML text
sharpness. Shadow-map pixels and other GPU allocations are outside this budget.
It is a fixed budget, not an FPS controller or a battery-saving measurement.

Default GLTF loading now has an explicit shared lifecycle. Concurrent loads
share initialization and a Draco pool capped at two workers, while decoded
scenes remain avatar-owned. The last load releases the pool after pending
geometry settles, including parser-failure cases; new requests wait for cleanup
before opening another pool. Failed initialization can be retried. Decoder URLs
come from the installed Three package and Vite's static assets, replacing the
Google CDN override. Plain GLTF does not fetch decoder binaries, and can still
load when the optional decoder module is unavailable. Licenses and upstream
notices ship in `public/licenses/`. No packages or recurring services were added.

The local [performance fixture](../tests/fixtures/court-performance-test.html)
compares 4/12/24 vessels, with 1.5 seconds of warm-up and three seconds of sampling
per case. It measures RAF intervals and CPU update/render submission time, not
GPU execution time. Resizing or hiding the page cancels the active sample.
An explicit 2× density simulation exercises the pixel cap even on a 1× display.

Observed at 1,398×540 CSS pixels and simulated 2× density: the reference buffer was
2,796×1,080 (3,019,680 pixels), while the capped buffer was 2,275×878 (1,997,450
pixels): **33.9% fewer canvas pixels**. Both policies produced approximately
16.7 ms median frame intervals in this browser. CPU submission time remained
similar; no FPS improvement is established by this sample.

| Vessels | Draw calls, both policies | Triangles | CPU submit p50, reference / capped |
| --- | ---: | ---: | ---: |
| 4 | 625 | 45,280 | 3.5 / 3.7 ms |
| 12 | 1,765 | 132,956 | 5.5 / 5.5 ms |
| 24 | 3,462 | 266,632 | 9.4 / 9.4 ms |

This is a short warm run on one machine, with repeated procedural examples, not
a hardware compatibility benchmark. These historical counts precede the seal
batching correction below: shards were missing from both pixel-policy cases.
They cannot serve as a complete-rendering baseline for later draw-call savings.

Validation: 151 court tests, 1,412 assertions, and the production build passed.
Browser checks used the actual default loader for concurrent independent scenes,
malformed GLTF, and successful retry. Unit tests cover delayed/failed decode
cleanup and pool recreation. The browser fixture has no compressed geometry;
a real Draco/Meshopt/KTX2 comparison is still deferred because the project has
no authored GLTF or texture assets to compare. Do not ship unused transcoders or
invent compression savings from a synthetic triangle. Build main JS is now
956.31 kB / 269.62 kB gzip; the Draco ownership wrapper remains in an async chunk
(7.71 kB / 3.10 kB gzip), and the large-chunk warning remains.

## Rigid-detail merging and seal correction — verified 2026-11-04

Fixed the existing orbiter batcher's lowercase tier names, which did not match
the canonical `Copper`, `Silver`, `Gold`, `Astral`, `Celestial` values. At four
vessels the old code hid source shards without populating their replacement
instances. Batches now use the rating contract, grow past the original 120-slot
capacity, copy source transforms relative to their container, refresh bounds
after movement and dispose instance buffers on replacement/teardown. Hidden
ancestors are respected; unknown tiers keep their source mesh visible.

Procedural silhouettes now merge compatible rigid, opaque sibling meshes with
the same material once during construction. Local transforms are baked into
geometry; joint and attachment boundaries remain. Transparent sorting, mirrored
meshes, per-avatar material ownership and external GLTF assets are unchanged.
Retired geometry is released only when no remaining attachment mesh references
it. An explicit unmerged option supports comparison and survives rating refresh.

This uses the installed Three geometry utilities with no new package, extension
requirement or service. Modern `BatchedMesh` remains an option for mixed geometry
under one material, while `InstancedMesh` suits identical shard geometry. For
these rigid details, construction-time merging avoids per-frame batch transform
synchronization. The installed renderer's multi-draw fallback and avatar-specific
materials make a broader batching migration a separate measurement task.
Primary references checked 2026-11-04: [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html),
[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

The fixture now offers **Rigid detail batching** and **Pixel budget** comparisons.
The following six samples use the same 1,398×540 CSS canvas, simulated 2× density,
2,275×878 drawing buffer, 1.5 s warm-up and 3 s measurement. Both paths render the
corrected seals. Values are **unmerged → merged**:

| Vessels | Draw calls | Reduction | Triangles, both | Geometries | CPU submit p50 / p95 (ms) | Frame interval p50 / p95 (ms) |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 4 | 633 → 525 | 17.1% | 45,856 | 197 → 161 | 9.5 / 25.7 → 8.1 / 15.2 | 47.4 / 107.4 → 65.3 / 117.8 |
| 12 | 1,773 → 1,413 | 20.3% | 134,684 | 537 → 417 | 18.6 / 28.2 → 16.9 / 21.0 | 31.1 / 108.2 → 38.0 / 106.9 |
| 24 | 3,470 → 2,741 | 21.0% | 270,088 | 1,038 → 795 | 34.1 / 47.4 → 29.2 / 37.2 | 60.6 / 113.1 → 68.6 / 109.2 |

Texture counts stayed at 9/17/29 respectively. Resource counts are renderer
objects, not GPU bytes. CPU submission improved within this run, but frame
intervals were irregular and median intervals worsened; no FPS improvement is
established. Timings should not be compared to the earlier pixel run as if machine
conditions were controlled. Draw and triangle counts provide the stable evidence
for this change. Next profiling should isolate scheduling, shadows and remaining
per-vessel draw calls before adopting adaptive quality or changing renderers.

Validation: **156 court tests, 2,648 assertions, 18 files**, and production build
pass. Tests compare exact bounds/triangles across all 71 canonical appearances,
animated pivots, picking, refresh and disposal; shard tests cover every canonical
tier, 175 same-tier shards, moving bounds, container transforms, hidden sources,
unknown-tier fallback and dropping below the batching threshold. Browser checks
confirmed focused example vessels/seals and queued/confirmed contest reactions
with no reported warnings or errors. Main JS is 962.90 kB / 271.67 kB gzip; Three
core remains 724.98 kB / 184.97 kB gzip. The existing size warning remains.

## Animation allocation and shadow profiling — verified 2026-11-04

Animation now owns reusable pose, ring and gaze scratch buffers in a private
WeakMap per avatar. Targets copy immutable rest transforms before each update;
refresh replaces the workspace when relics or surge attachments change, and
disposal releases it. The orbiter batcher updates the orbiter branch's world
matrices instead of every sibling in the vessel. Rival gaze and neutral ring
scale also reuse arena-owned vectors. No visual, shadow or cadence policy changed.

A one-time before/after check exercised four fixture agents, seven animation
states, all four attack elements, rival gaze and appearance/surge refresh.
All **116 sampled pivot poses matched exactly**. Instrumenting Vector3/Euler/
Quaternion `clone()` during 896 animation updates counted **48,064 → 0** calls.
This is a specific reduction in temporary math objects, not a claim that the
whole frame is allocation-free. Scratch objects remain allocated per live avatar.

The local fixture now separates update/navigation CPU time from render submission,
and counts shadow draws through fixture-only callbacks. **Shadow cost (diagnostic)**
compares enabled/disabled shadows without changing production. Shadow maps require
extra caster draws, but disabling them changes the image and is not a free
optimization. [Three shadow documentation](https://threejs.org/manual/pages/shadows.html)
(checked 2026-11-04).

Two warm browser runs, before and after this change, used the same 1,398×540 CSS
canvas, simulated 2× density, 2 MP limit and merged details. Both measurements
below retain production shadows. Values are **before → after** in milliseconds:

| Vessels | Update p50 / p95 | Render submit p50 / p95 | Total CPU p50 / p95 | Draws (shadow subset), unchanged |
| --- | --- | --- | --- | ---: |
| 4 | 0.2 / 0.4 → 0.2 / 0.3 | 3.2 / 4.6 → 4.0 / 5.4 | 3.4 / 5.0 → 4.2 / 5.6 | 525 (152) |
| 12 | 0.4 / 0.5 → 0.2 / 0.2 | 5.4 / 5.8 → 5.2 / 5.4 | 5.8 / 6.2 → 5.3 / 5.6 | 1,413 (424) |
| 24 | 0.6 / 0.7 → 0.3 / 0.4 | 8.6 / 8.9 → 8.6 / 8.9 | 9.3 / 9.6 → 8.9 / 9.2 | 2,741 (833) |

Median frame intervals stayed approximately 16.7 ms. This short one-device sample
supports less update work; timing variability, including the four-vessel render
increase, precludes a general FPS claim. Draw/triangle/resource counts with
shadows enabled match the previous implementation exactly. These CPU submission
measurements do not isolate GPU execution or battery consumption.

With shadows disabled only for diagnosis, the new run reported 373/989/1,908 draw
calls at 4/12/24 vessels, versus 525/1,413/2,741 with shadows enabled. At 24 vessels,
render submission p50 was 7.6 ms without shadows and 8.6 ms with them; the main
render path still accounts for most CPU submission work. Keep shadows enabled.
Next, inspect remaining repeated geometry/material draws and profile GPU work
before considering shadow fidelity reductions or a renderer migration.

Validation: **158 court tests, 2,769 assertions, 18 files**, production build and
browser winner/focus checks pass. New regression tests cover interleaved rig
isolation, immutable rest/gaze inputs, absence of per-frame math clones and
animation of replacement attachments without touching removed pivots. The
existing movement, batching, GLTF and reduced-motion checks remain green.
Main JS is 963.46 kB / 271.87 kB gzip. No dependency or service was added; the
existing large-chunk warning remains.

## Verified local starting point

| Area | Evidence | Consequence |
| --- | --- | --- |
| Rendering | `court-view.ts` schedules RAF continuously and renders whenever the document is visible, including Motion off. `pentacle-arena-3d.ts` caps DPR at 2 and enables a 2048×2048 directional shadow map. | There is a clear opportunity to avoid unnecessary GPU work, but no FPS or battery improvement has been measured yet. |
| Existing optimizations | Seal orbiters already use instancing; models load progressively with procedural fallback; the inspector retains timeline nodes; motion and teardown tests exist. | Preserve these investments. A framework rewrite would duplicate working behavior. |
| Renderer compatibility | `vessel-avatar-3d.ts` injects its Fresnel shading through `onBeforeCompile`. `package.json` declares Three `^0.185.0`. | WebGPU adoption requires a material migration, not just a constructor swap. |
| Asset loading | The default GLTF loader creates a Draco decoder for each request and has no matching decoder disposal there. It uses a versioned Google-hosted decoder URL. No `.glb`, `.gltf`, `.ktx2`, or `.basis` files were found under `public/`; the manifest exposes runtime registration but has no authored URL assignments. | Fix ownership/lifecycle before scaling authored assets; do not ship unused compression dependencies. |
| Bundling | `node_modules` resolves to `node_modules.nosync`. The current Three chunk rule matches only `node_modules/three`. The Nov3 build log resolves Three through the `.nosync` path: main 1,679.87 kB / 454.42 kB gzip; court chunk 18.22 kB / 6.54 kB gzip. | The intended chunk rule misses this workspace. Splitting the chunk alone does not prove less startup download or duplicate runtimes. |
| Startup imports | `src/main.js` eagerly imports and exposes the complete rated-agent namespace, including a synchronous demo mount API. A source search did not find a global Three script in `index.html` or `public/`. | The older duplicate-global-Three explanation is not established by current evidence. A truly lazy agent entry would require an explicit compatibility decision for that global API. |

Relevant code: [court view](../src/lib/agents/court-view.ts),
[arena](../src/lib/agents/pentacle-arena-3d.ts),
[navigation](../src/lib/agents/arena-navigation.ts),
[avatar loading/materials](../src/lib/agents/vessel-avatar-3d.ts),
[build configuration](../vite.config.js).

## Prioritized decisions

### 1. Measure and control rendering cost — do first

Use browser-native visibility signals and a small scheduler, without adding a
framework. First bound the drawing cadence, skip offscreen drawing, and throttle
Motion off with immediate input invalidation while preserving live simulation.
Defer completely event-driven rendering until every change source is accounted
for. The Three manual describes demand rendering for map viewers and the need
to coalesce changes while OrbitControls damping settles.
[Three: rendering on demand](https://threejs.org/manual/pages/rendering-on-demand.html)

Observe the map itself when mobile inspection scrolls it offscreen. Page
visibility is a separate signal: browsers already commonly suspend RAF in hidden
tabs, so simply adding cancellation is not evidence of a new battery saving.
Keep subscriptions and authoritative state correct while suppressing drawing;
resume with a fresh timing baseline. [Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API),
[Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)

Invalidation must include camera/hover changes, resize, loaded assets, live
ratings/seats, and settled combat queues. In this arena, `cameraFocusTarget` can
remain present after convergence: its existence alone cannot mean animation is
still active. Reduced motion must still finish travel and contest state.

Add local fixture diagnostics for frame count, frame-time distribution, draw
calls, triangles, geometries and textures. Three exposes rendering/resource
counts through `renderer.info`; these are not precise GPU byte measurements.
Use those measurements before adaptive resolution. Cap total drawing-buffer
pixels as well as DPR; a 2× scale means four times as many pixels. Keep the HTML
inspector sharp. [WebGLRenderer diagnostics](https://threejs.org/docs/pages/WebGLRenderer.html),
[Three: resolution budgets](https://threejs.org/manual/pages/responsive.html)

Acceptance: static Motion off draws less often, interaction immediately redraws,
offscreen views stop drawing, reconnect and teardown still work, and a repeatable
4/12/24-vessel fixture records the tradeoffs. Any 30/60 FPS or quality thresholds
are proposed budgets to validate, not guaranteed performance.

### 2. Make delivery predictable — do next

Correct the Three core package-path matching for ordinary and `.nosync` installs;
do not force dynamically imported GLTF/Draco addons into the eager core chunk.
Inspect the built entry graph and actual cold-load requests; moving bytes to a
different chunk improves caching only when import topology and cache headers
permit it. Current Vite documentation uses
`build.rolldownOptions.output.codeSplitting`; migrate configuration deliberately
against the installed Vite version, not by blindly copying a new example.
[Vite production build](https://vite.dev/guide/build.html)

Record raw/gzip asset size and startup-loaded bytes in a local build report before
enforcing a budget. Keep development CPU profiling separate from runtime GPU
profiling. Vite supplies a built-in profiling mode, so a paid observability
service is unnecessary for this work. [Vite performance guide](https://vite.dev/guide/performance)

### 3. Give model decoders an owner — before an authored-asset rollout

Share a bounded Draco decoder across simultaneous model loads, with an explicit
release policy that cannot dispose it underneath pending work. Three recommends
reusing one decoder instance and provides a worker limit. A self-hosted,
version-pinned decoder removes a third-party availability dependency but adds
static bytes to deployment; retain license files. [DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html)

For the first real textured pilot, compare uncompressed, Draco and Meshopt GLBs
for download, decode, appearance and animation fidelity. Meshopt covers geometry,
morph targets and animation; Draco is primarily geometry compression. Add the
matching decoder only when an asset needs it. [glTF Transform Meshopt](https://gltf-transform.dev/modules/functions/functions/meshopt),
[GLTFLoader integration](https://threejs.org/docs/pages/GLTFLoader.html)

Use KTX2/Basis for GPU texture compression when textures dominate memory, rather
than assuming a small JPEG/WebP download also means small GPU usage. KTX2Loader
needs renderer capability detection and teardown. Offline gltfpack can optimize,
quantize and compress meshes/animations/textures, but preserve named nodes and
metadata used by custom animation/selection. [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html),
[gltfpack](https://meshoptimizer.org/gltf/)

## Modern technologies to evaluate selectively

| Technology | Decision and cost |
| --- | --- |
| WebGPU + TSL | Valuable future path for compute and node-based materials. Three's renderer can fall back to WebGL2, but `onBeforeCompile`, ShaderMaterial and existing post-processing are not drop-in compatible. Official documentation still describes migration caveats and possible cases where WebGLRenderer performs better. Defer a full conversion; prototype one vessel only after a measured requirement justifies it. [Three WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer) |
| Async shader compilation | Consider `compileAsync` before revealing a newly loaded model if profiling shows shader stalls; it uses parallel shader compilation where available. Costs some prewarming work and lifecycle handling. [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) |
| CSS size container queries | A good future fit if the court is embedded in resizable panels: layout follows component width instead of the entire viewport. Existing viewport queries remain appropriate for the current full-window dialog. No package or recurring cost. [Container queries](https://web.dev/articles/baseline-in-action-container-queries) |
| Same-document View Transitions | Available across the major engines since October 2025, but still a progressive enhancement for older clients. Reserve for deliberate inspector/mode changes, not rapid live events; honor reduced motion and avoid snapshotting a continuously animated canvas without testing. No animation library required. [Browser availability](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available) |
| OffscreenCanvas workers, Gaussian splats, real-time AI-generated assets | Defer. The current small interactive, rigged court has no measured need that offsets worker/DOM synchronization, a second asset representation, or ongoing inference costs. This is an architectural judgment, not a claim that these technologies lack value elsewhere. |

## Cost guardrails

Keep rendering and diagnostics client-side; optimize assets offline; use static
hosting and existing subscriptions. Do not add per-frame network traffic,
per-interaction model calls, or paid telemetry. Require a before/after measurement
and a teardown/fallback check for each optimization. Retain the procedural vessel
and accessible inspector as dependable fallbacks. Modernity should improve
responsiveness, accessibility and maintainability, not merely add a newer API.
