import * as THREE from 'three';
import type { RatedAgentPayload } from './rating-contract';
import { createVesselAvatarMesh, disposeVesselAvatar, refreshVesselFromPayload, setVesselRimUniforms, updateVesselAvatarAnimation } from './vessel-avatar-3d';
import { FACTION_HEX_COLORS } from './avatar-foot-ring';
import { createVesselStudioEnvironment, createVesselStudioLights } from './vessel-studio-lighting';
import { frameVesselPreview, vesselFigureBounds, type VesselPreviewView } from './vessel-preview-framing';
import { courtPixelRatio } from './court-resolution';

/** One full-detail figure, allocated only while its inspector is open; no extra RAF. */
export class VesselModelPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, .1, 30);
  private avatar: THREE.Group;
  private signature: string;
  private last = 0;
  private width = 0;
  private height = 0;
  private density = 0;
  private view: VesselPreviewView = 'figure';
  private bounds: THREE.Box3;
  private studio?: THREE.WebGLRenderTarget;
  private observer: IntersectionObserver;
  private headerObserver?: ResizeObserver;
  private intersecting = true;
  private dirty = true;
  private destroyed = false;
  private lost = false;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private pointer?: { id: number; x: number };

  constructor(private host: HTMLElement, payload: RatedAgentPayload, private onAvailability?: (available: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); if (this.destroyed) return;
      this.lost = true; this.onAvailability?.(false);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.destroyed) return;
      this.lost = false; this.setupStudio(); this.dirty = true; this.onAvailability?.(true);
    });
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `3D model of ${payload.handle}. Drag or use left and right arrow keys to turn. Home resets the view.`);
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.pointer = { id: event.pointerId, x: event.clientX }; canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', event => {
      if (this.pointer?.id !== event.pointerId) return;
      this.avatar.rotation.y += (event.clientX - this.pointer.x) * .012;
      this.pointer.x = event.clientX; this.dirty = true;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { this.pointer = undefined; canvas.style.cursor = ''; });
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Home') { event.preventDefault(); this.resetView(); return; }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); this.avatar.rotation.y += event.key === 'ArrowLeft' ? -.2 : .2; this.dirty = true;
    });
    host.append(canvas);
    this.scene.add(createVesselStudioLights());
    this.setupStudio();
    this.avatar = createVesselAvatarMesh(payload, { loadPortraitFace: true });
    this.avatar.rotation.y = -.15;
    this.avatar.userData.footRing.visible = false; this.avatar.userData.astralHalo.visible = false;
    setVesselRimUniforms(this.avatar, { intensity: .12 });
    const ring = this.ring = new THREE.Mesh(new THREE.RingGeometry(.7, .75, 48), new THREE.MeshBasicMaterial({ color: FACTION_HEX_COLORS[payload.faction], side: THREE.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .02; this.avatar.add(ring);
    this.scene.add(this.avatar);
    this.avatar.userData.portraitHead?.ready.then(() => {
      if (!this.destroyed) this.setView(this.view);
    });
    this.bounds = vesselFigureBounds(this.avatar, this.view);
    this.signature = JSON.stringify(payload);
    const dialog = host.closest('dialog');
    const header = dialog?.querySelector<HTMLElement>('.pk-board-inspector-header');
    let headerHeight = -1;
    const observeVisibility = () => {
      if (this.destroyed) return;
      const nextHeight = header?.offsetHeight ?? 0;
      if (nextHeight === headerHeight) return;
      dialog?.style.setProperty('--inspector-header-height', `${nextHeight}px`);
      headerHeight = nextHeight; this.observer?.disconnect();
      this.observer = new IntersectionObserver(entries => {
        if (this.destroyed) return;
        this.intersecting = entries[0]?.isIntersecting ?? false;
        if (this.intersecting) this.dirty = true;
        else this.last = 0;
      }, { root: dialog, rootMargin: `-${headerHeight}px 0px 0px 0px` });
      this.observer.observe(host);
    };
    observeVisibility();
    if (header) { this.headerObserver = new ResizeObserver(observeVisibility); this.headerObserver.observe(header); }
  }

  private setupStudio() {
    this.studio?.dispose(); this.studio = createVesselStudioEnvironment(this.renderer);
    this.scene.environment = this.studio?.texture ?? null; this.scene.environmentIntensity = .85;
  }

  setView(view: VesselPreviewView) {
    if (this.destroyed) return;
    this.view = view; this.bounds = vesselFigureBounds(this.avatar, view);
    frameVesselPreview(this.camera, this.bounds); this.dirty = true;
  }

  resetView() {
    if (this.destroyed) return;
    this.avatar.rotation.y = -.15; this.setView(this.view);
  }

  update(payload: RatedAgentPayload) {
    if (this.destroyed) return;
    const signature = JSON.stringify(payload);
    if (signature === this.signature) return;
    this.signature = signature; refreshVesselFromPayload(this.avatar, payload);
    this.ring.material.color.set(FACTION_HEX_COLORS[payload.faction]);
    setVesselRimUniforms(this.avatar, { intensity: .12 }); this.setView(this.view);
  }

  render(time: number, reducedMotion: boolean) {
    if (this.destroyed || this.lost) return;
    const width = this.host.clientWidth, height = this.host.clientHeight, density = window.devicePixelRatio || 1;
    if (!width || !height || !this.intersecting || document.hidden) { this.last = 0; return; }
    if (width !== this.width || height !== this.height || density !== this.density) {
      this.width = width; this.height = height; this.density = density;
      this.renderer.setPixelRatio(courtPixelRatio(width, height, Math.max(1.5, density), 650_000, this.renderer.capabilities.maxTextureSize));
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height; frameVesselPreview(this.camera, this.bounds); this.dirty = true;
    }
    if (!this.dirty && (reducedMotion || time - this.last < 66)) return;
    if (!reducedMotion) updateVesselAvatarAnimation(this.avatar, this.last ? Math.min(.1, (time - this.last) / 1000) : 0, time / 1000, 'idle');
    this.last = time; this.dirty = false; this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect(); this.headerObserver?.disconnect(); this.scene.environment = null; this.studio?.dispose();
    disposeVesselAvatar(this.avatar);
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
