/* The blended SMES temperament strip + the 12 constellation pool rows
   (astrological pressure meter, always walletless; live on-chain depth in
   three states: liquid · unseeded · unavailable). */
import { h, clear } from "./dom.js";

export function renderSmes(container, state) {
  clear(container);
  const { esms } = state;
  const pct = (state.smes && state.smes.pct) || [25, 25, 25, 25];
  const dominant = pct.indexOf(Math.max(...pct));
  container.appendChild(h("div", { class: "ac-section-label", text: "Alchemical temperament — blended SMES" }));

  const bar = h("div", { class: "ac-smes-bar" });
  for (let e = 0; e < 4; e++) {
    bar.appendChild(h("div", {
      class: "ac-smes-seg" + (e === dominant ? " ac-smes-seg--dom" : ""),
      style: { width: pct[e].toFixed(2) + "%", background: esms.colors[e] },
      title: `${esms.names[e]} ${Math.round(pct[e])}%`,
    }));
  }
  container.appendChild(bar);

  const legend = h("div", { class: "ac-smes-legend" });
  for (let e = 0; e < 4; e++) {
    legend.appendChild(h("div", { class: "ac-smes-key" }, [
      h("span", { class: "ac-swatch", style: { background: esms.colors[e] } }),
      h("span", { class: "ac-smes-name", text: `${esms.glyphs[e]} ${esms.names[e]}` }),
      h("span", { class: "ac-smes-pct", text: Math.round(pct[e]) + "%" }),
    ]));
  }
  container.appendChild(legend);
}

function depthCell(pool, state) {
  const esms = state.esms;
  if (!state.pools) return h("div", { class: "ac-depth ac-depth--muted", text: "live depth loading…" });
  if (pool.failed) {
    return h("div", { class: "ac-depth ac-depth--fail" }, [
      h("span", { text: "reserves unavailable" }),
      h("button", { class: "ac-retry", text: "retry", onclick: (e) => { e.stopPropagation(); state.hooks.refreshPools && state.hooks.refreshPools(); } }),
    ]);
  }
  if (!pool.exists || !pool.hasLiq) {
    return h("div", { class: "ac-depth ac-depth--empty", text: "unseeded — no liquidity yet" });
  }
  const fa = (pool.fracA * 100).toFixed(1);
  const wrap = h("div", { class: "ac-depth" });
  const split = h("div", { class: "ac-depth-bar", title: `${esms.glyphs[pool.elemA]} ${fa}% · ${esms.glyphs[pool.elemB]} ${(100 - pool.fracA * 100).toFixed(1)}%` }, [
    h("span", { class: "ac-depth-a", style: { width: fa + "%", background: esms.colors[pool.elemA] } }),
    h("span", { class: "ac-depth-b", style: { width: (100 - fa) + "%", background: esms.colors[pool.elemB] } }),
  ]);
  wrap.appendChild(split);
  if (pool.spot != null) wrap.appendChild(h("span", { class: "ac-depth-spot", text: pool.spot < 0.001 ? "<0.001" : pool.spot.toFixed(pool.spot < 10 ? 3 : 2) }));
  return wrap;
}

export function renderPools(container, state) {
  clear(container);
  const esms = state.esms;
  container.appendChild(h("div", { class: "ac-section-label", text: "Constellation pools — astro-pressure vs live depth" }));

  const meta = state.pools && state.pools.length ? state.pools : state.poolMeta;
  const pressures = state.pressures || {};
  const rows = (meta || []).slice().sort((a, b) => {
    const ia = a.constId != null ? a.constId : a.id, ib = b.constId != null ? b.constId : b.id;
    return (pressures[ib] ? pressures[ib].pressure : 0) - (pressures[ia] ? pressures[ia].pressure : 0);
  });

  const list = h("div", { class: "ac-pool-list" });
  for (const pool of rows) {
    const id = pool.constId != null ? pool.constId : pool.id;
    const pr = pressures[id] ? pressures[id].pressure : 0;
    const pair = pool.pair || [pool.elemA, pool.elemB];
    const row = h("div", {
      class: "ac-pool-row", tabindex: "0", role: "button",
      "aria-label": `${pool.name || pool.abbr} pool, pressure ${Math.round(pr * 100)}%`,
      onclick: () => state.hooks.onSelect && state.hooks.onSelect({ kind: "pool", constId: id }),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.hooks.onSelect && state.hooks.onSelect({ kind: "pool", constId: id }); } },
    }, [
      h("div", { class: "ac-pool-id" }, [
        h("span", { class: "ac-pool-abbr", text: pool.abbr || ("#" + id) }),
        h("span", { class: "ac-pool-pair" }, [
          h("span", { class: "ac-swatch ac-swatch--sm", style: { background: esms.colors[pair[0]] }, title: esms.names[pair[0]] }),
          h("span", { class: "ac-swatch ac-swatch--sm", style: { background: esms.colors[pair[1]] }, title: esms.names[pair[1]] }),
        ]),
      ]),
      h("div", { class: "ac-pool-pressure" }, [
        h("div", { class: "ac-meter" }, [h("span", { class: "ac-meter-fill", style: { width: (pr * 100).toFixed(1) + "%" } })]),
        h("span", { class: "ac-meter-val", text: Math.round(pr * 100) + "%" }),
      ]),
      depthCell(pool, state),
    ]);
    list.appendChild(row);
  }
  container.appendChild(list);
}
