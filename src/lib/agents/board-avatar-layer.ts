import * as THREE from 'three';
import { createVesselAvatarMesh, disposeVesselAvatar, refreshVesselFromPayload, updateVesselAvatarAnimation } from './vessel-avatar-3d';
import { avatarPixelRatio, type AvatarRenderQuality } from './court-resolution';
import { BoardParticipantFeed, boardSeatDirections, boardViewport, boardZoneName, type BoardParticipant, type BoardSource } from './board-participants';
import { CourtRenderBudget } from './court-render-budget';
import { FACTION_HEX_COLORS } from './avatar-foot-ring';
import { presentVessel, updateVesselPortrait, formatVesselBalance } from './vessel-presentation';
import { presentVesselInspector } from './vessel-inspector-presentation';
import { SACRED_STAT_KEYS } from './rating-contract';
import { VesselModelPreview } from './vessel-model-preview';
import { createVesselStudioEnvironment, createVesselStudioLights } from './vessel-studio-lighting';
import './board-avatar-layer.css';

export interface BoardAvatarFrame {
  time: number;
  project: (alt: number, az: number) => { x: number; y: number };
  scale: number;
  enabled: boolean;
  deploying: boolean;
}
type Marker = { participant: BoardParticipant; signature: string; avatar?: THREE.Group;
  button: HTMLButtonElement; portrait: HTMLImageElement };

/** Keep the authored likeness legible at map scale; the base ring carries team color. */
function styleBoardLikeness(avatar: THREE.Group, faction: number): void {
  const { appearance, footRing, astralHalo } = avatar.userData;
  footRing.visible = false;
  astralHalo.visible = false;
  const torso = avatar.getObjectByName('TorsoMesh') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  torso.material.color.set(appearance.paletteOverrides.primaryGarmentHex);
  torso.material.emissiveIntensity = .04;
  torso.material.roughness = .75;
  torso.material.metalness = .15;
  const head = avatar.getObjectByName('HeadMesh') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  head.material.emissiveIntensity = .03;
  head.material.roughness = .65;
  head.material.metalness = .15;
  avatar.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const rim = material.userData.fresnelRim;
      if (!rim) continue;
      rim.color.set(FACTION_HEX_COLORS[faction]);
      rim.intensity = .18;
      const uniforms = material.userData.fresnelShaderUniforms;
      if (uniforms) uniforms.uFresnelIntensity.value = rim.intensity;
    }
  });
}

