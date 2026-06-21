/* ============================================================
   PENTACLES — Constellation Pentacles Page
   ============================================================
   Opens when a constellation cluster is clicked. Shows the figure, its
   most important (brightest) member stars, the ESMS pool it backs and
   its live visibility, with two actions: ENTER the pool (the existing
   trace → attestation → seed flow) and MINT A BLOCK (raise the
   constellation's resolution by adding the next bright nearby star).

   Offline/dual-mode: mint-a-block adds a real catalogue star locally and
   records the block; Phase 5 swaps that for the add_star_to_constellation
   reducer. Reuses the #agent-page overlay + .ag-* styles.
   ============================================================ */

(function () {
  "use strict";

  const BLOCK_KEY = "pentacles_con_blocks"; // { [conId]: [hip, ...] } added at runtime
  let escHandler = null;
  let curId = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function toastMsg(m, t) { if (window.toast) window.toast(m, { type: t || "info" }); }
  function esmsTag(id) { return `<span style="color:${ESMS_COLORS[id]};white-space:nowrap;">${ESMS_GLYPHS[id]} ${ESMS_NAMES[id]}</span>`; }

  function loadBlocks() { try { return JSON.parse(localStorage.getItem(BLOCK_KEY)) || {}; } catch (e) { return {}; } }
  function saveBlocks(b) { try { localStorage.setItem(BLOCK_KEY, JSON.stringify(b)); } catch (e) {} }
  function addedFor(id) { return loadBlocks()[id] || []; }

  function catalog() { return (typeof STAR_CATALOG !== "undefined") ? STAR_CATALOG : []; }
  function starByHip(hip) { return catalog().find((r) => r[0] === hip); }
  function conDef(id) { return (typeof CONSTELLATIONS !== "undefined") ? CONSTELLATIONS.find((c) => c.id === id) : null; }
  function conLive(id) { return (state.constellations || []).find((c) => c.id === id); }

  function close() {
    const ov = document.getElementById("agent-page");
    if (ov) { ov.style.display = "none"; ov.innerHTML = ""; }
    if (escHandler) { document.removeEventListener("keydown", escHandler); escHandler = null; }
    curId = null;
    if (window.HologramCamera) window.HologramCamera.autoRotate = !document.documentElement.classList.contains("pt-reduced-motion");
  }

  function openConstellationPage(con) {
    const id = con && (con.id != null ? con.id : con);
    const def = conDef(id);
    if (!def) { toastMsg("Constellation not found", "error"); return; }
    curId = id;
    const ov = document.getElementById("agent-page");
    if (!ov) return;
    if (window.HologramCamera) window.HologramCamera.autoRotate = false;
    ov.style.display = "flex";
    render();
    escHandler = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", escHandler);
    const cb = document.getElementById("cp-close"); if (cb) cb.focus();
  }

  // brightest-first member list, with any runtime-added stars flagged.
  function memberStars(id) {
    const def = conDef(id);
    const added = new Set(addedFor(id));
    const hips = def.members.concat(addedFor(id).filter((h) => !def.members.includes(h)));
    const live = conLive(id);
    const rows = hips.map((hip) => {
      const r = starByHip(hip);
      if (!r) return null;
      const node = live && live.nodes ? live.nodes[hip] : null;
      return { hip, name: r[1], mag: r[4], ra: r[2], dec: r[3], up: node ? node.up : null, engage: node ? node.engage : null, added: added.has(hip) };
    }).filter(Boolean);
    rows.sort((a, b) => a.mag - b.mag); // brightest first
    return rows;
  }

  // candidate next stars to raise resolution: bright catalogue stars near the
  // figure's centroid that aren't members yet.
  function nextCandidate(id) {
    const def = conDef(id);
    const mem = def.members.map(starByHip).filter(Boolean);
    if (!mem.length) return null;
    // crude centroid in RA/Dec (members are clustered, so naive mean is fine)
    const cRa = mem.reduce((s, r) => s + r[2], 0) / mem.length;
    const cDec = mem.reduce((s, r) => s + r[3], 0) / mem.length;
    const have = new Set(def.members.concat(addedFor(id)));
    let best = null, bestKey = Infinity;
    for (const r of catalog()) {
      if (have.has(r[0])) continue;
      let dRa = Math.abs(r[2] - cRa); if (dRa > 180) dRa = 360 - dRa;
      const d = Math.hypot(dRa * Math.cos(cDec * Math.PI / 180), r[3] - cDec);
      if (d > 14) continue;                 // within ~14° of the figure
      const key = r[4] + d * 0.15;          // prefer bright + near
      if (key < bestKey) { bestKey = key; best = r; }
    }
    return best;
  }

  function render() {
    const id = curId;
    const def = conDef(id);
    const live = conLive(id) || { tradeable: false, visibleCount: 0, visibleThreshold: def.visibleThreshold, pair: def.pair, feeBps: def.feeBps };
    const ov = document.getElementById("agent-page");
    const stars = memberStars(id);
    const blocks = addedFor(id).length;
    const cand = nextCandidate(id);
    const visTxt = live.tradeable
      ? `<span class="cp-risen">● risen — ${live.visibleCount}/${live.visibleThreshold} stars up · pool OPEN</span>`
      : `<span class="cp-set">○ set — ${live.visibleCount || 0}/${live.visibleThreshold} up · pool closed</span>`;

    const starRows = stars.map((s, i) => `
      <div class="cp-star ${s.up === false ? "down" : ""}">
        <span class="cp-star-rank">${i === 0 ? "α" : i + 1}</span>
        <span class="cp-star-name">${esc(s.name)}${s.added ? ' <span class="ag-tag">minted</span>' : ""}</span>
        <span class="cp-star-mag">${s.mag.toFixed(2)}</span>
        <span class="cp-star-vis">${s.up == null ? "" : s.up ? (s.engage ? "● up" : "◐ low") : "○ set"}</span>
      </div>`).join("");

    ov.innerHTML = `
      <div class="ag-window cp-window">
        <button id="cp-close" class="ag-close" title="Close (Esc)" aria-label="Close">✕</button>
        <div class="ag-header">
          <span class="ag-glyph" style="color:${ESMS_COLORS[def.pair[0]]}">✶</span>
          <div class="ag-title">
            <div class="ag-name">${esc(def.name)} <span class="ag-kind">${esc(def.abbr)} · constellation pool</span></div>
            <div class="ag-sub">${esmsTag(def.pair[0])} <span class="ag-dim">↔</span> ${esmsTag(def.pair[1])} · <span class="ag-dim">${def.feeBps}bps</span> · ${visTxt}</div>
          </div>
        </div>
        <div class="cp-body">
          <div class="cp-left">
            <div class="cp-figure" id="cp-figure"></div>
            <div class="ag-jing-h">Pool</div>
            <div class="cp-pool">
              <div class="cp-pool-row"><span class="ag-dim">Pair</span><span>${esmsTag(def.pair[0])} ↔ ${esmsTag(def.pair[1])}</span></div>
              <div class="cp-pool-row"><span class="ag-dim">Fee</span><span>${def.feeBps} bps</span></div>
              <div class="cp-pool-row"><span class="ag-dim">Members</span><span>${stars.length} stars${blocks ? ` <span class="ag-tag">+${blocks} minted</span>` : ""}</span></div>
              <div class="cp-pool-row"><span class="ag-dim">Resolution</span><span id="cp-reslevel">level ${blocks}</span></div>
            </div>
            <div id="cp-blocks"></div>
            <button id="cp-enter" class="ag-btn ${live.tradeable ? "" : "ghost"}" ${live.tradeable ? "" : "disabled"} style="width:100%;margin-top:10px;">${live.tradeable ? "Enter pool with special preparations ✦" : "Below horizon — cannot enter"}</button>
            <button id="cp-mint" class="ag-btn" style="width:100%;margin-top:8px;background:transparent;color:var(--gold-bright);border-color:var(--gold);" ${cand ? "" : "disabled"} title="${cand ? "Add " + esc(cand[1]) + " (mag " + cand[4] + ")" : "No nearby star to add"}">⛏ Mint a block — add a star</button>
          </div>
          <div class="cp-right">
            <div class="ag-jing-h">Brightest stars in ${esc(def.name)}</div>
            <div class="ag-hint">The figure's member stars, brightest first. The α star is its luminary. Minting a block adds the next bright star nearby, raising the pool's resolution.</div>
            <div class="cp-stars">${starRows || '<div class="ag-dim">No member stars resolved.</div>'}</div>
          </div>
        </div>
      </div>`;

    document.getElementById("cp-close").onclick = close;
    ov.onclick = (e) => { if (e.target.id === "agent-page") close(); };
    const enter = document.getElementById("cp-enter");
    if (enter && !enter.disabled) enter.onclick = () => enterPool(id);
    const mint = document.getElementById("cp-mint");
    if (mint && !mint.disabled) mint.onclick = () => mintBlock(id);
    drawFigure(id);
    refreshBlocks(id);
  }

  // Live: surface the AUTHORITATIVE minted blocks from the module, each labeled
  // with its on-chain mintedAtBlock (ConstellationDeed) when the pool was seeded.
  async function refreshBlocks(id) {
    const net = window.Pentacles && window.Pentacles.net;
    const host = document.getElementById("cp-blocks");
    if (!host || !net || !net.isLive || typeof net.constellationBlocks !== "function") return;
    let blocks = [], res = null;
    try { [blocks, res] = await Promise.all([net.constellationBlocks(id), net.constellationResolution(id)]); }
    catch (e) { return; }
    if (id !== curId) return;
    const lvl = res ? Number(res.resolution_level)
      : (blocks.length ? Math.max.apply(null, blocks.map((b) => Number(b.level_after) || 0)) : 0);
    const lvlEl = document.getElementById("cp-reslevel");
    if (lvlEl) lvlEl.innerHTML = `level ${lvl} <span class="ag-tag">live</span>`;
    if (!blocks.length) { host.innerHTML = ""; return; }
    host.innerHTML =
      `<div class="ag-jing-h" style="margin-top:10px;">Minted blocks <span class="ag-tag">live</span></div>` +
      blocks.map((b) => {
        const r = starByHip(Number(b.hip_id));
        const name = r ? r[1] : `HIP ${b.hip_id}`;
        const oc = b.onchain_block != null
          ? `<span class="ag-tag" title="ConstellationDeed.mintedAtBlock">⛓ block ${esc(b.onchain_block)}</span>`
          : `<span class="ag-dim" title="not yet seeded on-chain">off-chain</span>`;
        return `<div class="cp-pool-row"><span>⛏ #${esc(b.block_id)} · ${esc(name)}</span><span class="ag-dim">lvl ${esc(b.level_after)} · ${oc}</span></div>`;
      }).join("");
  }

  // small thumbnail of the projected figure using the live disk coords
  function drawFigure(id) {
    const host = document.getElementById("cp-figure");
    const live = conLive(id);
    if (!host || !live || !live.segments || !live.segments.length) { if (host) host.innerHTML = '<div class="ag-hint" style="text-align:center;padding:20px;">Figure below the horizon</div>'; return; }
    const pts = [];
    live.segments.forEach(([a, b]) => { pts.push(a, b); });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 16, w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const col = ESMS_COLORS[conDef(id).pair[0]];
    let s = `<svg viewBox="${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}" class="cp-figure-svg" xmlns="http://www.w3.org/2000/svg">`;
    live.segments.forEach(([a, b]) => {
      s += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${col}" stroke-width="1.1" stroke-opacity="0.8" stroke-linecap="round"/>`;
    });
    const seen = new Set();
    Object.values(live.nodes || {}).forEach((n) => { if (!n.up) return; const k = n.x.toFixed(1) + "," + n.y.toFixed(1); if (seen.has(k)) return; seen.add(k);
      s += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="2.6" fill="#fff" stroke="${col}" stroke-width="0.8"/>`; });
    s += `</svg>`;
    host.innerHTML = s;
  }

  function enterPool(id) {
    close();
    if (typeof switchTab === "function") switchTab("tab-pools");
    if (typeof traceConstellation === "function") setTimeout(() => traceConstellation(id), 60);
  }

  function mintBlock(id) {
    const cand = nextCandidate(id);
    if (!cand) { toastMsg("No nearby star bright enough to add.", "info"); return; }
    // Dual-mode: always add the next bright nearby star locally for instant feedback…
    const blocks = loadBlocks();
    blocks[id] = (blocks[id] || []).concat([cand[0]]);
    saveBlocks(blocks);
    const lvl = blocks[id].length;
    toastMsg(`⛏ Block minted — ${cand[1]} (mag ${cand[4]}) joins ${conDef(id).name}. Resolution → level ${lvl}.`, "success");
    if (window.synth && synth.playFuse) synth.playFuse();
    render();
    // …and best-effort record it on the authoritative module (needs a registered,
    // located player + the star risen; silently ignored otherwise).
    const net = window.Pentacles && window.Pentacles.net;
    if (net && net.isLive && typeof net.addStarToConstellation === "function") {
      net.addStarToConstellation(id, cand[0]).catch(() => {});
    }
  }

  window.openConstellationPage = openConstellationPage;
  window.closeConstellationPage = close;
})();
