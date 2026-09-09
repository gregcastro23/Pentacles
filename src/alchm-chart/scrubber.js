/* Multi-zoom time scrubber: day / month / year presets on one range control.
   The ecliptic ruler stays fixed; only the instant changes. The thumb keeps its
   place across zoom changes (thumbFromDate), and "Now" re-anchors to the present.
   Provides fine-grained step controls (-1d, -1h, +1h, +1d), quick lunar jumps,
   and luxury celestial chronometer UI. */
import { h, clear } from "./dom.js";
import { dateFromThumb, thumbFromDate } from "./math.js";

const RES = 1000; // range steps
const ZOOMS = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const fmtDate = (d) => {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function getTicksForZoom(zoom) {
  if (zoom === "day") {
    return [
      { label: "−12h", pct: 0 },
      { label: "−6h", pct: 25 },
      { label: "Anchor", pct: 50 },
      { label: "+6h", pct: 75 },
      { label: "+12h", pct: 100 },
    ];
  }
  if (zoom === "month") {
    return [
      { label: "−15d", pct: 0 },
      { label: "−7d", pct: 25 },
      { label: "Anchor", pct: 50 },
      { label: "+7d", pct: 75 },
      { label: "+15d", pct: 100 },
    ];
  }
  return [
    { label: "−6mo", pct: 0 },
    { label: "−3mo", pct: 25 },
    { label: "Anchor", pct: 50 },
    { label: "+3mo", pct: 75 },
    { label: "+6mo", pct: 100 },
  ];
}

export function renderScrubber(container, state) {
  clear(container);

  // 1. Zoom Segmented Pills
  const pills = h("div", { class: "ac-zoom" });
  for (const z of ZOOMS) {
    pills.appendChild(h("button", {
      class: "ac-zoom-pill" + (state.zoom === z.id ? " is-active" : ""),
      text: z.label,
      dataset: { zoom: z.id },
      "aria-pressed": String(state.zoom === z.id),
      onclick: () => state.hooks.onZoom && state.hooks.onZoom(z.id),
    }));
  }

  // 2. Precision Steppers
  const steppers = h("div", { class: "ac-scrub-steppers" }, [
    h("button", {
      class: "ac-step-btn",
      title: "Step backward 1 day",
      text: "« −1d",
      onclick: () => {
        const d = new Date(state.date.getTime() - 86400000);
        state.hooks.onScrub && state.hooks.onScrub(d);
      },
    }),
    h("button", {
      class: "ac-step-btn",
      title: "Step backward 1 hour",
      text: "‹ −1h",
      onclick: () => {
        const d = new Date(state.date.getTime() - 3600000);
        state.hooks.onScrub && state.hooks.onScrub(d);
      },
    }),
    h("button", {
      class: "ac-step-btn",
      title: "Step forward 1 hour",
      text: "+1h ›",
      onclick: () => {
        const d = new Date(state.date.getTime() + 3600000);
        state.hooks.onScrub && state.hooks.onScrub(d);
      },
    }),
    h("button", {
      class: "ac-step-btn",
      title: "Step forward 1 day",
      text: "+1d »",
      onclick: () => {
        const d = new Date(state.date.getTime() + 86400000);
        state.hooks.onScrub && state.hooks.onScrub(d);
      },
    }),
  ]);

  // 3. Quick Lunar Jumps
  const lunarJumps = h("div", { class: "ac-lunar-jumps" }, [
    h("button", {
      class: "ac-lunar-btn",
      title: "Jump forward to nearest New Moon (~Sep 11, 2026)",
      text: "🌑 New Moon",
      onclick: () => {
        // Approximate next New Moon from Sep 9 is ~Sep 11 14:00 UTC
        const nm = new Date("2026-09-11T14:30:00Z");
        state.hooks.onScrub && state.hooks.onScrub(nm);
      },
    }),
    h("button", {
      class: "ac-lunar-btn",
      title: "Jump forward to nearest Full Moon (~Sep 26, 2026)",
      text: "🌕 Full Moon",
      onclick: () => {
        const fm = new Date("2026-09-26T16:48:00Z");
        state.hooks.onScrub && state.hooks.onScrub(fm);
      },
    }),
  ]);

  const isLive = Math.abs(state.date.getTime() - Date.now()) < 90000;
  const statusBadge = h("span", {
    class: "ac-scrub-status" + (isLive ? " is-live" : " is-snapshot"),
    text: isLive ? "● LIVE SKY" : "⏱ SNAPSHOT",
    title: isLive ? "Synchronized with live celestial ephemeris" : "Temporal snapshot mode",
  });

  const dateLabel = h("span", {
    class: "ac-scrub-date",
    text: fmtDate(state.date),
  });

  const nowBtn = h("button", {
    class: "ac-now" + (isLive ? " is-synced" : ""),
    text: "✦ Now",
    title: "Snap immediately to the live present moment",
    onclick: () => state.hooks.onNow && state.hooks.onNow(),
  });

  // Top control bar
  const top = h("div", { class: "ac-scrub-top" }, [
    pills,
    steppers,
    lunarJumps,
    dateLabel,
    statusBadge,
    nowBtn,
  ]);

  // 4. Custom Slider Rail with Golden Glow Fill and Timeline Ticks
  const rawThumb = thumbFromDate(state.date, state.zoom, state.anchor);
  const curThumb = Math.max(0, Math.min(1, rawThumb));
  const curVal = Math.round(curThumb * RES);

  const fill = h("div", {
    class: "ac-scrub-fill",
    style: `width: ${(curThumb * 100).toFixed(2)}%;`,
  });

  const range = h("input", {
    class: "ac-range",
    type: "range",
    min: "0",
    max: String(RES),
    step: "1",
    value: String(curVal),
    "aria-label": "Scrub celestial timeline",
    oninput: (e) => {
      const t = Number(e.target.value) / RES;
      const d = dateFromThumb(t, state.zoom, state.anchor);
      fill.style.width = `${(t * 100).toFixed(2)}%`;
      state.hooks.onScrub && state.hooks.onScrub(d);
    },
  });

  const ticks = h("div", { class: "ac-scrub-ticks" });
  for (const tk of getTicksForZoom(state.zoom)) {
    const mark = h("div", {
      class: "ac-tick-mark",
      style: `left: ${tk.pct}%;`,
    }, [
      h("span", { class: "ac-tick-pip" }),
      h("span", { class: "ac-tick-label", text: tk.label }),
    ]);
    ticks.appendChild(mark);
  }

  const trackWrap = h("div", { class: "ac-scrub-track-wrap" }, [
    fill,
    range,
    ticks,
  ]);

  container.appendChild(top);
  container.appendChild(trackWrap);

  state.dom.scrubRange = range;
  state.dom.scrubFill = fill;
  state.dom.scrubDate = dateLabel;
  state.dom.zoomPills = pills;
  state.dom.scrubStatus = statusBadge;
  state.dom.nowBtn = nowBtn;
  state.dom.scrubTicks = ticks;
}

/** Refresh date readout and live/snapshot indicator */
export function setScrubberDate(state) {
  if (state.dom.scrubDate) state.dom.scrubDate.textContent = fmtDate(state.date);
  if (state.dom.scrubStatus) {
    const isLive = Math.abs(state.date.getTime() - Date.now()) < 90000;
    state.dom.scrubStatus.className = "ac-scrub-status" + (isLive ? " is-live" : " is-snapshot");
    state.dom.scrubStatus.textContent = isLive ? "● LIVE SKY" : "⏱ SNAPSHOT";
    if (state.dom.nowBtn) state.dom.nowBtn.classList.toggle("is-synced", isLive);
  }
}

/** Move the thumb and track fill to match state.date (after zoom change / Now). */
export function syncScrubberThumb(state) {
  const t = Math.max(0, Math.min(1, thumbFromDate(state.date, state.zoom, state.anchor)));
  if (state.dom.scrubRange) {
    state.dom.scrubRange.value = String(Math.round(t * RES));
  }
  if (state.dom.scrubFill) {
    state.dom.scrubFill.style.width = `${(t * 100).toFixed(2)}%`;
  }
  if (state.dom.zoomPills) {
    for (const b of state.dom.zoomPills.children) {
      const active = b.dataset.zoom === state.zoom;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    }
  }
  if (state.dom.scrubTicks) {
    clear(state.dom.scrubTicks);
    for (const tk of getTicksForZoom(state.zoom)) {
      state.dom.scrubTicks.appendChild(h("div", {
        class: "ac-tick-mark",
        style: `left: ${tk.pct}%;`,
      }, [
        h("span", { class: "ac-tick-pip" }),
        h("span", { class: "ac-tick-label", text: tk.label }),
      ]));
    }
  }
  setScrubberDate(state);
}
