/**
 * ============================================================================
 * Pentacles — 3D 11-Zone Pentacle Court Arena (PentacleArena3D)
 * ============================================================================
 *
 * Extrudes the 11 Pentacle sky-projection zones (5 Houses, 5 Spires, 1 Crown)
 * into elevated 3D board nodes connected by sacred geometric ley-lines.
 *
 * Coordinates:
 *   - Houses 0..4: Ground-tier outer pentagon (R=14, Y=0.6)
 *   - Spires 5..9: Mid-tier elevated star points (R=20, Y=3.2)
 *   - Crown (10): Celestial apex zenith summit (R=0, Y=7.0)
 *
 * Supports placing rated 3D avatars with the procedural under-foot resonance
 * ring shader directly onto any zone node, dual avatar positioning (owner vs challenger),
 * zone access rules enforcement, and interactive zone contests.
 */

import * as THREE from 'three';
import {
  type RatedAgentPayload,
  FIXTURE_AGENTS,
} from './rating-contract';
import {
  updateFootRing,
  FACTION_HEX_COLORS,
} from './avatar-foot-ring';
import {
  createVesselAvatarMesh,
  updateVesselAvatarAnimation,
  pickVesselAvatar,
  type VesselAnimationState,
} from './vessel-avatar-3d';
import {
  resolveTileContest,
  type TileContestResult,
} from './tile-contest';
import {
  canAccessZone,
  accessRefusalReason,
} from '../../alchm-chart/zone-access.js';

export interface ZoneNode3D {
  zoneId: number;
  name: string;
  kind: 'house' | 'spire' | 'crown';
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  barrierMesh?: THREE.Mesh;
  owner: number | null; // 0..9 planet index or null
  control: number; // -1000..+1000
  inFlux: boolean;
  avatarMesh?: THREE.Group; // Primary/owner avatar
  footRingMesh?: THREE.Mesh;
  currentAgent?: RatedAgentPayload;
  challengerMesh?: THREE.Group; // Challenger avatar
  challengerFootRing?: THREE.Mesh;
  challengerAgent?: RatedAgentPayload;
}

export interface ArenaOptions {
  container?: HTMLElement;
  width?: number;
  height?: number;
  onSelectAgent?: (agent: RatedAgentPayload) => void;
  onSelectZone?: (zoneId: number) => void;
  autoStartLoop?: boolean;
}

