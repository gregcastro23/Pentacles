/* Multi-zoom time scrubber: day / month / year presets on one range control.
   The ecliptic ruler stays fixed; only the instant changes. The thumb keeps its
   place across zoom changes (thumbFromDate), and "Now" re-anchors to the present. */
import { h, clear } from "./dom.js";
import { dateFromThumb, thumbFromDate } from "./math.js";

const RES = 1000; // range steps
const ZOOMS = [{ id: "day", label: "Day" }, { id: "month", label: "Month" }, { id: "year", label: "Year" }];

const fmtDate = (d) => d.toLocaleString(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

export function renderScrubber(container, state) {
  clear(container);
  const pills = h("div", { class: "ac-zoom" });
  for (const z of ZOOMS) {
    pills.appendChild(h("button", {
      class: "ac-zoom-pill" + (state.zoom === z.id ? " is-active" : ""), text: z.label,
      dataset: { zoom: z.id }, "aria-pressed": String(state.zoom === z.id),
      onclick: () => state.hooks.onZoom && state.hooks.onZoom(z.id),
    }));
  }

  const range = h("input", {
    class: "ac-range", type: "range", min: "0", max: String(RES), step: "1",
    value: String(Math.round(thumbFromDate(state.date, state.zoom, state.anchor) * RES)),
    "aria-label": "Scrub time",
    oninput: (e) => {
      const t = Number(e.target.value) / RES;
      const d = dateFromThumb(t, state.zoom, state.anchor);
      state.hooks.onScrub && state.hooks.onScrub(d);
    },
  });

  const dateLabel = h("span", { class: "ac-scrub-date", text: fmtDate(state.date) });
  const nowBtn = h("button", { class: "ac-now", text: "Now", title: "Snap to the present moment", onclick: () => state.hooks.onNow && state.hooks.onNow() });

  container.appendChild(h("div", { class: "ac-scrub-top" }, [pills, dateLabel, nowBtn]));
  container.appendChild(range);

  state.dom.scrubRange = range;
  state.dom.scrubDate = dateLabel;
  state.dom.zoomPills = pills;
}

/** Refresh the date readout (called live during a scrub). */
export function setScrubberDate(state) {
  if (state.dom.scrubDate) state.dom.scrubDate.textContent = fmtDate(state.date);
}
/** Move the thumb to match state.date (after zoom change / Now). */
export function syncScrubberThumb(state) {
  if (state.dom.scrubRange) state.dom.scrubRange.value = String(Math.round(thumbFromDate(state.date, state.zoom, state.anchor) * RES));
  if (state.dom.zoomPills) {
    for (const b of state.dom.zoomPills.children) {
      const active = b.dataset.zoom === state.zoom;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    }
  }
  setScrubberDate(state);
}
