# Stitch design brief — "The Observatory" (Pentacles admin telemetry)

Paste the **Prompt** block below into Google Stitch (stitch.withgoogle.com). The
**Reference** sections give Stitch the exact data, states, and tokens so the output
drops straight onto the working module (`src/alchm-chart/admin-telemetry.js`), which
already owns all the data binding behind stable class hooks (`.at-*`).

---

## Prompt (paste into Stitch)

> Design a dark, mystical-yet-precise **admin telemetry dashboard** called **"The
> Observatory"** for an astrology-themed multiplayer Web3 game (SpacetimeDB +
> on-chain). It is an internal ops console for a single admin — dense, legible, and
> calm, not flashy. Think "celestial Bloomberg terminal": deep midnight-navy
> background, aged-gold accents, parchment-white text, occult glyphs as section
> marks.
>
> **Layout:** a fixed top header (left: ✦ wordmark "The Observatory" + subtitle
> "Pentacles admin telemetry"; right: a live-status pill with a colored dot +
> "updated HH:MM" + a "⟳ Refresh" button). Below it, a left vertical **nav rail**
> (~170px) of 9 sections each with a glyph + label, and a scrolling **content
> area** to its right. Collapse the rail to glyph-only under 720px.
>
> **Nav sections:** Overview ✦, Players ☉, Economy ⊛, Faction War ⚔, AI & Duels ◈,
> Agents ☿, Constellation DEX ♁, Sky ☽, SQL Console ⌘.
>
> **Reusable components to design:**
> 1. **KPI stat card** — big serif number, uppercase micro-label, optional sub-line;
>    a "warning" variant (amber border/number) for backlogs and stale ticks.
> 2. **Panel** — titled card container holding a table, bar list, or checklist.
> 3. **Horizontal bar list** — label · track+fill · right-aligned value; fills are
>    tinted per planet/element.
> 4. **System-health checklist** — rows of green ✓ / red ✕ circle + label + dim note.
> 5. **Data table** — uppercase dim headers, tabular-nums, subtle row dividers.
> 6. **Zone control meter** — a centered tug-of-war bar from −1000..+1000 tinted by
>    the owning faction's color, with the numeric value overlaid.
> 7. **Chips** — pill tags for agent names / query presets.
> 8. **SQL console** — monospace textarea, preset chips, a Run button, results table.
>
> **Screens to render:** (a) Overview — 8 KPI cards in a responsive grid, then a
> two-column "System health" checklist, then a "Season" mini-panel. (b) Faction War —
> 6 KPI cards + an 11-row "Zone board" table whose last column is the control meter,
> + two side-by-side bar-list panels. (c) SQL Console — instruction banner, query
> editor with preset chips, results table.
>
> Produce a cohesive design system: color tokens, type scale, spacing, and the
> component states (default / warning / loading / empty / error).

---

## Reference: palette (must map to these CSS variables)

| Token | Hex | Use |
|---|---|---|
| `--ac-bg` | `#0d101c` (≈92% opaque) | app background |
| `--ac-panel` | `#141826` (≈66%) | cards / panels |
| `--ac-line` | gold @ 16% | hairline borders |
| `--ac-gold` | `#d8b46a` | primary accent |
| `--ac-gold-bright` | `#f1dba1` | KPI numbers, active nav |
| `--ac-gold-deep` | `#9c7e42` | banner rule |
| `--ac-text` | `#e8e3d4` | parchment body text |
| `--ac-dim` | `#9aa0b0` | labels / secondary |
| `--ac-ok` | `#5fb37a` | health ✓, "live" dot |
| `--ac-warn` | `#e0a23a` | backlog / stale warnings |
| `--ac-error` | `#d56a6a` | health ✕, error banners |

Faction colors (Sun→Pluto): `#e8b84b #cbd0db #9aa7c4 #d98fb0 #cf4d4d #cf9a52 #9a937c #5fb6c4 #6470c8 #8a6aa0`.
ESMS element colors (Spirit/Essence/Matter/Substance): `#cba6f7 #94e2d5 #a6adc8 #f9e2af`.

## Reference: type

- Display / numbers / panel titles: **Cormorant Garamond** (serif), 500–600.
- Body / labels / nav / tables: **Space Grotesk**, 300–600.
- SQL console + numeric cells: monospace (`ui-monospace, SF Mono, Menlo`).

## Reference: real metrics on each screen

- **Overview KPIs:** Players (137, "52 active 24h") · New 24h (7, "60 this week") ·
  Token supply (377.1k) · Sky tick age (12s, +"10 bodies · 3 ℞") · Oracle backlog
  (0/4 — warning when >0) · Attestor backlog (4 — warning) · Zones held (9/11, "2
  neutral") · Blocks minted (41, "27 on-chain").
- **Health checks:** Live connection · Sky-tick timer armed · Sky tick fresh (<5m) ·
  Stars seeded · Constellations seeded · Oracle service keeping up · Attestor service
  keeping up.
- **Faction War:** Zones held 9/11 · Stars held 265/540 · Battles 420 ("59% attacker
  wins") · Live PvP duels 12 · Queue depth 3. Zone board rows like
  `#2 · House · ☉ Sun · [527]`.
- **AI & Duels:** Oracle p50/p95 latency · answers-by-model bar list (cache / haiku /
  sonnet) · Word duels (210, win %) · Jing duels by state.
- **DEX:** Pools 88 · Blocks 41 (27 on-chain) · Trace intents 30 / 26 attested.

## States to cover

- **Loading:** Refresh button reads "⟳ Refreshing…", dimmed; body shows "Gathering
  telemetry…".
- **Offline / no host:** a dim banner — "Offline / no live host — showing the empty
  structure." All KPIs read "—".
- **Warning:** amber KPI border + amber number (oracle/attestor backlog, stale tick).
- **Error:** red-rule banner with the message.

## Integration contract (so the design drops in)

Keep these class hooks; the module renders into them: `.at-header .at-title
.at-status .at-dot--{live,connecting,error,offline} .at-refresh`, `.at-nav
.at-nav-btn.is-active`, `.at-body`, `.at-kpis .at-kpi.is-warn .at-kpi-v/.at-kpi-k/.at-kpi-sub`,
`.at-panel .at-panel-head`, `.at-bars .at-bar-row`, `.at-checks .at-check-mark.ok/.bad`,
`.at-table`, `.at-meter .at-meter-fill`, `.at-chips .at-chip`, `.at-sql .at-sql-out`.

When Stitch returns HTML/CSS, hand it back here and I'll reconcile its styles onto
these selectors (replacing the baseline block in `alchm-chart.css`).