/** One transparent context, driven by the sky's own projection and 30 Hz clock. */
export class BoardAvatarLayer {
  private root = document.createElement('div');
  private controls = document.createElement('div');
  private status = document.createElement('span');
  private rosterButton = document.createElement('button');
  private rosterDialog = document.createElement('dialog');
  private rosterRows = new Map<string, HTMLButtonElement>();
  private directions = new Map<string, { alt: number; az: number; count: number }>();
  private qualityButton = document.createElement('button');
  private visibilityButton = document.createElement('button');
  private markers = new Map<string, Marker>();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-300, 300, 300, -300, 0.1, 2000);
  private renderer?: THREE.WebGLRenderer;
  private studio?: THREE.WebGLRenderTarget;
  private feed: BoardParticipantFeed;
  private observer: ResizeObserver;
  private visibilityObserver: IntersectionObserver;
  private budget = new CourtRenderBudget();
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private quality: AvatarRenderQuality = 'sharp';
  private source: BoardSource = 'offline';
  private visible = true;
  private enabled = true;
  private intersecting = true;
  private lost = false;
  private destroyed = false;
  private dragging = false;
  private width = 0;
  private height = 0;
  private density = 0;
  private lastTime = 0;
  private lastProjection = '';
  private selected: string | null = null;
  private inspectorTime = 0;
  private dialog = document.createElement('dialog');
  private returnFocus?: HTMLElement;
  private modelPreview?: VesselModelPreview;
  private contextLost = (event: Event) => { event.preventDefault(); this.lost = true; this.updateAvailability(); };
  private contextRestored = () => { this.lost = false; this.setupStudio(); this.resize(); this.budget.invalidate(); this.updateAvailability(); };
  private dragStart = () => { this.dragging = true; this.root.classList.add('pk-board-deploying'); this.budget.invalidate(); };
  private dragEnd = () => { this.dragging = false; this.budget.invalidate(); };

  constructor(private host: HTMLElement, client?: any) {
    this.root.className = 'pk-board-avatars';
    this.root.setAttribute('aria-label', 'Historical agents playing on the map');
    this.controls.className = 'pk-board-avatar-controls';
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', 'Map avatars');
    this.status.setAttribute('role', 'status');
    this.qualityButton.type = this.visibilityButton.type = 'button';
    this.qualityButton.textContent = 'Sharp';
    this.qualityButton.setAttribute('aria-label', 'Sharper avatar rendering');
    this.qualityButton.setAttribute('aria-pressed', 'true');
    this.qualityButton.title = 'Sharper edges · up to 4 million pixels';
    this.visibilityButton.textContent = 'Avatars on';
    this.visibilityButton.setAttribute('aria-pressed', 'true');
    this.qualityButton.onclick = () => {
      this.quality = this.quality === 'sharp' ? 'balanced' : 'sharp';
      this.qualityButton.textContent = this.quality === 'sharp' ? 'Sharp' : 'Balanced';
      this.qualityButton.setAttribute('aria-pressed', String(this.quality === 'sharp'));
      this.resize(); this.budget.invalidate();
    };
    this.visibilityButton.onclick = () => {
      this.visible = !this.visible;
      this.visibilityButton.textContent = this.visible ? 'Avatars on' : 'Avatars off';
      this.visibilityButton.setAttribute('aria-pressed', String(this.visible));
      this.root.hidden = !this.visible || !this.enabled;
      this.budget.invalidate();
    };
    this.rosterButton.type = 'button'; this.rosterButton.textContent = 'Agents (0)';
    this.rosterButton.onclick = () => this.rosterDialog.showModal();
    this.rosterDialog.className = 'pk-board-agent-dialog pk-board-roster-dialog';
    this.rosterDialog.setAttribute('aria-labelledby', 'pk-board-roster-title');
    this.rosterDialog.innerHTML = `<button type="button" class="pk-board-agent-close" autofocus>Back to map</button><h2 id="pk-board-roster-title">Agents playing now</h2><div class="pk-board-team-key" aria-label="Faction colors"></div><p class="pk-board-roster-empty"></p><div class="pk-board-roster-list"></div>`;
    this.rosterDialog.querySelector('button')!.onclick = () => this.rosterDialog.close();
    this.rosterDialog.addEventListener('close', () => this.rosterButton.focus());
    document.body.append(this.rosterDialog);
    this.controls.append(this.status, this.rosterButton, this.qualityButton, this.visibilityButton);
    host.append(this.root, this.controls);
    document.addEventListener('dragstart', this.dragStart);
    document.addEventListener('dragend', this.dragEnd);
    document.addEventListener('drop', this.dragEnd);
    // Inspection never starts a map drag, card deployment, or zone selection.
    for (const node of [this.root, this.controls]) for (const event of ['mousedown', 'touchstart', 'click']) node.addEventListener(event, e => e.stopPropagation());
    this.camera.position.z = 1000;
    this.scene.add(createVesselStudioLights());
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      const canvas = this.renderer.domElement;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.addEventListener('webglcontextlost', this.contextLost);
      canvas.addEventListener('webglcontextrestored', this.contextRestored);
      this.root.prepend(canvas);
      this.setupStudio();
    } catch { /* Keep accessible portrait markers when WebGL is unavailable. */ }
    this.dialog.className = 'pk-board-agent-dialog pk-board-inspector';
    this.dialog.setAttribute('aria-labelledby', 'pk-board-agent-name');
    this.dialog.innerHTML = `<header class="pk-board-inspector-header"><img class="pk-board-profile-portrait" width="64" height="64" /><div><p class="pk-board-agent-territory"></p>
      <h2 id="pk-board-agent-name"></h2><p class="pk-board-agent-faction"></p></div>
      <button type="button" class="pk-board-agent-close" aria-label="Close agent details" autofocus>Close ✕</button></header>
      <div class="pk-board-inspector-body"><section class="pk-board-model-panel" aria-label="Agent likeness">
      <div class="pk-board-model-preview"></div><img class="pk-board-agent-portrait" width="88" height="88" />
      <div class="pk-board-model-tools" role="group" aria-label="Model view" hidden>
      <button type="button" data-view="figure" aria-pressed="true">Full figure</button>
      <button type="button" data-view="detail" aria-pressed="false">Face & attire</button>
      <button type="button" data-view="reset">Reset view</button></div>
      <p class="pk-board-model-hint" hidden>Drag or use ← → to turn · Home to reset</p>
      <p class="pk-board-model-status" role="status" hidden></p></section>
      <section class="pk-board-agent-readings" aria-label="Agent metrics"><p class="pk-board-agent-role">Historical agent participating at this zone’s game table.</p>
      <p class="pk-board-agent-source"></p><p class="pk-board-agent-baseline-note"></p><dl class="pk-board-agent-metrics"></dl></section></div>`;
    this.dialog.querySelector('button')!.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => {
      this.modelPreview?.destroy(); this.modelPreview = undefined;
      this.selected = null; this.returnFocus?.focus(); this.budget.invalidate();
    });
    document.body.append(this.dialog);
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
      button.onclick = () => {
        if (button.dataset.view === 'reset') this.modelPreview?.resetView();
        else {
          this.modelPreview?.setView(button.dataset.view as 'figure' | 'detail');
          this.dialog.querySelectorAll('[aria-pressed]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        }
      };
    });
    this.feed = new BoardParticipantFeed(client, (participants, source) => this.reconcile(participants, source));
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.intersecting = entries[0]?.isIntersecting ?? false;
      if (this.intersecting) this.budget.invalidate();
    });
    this.visibilityObserver.observe(host);
    this.resize(); this.updateAvailability();
  }

  private setupStudio(): void {
    this.studio?.dispose();
    this.studio = this.renderer ? createVesselStudioEnvironment(this.renderer) : undefined;
    this.scene.environment = this.studio?.texture ?? null;
    this.scene.environmentIntensity = .6;
  }

  private resize(): void {
    this.width = this.host.clientWidth; this.height = this.host.clientHeight;
    this.density = window.devicePixelRatio;
    const { size, left, top } = boardViewport(this.width, this.height);
    this.root.classList.toggle('pk-board-compact', size < 440);
    this.host.classList.toggle('pk-board-small-host', size < 440);
    if (size <= 0 || !this.renderer || this.lost) return;
    const ratio = avatarPixelRatio(size, size, this.density, this.quality, this.renderer.capabilities.maxTextureSize);
    this.renderer.setDrawingBufferSize(size, size, ratio);
    Object.assign(this.renderer.domElement.style, { width: `${size}px`, height: `${size}px`, left: `${left}px`, top: `${top}px` });
    this.budget.invalidate();
  }

  private updateAvailability(): void {
    const fallback = !this.renderer || this.lost;
    this.root.classList.toggle('pk-board-portraits-only', fallback);
    this.qualityButton.disabled = fallback;
    if (this.renderer) this.renderer.domElement.hidden = fallback;
    const source = { live: this.markers.size ? 'Live participants' : 'No active agents', offline: 'Offline · No live seats', syncing: 'Syncing participants…' }[this.source];
    this.status.textContent = `${source}${fallback ? ' · Portraits' : ''}`;
  }

  private reconcile(participants: BoardParticipant[], source: BoardSource): void {
    this.source = source;
    const desired = new Set(participants.map(p => p.id));
    for (const [id, marker] of this.markers) if (!desired.has(id)) this.removeMarker(id, marker);
    for (const participant of participants) {
      const { id, zoneId, payload } = participant;
      let marker = this.markers.get(id);
      if (marker && marker.participant.payload.key !== payload.key) { this.removeMarker(id, marker); marker = undefined; }
      const signature = JSON.stringify(payload);
      if (!marker) {
        const button = document.createElement('button');
        button.className = 'pk-board-agent'; button.type = 'button'; button.dataset.participantId = id;
        const portrait = document.createElement('img'); portrait.width = portrait.height = 40; portrait.className = 'pk-board-agent-fallback';
        const name = document.createElement('span'); name.className = 'pk-board-agent-name'; name.textContent = payload.handle;
        button.append(portrait, name);
        button.onclick = () => this.inspect(id, button);
        marker = { participant, button, portrait, signature };
        this.markers.set(id, marker); this.root.append(button);
      }
      if (this.renderer && !marker.avatar) {
        const avatar = createVesselAvatarMesh(payload, { zoneId, footRingRadius: 1.15, loadPortraitFace: true });
        avatar.rotation.x = 0.42;
        // Team identity stays visible even when no ESMS or surge is measured.
        const teamRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.34, 40),
          new THREE.MeshBasicMaterial({ color: FACTION_HEX_COLORS[payload.faction], side: THREE.DoubleSide,
            transparent: true, opacity: .9, depthWrite: false, toneMapped: false }));
        teamRing.name = 'BoardFactionRing'; teamRing.rotation.x = -Math.PI / 2; teamRing.position.y = .04;
        avatar.add(teamRing); this.scene.add(avatar);
        styleBoardLikeness(avatar, payload.faction);
        marker.avatar = avatar;
        avatar.userData.portraitHead?.ready.then(() => this.budget.invalidate());
      } else if (marker.signature !== signature && marker.avatar) {
        refreshVesselFromPayload(marker.avatar, payload);
        styleBoardLikeness(marker.avatar, payload.faction);
      }
      marker.participant = participant; marker.signature = signature;
      marker.button.dataset.zoneId = String(zoneId);
      marker.button.style.setProperty('--faction', FACTION_HEX_COLORS[payload.faction]);
      const teamRing = marker.avatar?.getObjectByName('BoardFactionRing') as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | undefined;
      teamRing?.material.color.set(FACTION_HEX_COLORS[payload.faction]);
      marker.button.setAttribute('aria-label', `Inspect ${payload.handle}, ${payload.factionName}, playing at ${boardZoneName(zoneId)}`);
      marker.button.title = `${payload.handle} · ${payload.factionName} · ${boardZoneName(zoneId)}`;
      if (marker.avatar) marker.avatar.userData.zoneId = zoneId;
      updateVesselPortrait(marker.portrait, presentVessel(payload));
    }
    this.directions.clear();
    for (let zoneId = 0; zoneId < 11; zoneId++) {
      const seated = participants.filter(p => p.zoneId === zoneId);
      const positions = boardSeatDirections(zoneId, seated.length);
      seated.forEach((p, index) => this.directions.set(p.id, { ...positions[index], count: seated.length }));
    }
    this.rosterButton.textContent = `Agents (${participants.length})`;
    this.updateAvailability(); this.refreshRoster(); this.refreshInspector(); this.budget.invalidate();
  }

  private inspect(id: string, trigger: HTMLElement): void {
    this.returnFocus = trigger; this.selected = id; this.refreshInspector(); this.dialog.showModal();
    this.modelPreview?.destroy(); this.modelPreview = undefined;
    try { this.modelPreview = new VesselModelPreview(this.dialog.querySelector('.pk-board-model-preview')!, this.markers.get(id)!.participant.payload,
      available => this.setPreviewAvailability(available)); }
    catch { /* The portrait and all measurements remain usable without WebGL. */ }
    this.setPreviewAvailability(!!this.modelPreview);
    this.dialog.querySelectorAll<HTMLElement>('[data-view]')!.forEach(button => {
      if (button.dataset.view !== 'reset') button.setAttribute('aria-pressed', String(button.dataset.view === 'figure'));
    });
    this.dialog.scrollTop = 0;
  }

  private setPreviewAvailability(available: boolean): void {
    const preview = this.dialog.querySelector<HTMLElement>('.pk-board-model-preview')!;
    const controls = this.dialog.querySelector<HTMLElement>('.pk-board-model-tools')!;
    const needsFocus = !available && (preview.contains(document.activeElement) || controls.contains(document.activeElement));
    this.dialog.querySelector<HTMLImageElement>('.pk-board-agent-portrait')!.hidden = available;
    preview.hidden = !available;
    this.dialog.querySelector<HTMLElement>('.pk-board-model-hint')!.hidden = !available;
    controls.hidden = !available;
    const status = this.dialog.querySelector<HTMLElement>('.pk-board-model-status')!;
    status.hidden = available;
    status.textContent = available ? '' : '3D preview unavailable. Portrait and live measurements remain available.';
    if (needsFocus) this.dialog.querySelector<HTMLButtonElement>('.pk-board-agent-close')!.focus();
  }

  private refreshRoster(): void {
    const desired = new Set(this.markers.keys());
    for (const [id, button] of this.rosterRows) if (!desired.has(id)) {
      if (button === document.activeElement) this.rosterDialog.querySelector<HTMLButtonElement>('.pk-board-agent-close')!.focus();
      button.remove(); this.rosterRows.delete(id);
    }
    for (const [id, marker] of this.markers) {
      let button = this.rosterRows.get(id);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'pk-board-roster-row';
        const portrait = document.createElement('img'); portrait.width = portrait.height = 40;
        button.append(portrait, document.createElement('span'));
        button.onclick = () => this.inspect(id, button!);
        this.rosterRows.set(id, button); this.rosterDialog.querySelector('.pk-board-roster-list')!.append(button);
      }
      const { payload, zoneId } = marker.participant;
      button.style.setProperty('--faction', FACTION_HEX_COLORS[payload.faction]);
      button.querySelector('span')!.textContent = `${payload.handle} · ${payload.factionName} · ${boardZoneName(zoneId)}`;
      updateVesselPortrait(button.querySelector('img')!, presentVessel(payload));
    }
    const teams = new Map<number, string>();
    for (const marker of this.markers.values()) teams.set(marker.participant.payload.faction, marker.participant.payload.factionName);
    this.rosterDialog.querySelector('.pk-board-team-key')!.replaceChildren(...[...teams].sort(([a],[b]) => a - b).map(([faction, name]) => {
      const item = document.createElement('span'); item.textContent = name;
      item.style.setProperty('--faction', FACTION_HEX_COLORS[faction]); return item;
    }));
    this.rosterDialog.querySelector('.pk-board-roster-empty')!.textContent = this.markers.size ? ''
      : this.source === 'live' ? 'No historical agents are currently seated at active tables.' : 'Waiting for live game seats.';
  }

  private removeMarker(id: string, marker: Marker): void {
    if (this.selected === id) {
      this.returnFocus = this.rosterDialog.open ? this.rosterDialog.querySelector<HTMLButtonElement>('.pk-board-agent-close')! : this.visibilityButton;
      this.selected = null; this.dialog.close();
    }
    if (marker.avatar) { this.scene.remove(marker.avatar); disposeVesselAvatar(marker.avatar); }
    const wasFocused = document.activeElement === marker.button;
    marker.button.remove(); this.markers.delete(id);
    if (wasFocused) this.visibilityButton.focus();

  }

  private refreshInspector(): void {
    const marker = this.selected === null ? undefined : this.markers.get(this.selected);
    if (!marker) return;
    const { payload, zoneId, tableId, seatId, score } = marker.participant;
    const view = presentVesselInspector(payload);
    this.modelPreview?.update(payload);
    this.dialog.style.setProperty('--faction', FACTION_HEX_COLORS[payload.faction]);
    this.dialog.querySelector('h2')!.textContent = payload.handle;
    this.dialog.querySelector('.pk-board-agent-territory')!.textContent = `${boardZoneName(zoneId)} · Table ${tableId} · Seat ${seatId}`;
    this.dialog.querySelector('.pk-board-agent-faction')!.textContent = `${payload.factionName} faction`;
    this.dialog.querySelector('.pk-board-agent-source')!.textContent = `Live participant · ${view.sourceLabel} · ${view.snapshotLabel}`;
    const note = this.dialog.querySelector<HTMLElement>('.pk-board-agent-baseline-note')!;
    note.textContent = view.baselineNote; note.hidden = !view.baselineNote;
    this.dialog.querySelectorAll<HTMLImageElement>('.pk-board-profile-portrait, .pk-board-agent-portrait')
      .forEach(portrait => updateVesselPortrait(portrait, view));
    const metrics = this.dialog.querySelector('dl')!;
    const ratingTag = view.catalogRatings ? 'Catalog' : '';
    const elementTag = view.catalogElements ? 'Catalog' : '';
    const values: Array<[string, string, string?, string?]> = [
      ['Game score', score === null ? '—' : String(score)], ['Overall', view.ovr, ratingTag], ['Archetype', view.archetype, ratingTag],
      ...SACRED_STAT_KEYS.map(key => [key, view.ratings ? String(view.ratings[key]) : '—', ratingTag] as [string, string, string]),
      ['Surge', view.surge ? `${view.surge.meter}%` : 'Awaiting live sky'],
      ['Seals', view.seals ? `${view.seals.length} ${view.catalogElements ? 'baseline' : 'earned'}` : 'Awaiting live ledger', elementTag,
        view.seals?.map(seal => `${seal.name} · ${seal.tier}`).join('\n')],
      ...Object.keys(payload.esms).map(key => [key, view.esms ? formatVesselBalance(view.esms[key as keyof typeof view.esms]) : 'Awaiting live ledger', elementTag] as [string, string, string])];
    metrics.replaceChildren(...values.map(([label, value, source, detail]) => {
      const pair = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value;
      if (source) { const tag = document.createElement('span'); tag.className = 'pk-board-metric-source'; tag.textContent = source; dt.append(tag); }
      if (detail) { const description = document.createElement('small'); description.className = 'pk-board-seal-names'; description.textContent = detail; dd.append(description); }
      if (label === 'Seals' && detail) pair.className = 'pk-board-seals-metric';
      pair.append(dt, dd); return pair;
    }));
  }

  /** Called after the SVG projection, so there is no second camera or animation clock. */
  renderFrame(frame: BoardAvatarFrame): void {
    if (this.destroyed) return;
    this.enabled = frame.enabled;
    this.root.hidden = !this.visible || !frame.enabled;
    this.controls.hidden = !frame.enabled;
    const deploying = frame.deploying || this.dragging;
    this.root.classList.toggle('pk-board-deploying', deploying);
    if (!frame.enabled) { this.dialog.close(); this.rosterDialog.close(); }
    if (window.devicePixelRatio !== this.density) this.resize();
    if (this.dialog.open && frame.time - this.inspectorTime > 1000) { this.inspectorTime = frame.time; this.refreshInspector(); }
    if (this.dialog.open) this.modelPreview?.render(frame.time, this.motion.matches);
    const drawable = this.visible && frame.enabled && this.intersecting && !document.hidden && !document.querySelector('dialog[open]') && this.width > 0 && this.height > 0;
    const anchors = [...this.directions].map(([id, p]) => ({ id, count: p.count, ...frame.project(p.alt, p.az) }));
    const projection = `${frame.scale}:${anchors.map(p => `${p.id}:${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`;
    if (projection !== this.lastProjection) { this.budget.invalidate(); this.lastProjection = projection; }
    const dt = this.lastTime ? Math.min(0.1, (frame.time - this.lastTime) / 1000) : 0;
    this.lastTime = frame.time;
    if (!this.budget.shouldRender(frame.time, !this.motion.matches, drawable)) return;
    const { left, top, unit } = boardViewport(this.width, this.height);
    for (const anchor of anchors) {
      const marker = this.markers.get(anchor.id);
      if (!marker) continue;
      const onMap = [anchor.x, anchor.y].every(Number.isFinite) && anchor.x > 10 && anchor.x < 590 && anchor.y > 60 && anchor.y < 555;
      const crowded = anchor.count > 1;
      marker.button.classList.toggle('pk-board-agent-crowded', crowded);
      const avatarScale = (anchor.count > 3 ? 19 : anchor.count > 1 ? 22 : 27) * Math.min(2.2, Math.max(0.85, frame.scale));
      marker.button.hidden = !onMap;
      marker.button.disabled = deploying;
      marker.button.style.left = `${left + anchor.x * unit}px`;
      marker.button.style.top = `${top + anchor.y * unit}px`;
      marker.button.style.width = `${Math.max(28, avatarScale * 1.8 * unit)}px`;
      marker.button.style.height = `${Math.max(44, avatarScale * 3.1 * unit)}px`;
      marker.button.style.setProperty('--name-width', `${crowded ? Math.min(74, Math.max(48, 58 * frame.scale * unit)) : 118}px`);
      if (marker.avatar) {
        marker.avatar.visible = onMap;
        marker.avatar.position.set(anchor.x - 300, 300 - anchor.y, 0);
        marker.avatar.scale.setScalar(avatarScale);
        if (!this.motion.matches) updateVesselAvatarAnimation(marker.avatar, dt, frame.time / 1000);
      }
    }
    if (this.renderer && !this.lost) this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.feed.destroy(); this.observer.disconnect(); this.visibilityObserver.disconnect();
    document.removeEventListener('dragstart', this.dragStart);
    document.removeEventListener('dragend', this.dragEnd);
    document.removeEventListener('drop', this.dragEnd);
    this.dialog.close();
    this.modelPreview?.destroy(); this.modelPreview = undefined;
    for (const [id, marker] of this.markers) this.removeMarker(id, marker);
    this.renderer?.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    this.scene.environment = null; this.studio?.dispose();
    this.renderer?.dispose(); this.renderer?.forceContextLoss();
    this.rosterDialog.close(); this.rosterDialog.remove(); this.rosterRows.clear();
    this.host.classList.remove('pk-board-small-host');
    this.root.remove(); this.controls.remove(); this.dialog.remove();
  }
}