/** Compute canonical 3D coordinates for all 11 zones */
export function getZonePosition3D(zoneId: number): THREE.Vector3 {
  if (zoneId === 10) {
    // The Crown Zenith Apex
    return new THREE.Vector3(0, 7.0, 0);
  }

  if (zoneId >= 0 && zoneId <= 4) {
    // Houses: Pentagon at radius 14, Y = 0.6
    const R = 14.0;
    const Y = 0.6;
    const angle = (2 * Math.PI * zoneId) / 5 - Math.PI / 2;
    return new THREE.Vector3(R * Math.cos(angle), Y, R * Math.sin(angle));
  }

  if (zoneId >= 5 && zoneId <= 9) {
    // Spires: Interstitial star points at radius 20, Y = 3.2
    const R = 20.0;
    const Y = 3.2;
    const spireIdx = zoneId - 5;
    // Offset by 36 deg (PI/5) between house vertices
    const angle = (2 * Math.PI * spireIdx) / 5 - Math.PI / 2 + Math.PI / 5;
    return new THREE.Vector3(R * Math.cos(angle), Y, R * Math.sin(angle));
  }

  return new THREE.Vector3(0, 0, 0);
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

export function getZoneTitle(zoneId: number): string {
  if (zoneId <= 4) return `House ${ROMAN_NUMERALS[zoneId]}`;
  if (zoneId <= 9) return `Spire ${ROMAN_NUMERALS[zoneId - 5]}`;
  return 'The Crown Zenith';
}

export class PentacleArena3D {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public container: HTMLElement;
  public zones: Map<number, ZoneNode3D> = new Map();
  public avatarRegistry: Map<string, { group: THREE.Group; footRing: THREE.Mesh; payload: RatedAgentPayload }> = new Map();
  public leyLinesMesh: THREE.LineSegments | null = null;
  public leyLineMaterial: THREE.LineBasicMaterial | null = null;

  private animFrameId: number | null = null;
  private startTime: number = performance.now();
  private lastTime: number = performance.now();
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2(-999, -999);
  private onSelectAgent?: (agent: RatedAgentPayload) => void;
  private onSelectZone?: (zoneId: number) => void;

  constructor(options: ArenaOptions = {}) {
    this.container = options.container || (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
    this.onSelectAgent = options.onSelectAgent;
    this.onSelectZone = options.onSelectZone;

    const w = options.width || this.container.clientWidth || 800;
    const h = options.height || this.container.clientHeight || 600;

    // Scene & Camera setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060814); // Deep celestial space
    this.scene.fog = new THREE.FogExp2(0x060814, 0.012);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.5, 500);
    this.camera.position.set(0, 26, 38);
    this.camera.lookAt(0, 2, 0);

    // Renderer (headless/unit-test safe fallback)
    let rendererInstance: THREE.WebGLRenderer | any = null;
    try {
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        rendererInstance = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        rendererInstance.setSize(w, h);
        rendererInstance.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
        rendererInstance.shadowMap.enabled = true;
        rendererInstance.shadowMap.type = THREE.PCFSoftShadowMap;
        if (this.container && typeof this.container.appendChild === 'function') {
          this.container.appendChild(rendererInstance.domElement);
        }
      }
    } catch {
      rendererInstance = null;
    }

    this.renderer = rendererInstance || ({
      setSize: () => {},
      setPixelRatio: () => {},
      render: () => {},
      dispose: () => {},
      domElement: {
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      shadowMap: {},
    } as any);

    this.setupLighting();
    this.buildSacredFloor();
    this.buildZoneNodes();
    this.buildLeyLineConduits();
    this.bindEvents();
    if (options.autoStartLoop === true) {
      this.startLoop();
    }
  }

  private setupLighting(): void {
    // Ambient celestial starlight
    const ambient = new THREE.AmbientLight(0x1a243b, 1.2);
    this.scene.add(ambient);

    // Main Golden Dawn directional beam
    const sunBeam = new THREE.DirectionalLight(0xfff3d6, 2.2);
    sunBeam.position.set(20, 45, 20);
    sunBeam.castShadow = true;
    sunBeam.shadow.mapSize.width = 2048;
    sunBeam.shadow.mapSize.height = 2048;
    sunBeam.shadow.camera.near = 0.5;
    sunBeam.shadow.camera.far = 120;
    sunBeam.shadow.camera.left = -30;
    sunBeam.shadow.camera.right = 30;
    sunBeam.shadow.camera.top = 30;
    sunBeam.shadow.camera.bottom = -30;
    this.scene.add(sunBeam);

    // Subtle blue fill light from beneath
    const fillLight = new THREE.DirectionalLight(0x00daf3, 0.6);
    fillLight.position.set(-20, -10, -20);
    this.scene.add(fillLight);
  }

  private buildSacredFloor(): void {
    // Deep starry floor plate
    const floorGeo = new THREE.CylinderGeometry(28, 29, 0.6, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x070b19,
      roughness: 0.85,
      metalness: 0.2,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Inlay outer sacred gold perimeter ring
    const ringGeo = new THREE.RingGeometry(27.6, 27.9, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd8b46a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.02;
    this.scene.add(ringMesh);
  }

  private buildZoneNodes(): void {
    for (let i = 0; i <= 10; i++) {
      const pos = getZonePosition3D(i);
      const kind = i <= 4 ? 'house' : i <= 9 ? 'spire' : 'crown';
      const title = getZoneTitle(i);

      // Node base dimensions
      const radius = kind === 'crown' ? 3.4 : kind === 'spire' ? 2.5 : 2.2;
      const height = kind === 'crown' ? 1.4 : kind === 'spire' ? 1.0 : 0.8;

      const nodeGroup = new THREE.Group();
      nodeGroup.position.copy(pos);

      // Pedestal cylinder
      const cylGeo = new THREE.CylinderGeometry(radius, radius * 1.08, height, kind === 'crown' ? 10 : 8);
      const cylMat = new THREE.MeshStandardMaterial({
        color: kind === 'crown' ? 0x221c10 : 0x111628,
        metalness: 0.4,
        roughness: 0.6,
      });
      const pedestal = new THREE.Mesh(cylGeo, cylMat);
      pedestal.position.y = height / 2;
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;
      pedestal.name = `zone_pedestal_${i}`;
      pedestal.userData = { zoneId: i };
      nodeGroup.add(pedestal);

      // Glowing rim cap
      const capGeo = new THREE.RingGeometry(radius * 0.75, radius * 0.98, 32);
      const capMat = new THREE.MeshBasicMaterial({
        color: kind === 'crown' ? 0xffdf88 : 0x00daf3,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = height + 0.01;
      nodeGroup.add(cap);

      // Celestial barrier dome (for locked/sealed state)
      const barrierGeo = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 2.4, 16, 1, true);
      const barrierMat = new THREE.MeshBasicMaterial({
        color: 0xef4444, // Red / amber warning barrier
        wireframe: true,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
      });
      const barrier = new THREE.Mesh(barrierGeo, barrierMat);
      barrier.position.y = height + 1.2;
      barrier.visible = false;
      barrier.name = `zone_barrier_${i}`;
      nodeGroup.add(barrier);

      // Zone identification beacon light
      const nodeGlow = new THREE.PointLight(kind === 'crown' ? 0xffdf88 : 0x38bdf8, 1.2, 14);
      nodeGlow.position.y = height + 0.4;
      nodeGroup.add(nodeGlow);

      this.scene.add(nodeGroup);

      this.zones.set(i, {
        zoneId: i,
        name: title,
        kind,
        position: new THREE.Vector3(pos.x, pos.y + height, pos.z),
        mesh: pedestal,
        glowMesh: cap,
        barrierMesh: barrier,
        owner: null,
        control: 0,
        inFlux: false,
      });
    }
  }

  private buildLeyLineConduits(): void {
    this.leyLineMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
    });

    const conduitGeo = new THREE.BufferGeometry();
    const positions: number[] = [];

    // 1. Pentagon lines between adjacent Houses (0->1->2->3->4->0)
    for (let i = 0; i < 5; i++) {
      const p1 = this.zones.get(i)!.position;
      const p2 = this.zones.get((i + 1) % 5)!.position;
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    // 2. Lines from Spires (5..9) to their two adjacent Houses
    for (let s = 5; s < 10; s++) {
      const spirePos = this.zones.get(s)!.position;
      const spireIdx = s - 5;
      const houseA = this.zones.get(spireIdx)!.position;
      const houseB = this.zones.get((spireIdx + 4) % 5)!.position;

      positions.push(spirePos.x, spirePos.y, spirePos.z, houseA.x, houseA.y, houseA.z);
      positions.push(spirePos.x, spirePos.y, spirePos.z, houseB.x, houseB.y, houseB.z);
    }

    // 3. Lines from all 5 Spires to the Crown Zenith (Zone 10)
    const crownPos = this.zones.get(10)!.position;
    for (let s = 5; s < 10; s++) {
      const spirePos = this.zones.get(s)!.position;
      positions.push(spirePos.x, spirePos.y, spirePos.z, crownPos.x, crownPos.y, crownPos.z);
    }

    conduitGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.leyLinesMesh = new THREE.LineSegments(conduitGeo, this.leyLineMaterial);
    this.scene.add(this.leyLinesMesh);
  }

  /**
   * Returns current zone ownership map (array of length 11)
   */
  public getZoneOwners(): Array<number | null> {
    const owners: Array<number | null> = [];
    for (let i = 0; i <= 10; i++) {
      owners.push(this.zones.get(i)?.owner ?? null);
    }
    return owners;
  }

  /**
   * Evaluates if a faction has access to a zone under canonical access rules
   */
  public isZoneAccessible(zoneId: number, faction: number): boolean {
    return canAccessZone(zoneId, faction, this.getZoneOwners());
  }

  /**
   * Set visual locked/sealed barrier state on a zone pedestal
   */
  public updateZoneBarrier(zoneId: number, isLocked: boolean): void {
    const zone = this.zones.get(zoneId);
    if (!zone || !zone.barrierMesh) return;

    zone.barrierMesh.visible = isLocked;
    const mat = zone.barrierMesh.material as THREE.MeshBasicMaterial;
    if (mat) {
      mat.opacity = isLocked ? 0.65 : 0.0;
    }
  }

  /**
   * Place an avatar on a zone. Supports flexible signatures:
   *   arena.placeAvatarOnZone(zoneId, payload, slot?)
   *   arena.placeAvatarOnZone(payload, zoneId, slot?)
   */
  public placeAvatarOnZone(
    arg1: number | RatedAgentPayload,
    arg2: RatedAgentPayload | number,
    slot: 'owner' | 'challenger' = 'owner'
  ): THREE.Group | null {
    let zoneId: number;
    let payload: RatedAgentPayload;

    if (typeof arg1 === 'number') {
      zoneId = arg1;
      payload = arg2 as RatedAgentPayload;
    } else {
      payload = arg1;
      zoneId = arg2 as number;
    }

    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    // Check access rules for challenger
    if (slot === 'challenger' && !this.isZoneAccessible(zoneId, payload.faction)) {
      const reason = accessRefusalReason(zoneId, payload.faction, this.getZoneOwners());
      console.warn(`[PentacleArena3D] Zone ${zoneId} access refused:`, reason);
      this.updateZoneBarrier(zoneId, true);
    }

    // Tangent calculation for dual slot positioning
    const P = zone.position;
    let T = new THREE.Vector3(1, 0, 0);
    if (zoneId !== 10) {
      const R = new THREE.Vector3(P.x, 0, P.z).normalize();
      T = new THREE.Vector3(-R.z, 0, R.x).normalize();
    }

    // Create 3D Vessel Avatar hierarchy using the procedural avatar factory
    const avatarGroup = createVesselAvatarMesh(payload, {
      zoneId,
      slot,
      footRingRadius: zone.kind === 'crown' ? 2.6 : 1.9,
    });

    const sprite = this.createAvatarSprite(payload);
    sprite.position.y = 2.8;
    avatarGroup.add(sprite);

    // Remove old avatar in this slot if already occupied
    if (slot === 'owner' && zone.avatarMesh) {
      this.scene.remove(zone.avatarMesh);
      this.avatarRegistry.delete(zone.currentAgent?.key || '');
    } else if (slot === 'challenger' && zone.challengerMesh) {
      this.scene.remove(zone.challengerMesh);
      this.avatarRegistry.delete(zone.challengerAgent?.key || '');
    }

    if (slot === 'owner') {
      zone.avatarMesh = avatarGroup;
      zone.currentAgent = payload;
      zone.footRingMesh = avatarGroup.userData.footRing;
    } else {
      zone.challengerMesh = avatarGroup;
      zone.challengerAgent = payload;
      zone.challengerFootRing = avatarGroup.userData.footRing;
    }

    // Offset symmetrically across pedestal if both slots are occupied
    if (zone.avatarMesh && zone.challengerMesh) {
      const ownerPos = P.clone().add(T.clone().multiplyScalar(-1.1));
      const challPos = P.clone().add(T.clone().multiplyScalar(+1.1));

      zone.avatarMesh.position.copy(ownerPos);
      zone.challengerMesh.position.copy(challPos);

      // Avatars face each other in duel stance
      zone.avatarMesh.lookAt(challPos.x, ownerPos.y, challPos.z);
      zone.challengerMesh.lookAt(ownerPos.x, challPos.y, ownerPos.z);
    } else if (slot === 'owner') {
      avatarGroup.position.copy(P);
    } else {
      // Single challenger facing inward
      avatarGroup.position.copy(P.clone().add(T.clone().multiplyScalar(1.1)));
    }

    this.scene.add(avatarGroup);
    this.avatarRegistry.set(payload.key, {
      group: avatarGroup,
      footRing: avatarGroup.userData.footRing,
      payload,
    });

    return avatarGroup;
  }

  /**
   * Procedural canvas sprite displaying Vessel OVR badge & handle
   */
  private createAvatarSprite(payload: RatedAgentPayload): THREE.Sprite {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      const spriteMat = new THREE.SpriteMaterial({ transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(3.2, 1.6, 1.0);
      return sprite;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, 256, 128);

      // Container background
      ctx.fillStyle = 'rgba(10, 14, 28, 0.88)';
      ctx.strokeStyle = payload.surge.active ? '#ffaa00' : 'rgba(216, 180, 106, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(16, 20, 224, 72, 36);
      ctx.fill();
      ctx.stroke();

      // Vessel OVR Badge circle
      const ovrColor = payload.ovr >= 96 ? '#f59e0b' : payload.ovr >= 88 ? '#38bdf8' : '#a855f7';
      ctx.fillStyle = ovrColor;
      ctx.beginPath();
      ctx.arc(56, 56, 26, 0, Math.PI * 2);
      ctx.fill();

      // OVR number
      ctx.fillStyle = '#060814';
      ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(payload.ovr), 56, 57);

      // Handle & Archetype text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(payload.handle.substring(0, 12), 92, 46);

      ctx.fillStyle = payload.surge.active ? '#ffaa00' : '#94a3b8';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const subText = payload.surge.active ? '⚡ SURGE' : payload.archetype.title;
      ctx.fillText(subText.substring(0, 16), 92, 68);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.2, 1.6, 1.0);
    return sprite;
  }

  /**
   * Animate a Tile Contest between attacker and defender on a zone
   */
  public async animateZoneContest(
    zoneId: number,
    attackerPayload: RatedAgentPayload,
    defenderPayload: RatedAgentPayload
  ): Promise<TileContestResult> {
    const zone = this.zones.get(zoneId);
    const currentControl = zone ? zone.control : 0;

    // 1. Resolve mathematical contest result
    const result = resolveTileContest(attackerPayload, defenderPayload, {
      zoneId,
      kind: zone?.kind ?? 'house',
      owner: zone?.owner ?? null,
      control: currentControl,
    });

    // 2. Set animation states on avatars
    const attackerReg = this.avatarRegistry.get(attackerPayload.key);
    const defenderReg = this.avatarRegistry.get(defenderPayload.key);

    if (attackerReg) {
      attackerReg.group.userData.animationState = 'contest-attack';
    }
    if (defenderReg) {
      defenderReg.group.userData.animationState = 'contest-defend';
    }

    // 3. Flash ley-line conduits and pedestal glow
    if (this.leyLineMaterial) {
      this.leyLineMaterial.opacity = 0.85;
      this.leyLineMaterial.color.setHex(0xffaa00);
    }
    if (zone && zone.glowMesh.material instanceof THREE.MeshBasicMaterial) {
      zone.glowMesh.material.opacity = 1.0;
    }

    // 4. Update zone control and ownership
    if (zone) {
      let newOwner = zone.owner;
      if (result.winner === 'challenger' && result.newZoneControl <= -500) {
        newOwner = attackerPayload.faction;
      } else if (result.winner === 'defender' && result.newZoneControl >= 500) {
        newOwner = defenderPayload.faction;
      }
      this.updateZoneStatus(zoneId, newOwner, result.newZoneControl);
    }

    // Emit custom event for UI / VesselCardHUD listeners
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pentacle:zone-contest', {
          detail: {
            zoneId,
            result,
            attacker: attackerPayload,
            defender: defenderPayload,
          },
        })
      );
    }

    // Reset effects and animation states after contest duration
    setTimeout(() => {
      if (attackerReg) {
        attackerReg.group.userData.animationState = attackerPayload.surge.active ? 'surge' : 'idle';
      }
      if (defenderReg) {
        defenderReg.group.userData.animationState = defenderPayload.surge.active ? 'surge' : 'idle';
      }
      if (this.leyLineMaterial) {
        this.leyLineMaterial.opacity = 0.35;
        this.leyLineMaterial.color.setHex(0x38bdf8);
      }
    }, 1800);

    return result;
  }

  /**
   * Update zone ownership and control status from SpacetimeDB table feed
   */
  public updateZoneStatus(zoneId: number, ownerFaction: number | null, control: number): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;

    zone.owner = ownerFaction;
    zone.control = Math.max(-1000, Math.min(1000, control));

    const colorHex = ownerFaction != null ? FACTION_HEX_COLORS[ownerFaction] : '#38bdf8';
    const c = new THREE.Color(colorHex);

    if (zone.glowMesh.material instanceof THREE.MeshBasicMaterial) {
      zone.glowMesh.material.color.copy(c);
      zone.glowMesh.material.opacity = ownerFaction != null ? 0.9 : 0.45;
    }
  }

  /**
   * Populate court with standard reference fixtures
   */
  public loadFixtures(): void {
    // Newton at Spire I (Zone 5)
    this.placeAvatarOnZone(5, FIXTURE_AGENTS[0], 'owner');
    // Emily Dickinson at House II (Zone 1) (Active Surge!)
    this.placeAvatarOnZone(1, FIXTURE_AGENTS[1], 'owner');
    // Leonardo da Vinci at Crown Zenith (Zone 10) (Equilibrium Surge!)
    this.placeAvatarOnZone(10, FIXTURE_AGENTS[2], 'owner');
    // Custom Avatar Neo contesting House IV (Zone 3)
    this.placeAvatarOnZone(3, FIXTURE_AGENTS[3], 'challenger');

    this.updateZoneStatus(5, 6, 750); // Saturn held
    this.updateZoneStatus(1, 3, 900); // Venus held
    this.updateZoneStatus(10, 5, 450); // Jupiter held
    this.updateZoneStatus(3, 0, 600); // Sun held
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;

    const handlePointerDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Check avatar selection first via pickVesselAvatar
      const picked = pickVesselAvatar(this.raycaster, this.scene);
      if (picked) {
        this.onSelectAgent?.(picked.payload);
        if (picked.zoneId !== null) {
          this.onSelectZone?.(picked.zoneId);
        }
        return;
      }

      // Check zone pedestal clicks
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);
      for (const hit of intersects) {
        let curr: THREE.Object3D | null = hit.object;
        while (curr) {
          if (curr.userData && curr.userData.zoneId !== undefined) {
            this.onSelectZone?.(curr.userData.zoneId);
            return;
          }
          curr = curr.parent;
        }
      }
    };

    canvas.addEventListener('click', handlePointerDown);
  }

  public startLoop(): void {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      const now = performance.now();
      const elapsedSec = (now - this.startTime) / 1000;
      const deltaSec = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;

      // Update foot ring shaders and articulated vessel avatar animations
      for (const [_, reg] of this.avatarRegistry) {
        updateFootRing(reg.footRing, reg.payload, elapsedSec);
        updateVesselAvatarAnimation(reg.group, deltaSec, elapsedSec);
      }

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public destroy(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}

/** Standalone helper for placing avatars on arena */
export function placeAvatarOnZone(
  arena: PentacleArena3D,
  agent: RatedAgentPayload,
  zoneId: number,
  slot?: 'owner' | 'challenger'
): THREE.Group | null {
  return arena.placeAvatarOnZone(agent, zoneId, slot);
}

/** Standalone helper for animating zone contests */
export function animateZoneContest(
  arena: PentacleArena3D,
  zoneId: number,
  attackerPayload: RatedAgentPayload,
  defenderPayload: RatedAgentPayload
): Promise<TileContestResult> {
  return arena.animateZoneContest(zoneId, attackerPayload, defenderPayload);
}
