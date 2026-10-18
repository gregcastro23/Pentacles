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
  refreshVesselFromPayload,
  disposeVesselAvatar,
  setVesselAnimationState,
  pickVesselAvatar,
} from './vessel-avatar-3d';
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
  fluxLevel: number;
  accessLocked: boolean;
  avatarMesh?: THREE.Group; // Primary/owner avatar
  footRingMesh?: THREE.Mesh;
  currentAgent?: RatedAgentPayload;
  challengerMesh?: THREE.Group; // Challenger avatar
  challengerFootRing?: THREE.Mesh;
  challengerAgent?: RatedAgentPayload;
}

type AvatarSlot = 'owner' | 'challenger';

export interface ArenaAvatarRegistration {
  group: THREE.Group;
  footRing: THREE.Mesh;
  payload: RatedAgentPayload;
  zoneId: number;
  slot: AvatarSlot | 'spectator';
  /** Destination while in flight; zoneId remains the last occupied node until landing. */
  targetZoneId?: number;
}

interface TravelWaypoint {
  position: THREE.Vector3;
  zoneId: number;
}

interface AvatarTravel {
  waypoints: TravelWaypoint[];
  lengths: number[];
  totalLength: number;
  elapsed: number;
  duration: number;
  targetZoneId: number;
  slot: AvatarSlot;
  segment: number;
  pulse: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  promise: Promise<boolean>;
  resolve: (completed: boolean) => void;
}

interface ContestAnimation {
  zoneId: number;
  attackerId: string;
  defenderId: string;
  stage: 'assembling' | 'clash';
  assemblyRemaining: number;
  elapsed: number;
  resolve: () => void;
}

/** Every travel route uses exactly the conduits drawn on the arena. */
export const LEY_LINE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: 5 }, (_, i) => [i, (i + 1) % 5] as const),
  ...Array.from({ length: 5 }, (_, i) => [i + 5, i] as const),
  ...Array.from({ length: 5 }, (_, i) => [i + 5, (i + 4) % 5] as const),
  ...Array.from({ length: 5 }, (_, i) => [i + 5, 10] as const),
];

/** Breadth-first traversal keeps a trip on connected ley lines, including Crown trips. */
export function getLeyLineRoute(source: number, target: number): number[] {
  if (!Number.isInteger(source) || !Number.isInteger(target) || source < 0 || source > 10 || target < 0 || target > 10) return [];
  const queue: number[][] = [[source]];
  const visited = new Set([source]);
  for (let index = 0; index < queue.length; index++) {
    const route = queue[index];
    const node = route[route.length - 1];
    if (node === target) return route;
    for (const [a, b] of LEY_LINE_CONNECTIONS) {
      const neighbor = a === node ? b : b === node ? a : undefined;
      if (neighbor !== undefined && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...route, neighbor]);
      }
    }
  }
  return [];
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
  public avatarRegistry: Map<string, ArenaAvatarRegistration> = new Map();
  public leyLinesMesh: THREE.LineSegments | null = null;
  public leyLineMaterial: THREE.LineBasicMaterial | null = null;

  private animFrameId: number | null = null;
  private lastTime: number = performance.now();
  private elapsedTime = 0;
  private destroyed = false;
  private travels = new Map<string, AvatarTravel>();
  private contests = new Set<ContestAnimation>();
  private pointerHandler?: (event: MouseEvent) => void;
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
        fluxLevel: 0,
        accessLocked: false,
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

    for (const [source, target] of LEY_LINE_CONNECTIONS) {
      const a = this.zones.get(source)!.position;
      const b = this.zones.get(target)!.position;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
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

    zone.accessLocked = isLocked;
    this.refreshZoneBarrier(zone);
  }

  private refreshZoneBarrier(zone: ZoneNode3D): void {
    if (!zone.barrierMesh) return;
    zone.barrierMesh.visible = zone.accessLocked || zone.inFlux;
    const mat = zone.barrierMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(zone.accessLocked ? 0xef4444 : 0xffaa00);
    mat.opacity = zone.accessLocked ? 0.65 : zone.inFlux ? 0.25 + zone.fluxLevel / 1000 * 0.5 : 0;
  }

  /** Flux and access locking share the dome without overwriting each other's state. */
  public updateZoneFlux(zoneId: number, inFlux: boolean, fluxLevel = 0): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;
    zone.inFlux = inFlux;
    zone.fluxLevel = Math.max(0, Math.min(1000, Number.isFinite(fluxLevel) ? fluxLevel : 0));
    this.refreshZoneBarrier(zone);
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

    if (this.destroyed) return null;
    this.cancelContestsFor(payload.key);
    this.cancelTravel(payload.key);
    let registration = this.avatarRegistry.get(payload.key);
    if (registration) {
      this.clearZoneSlot(registration);
      registration.payload = payload;
      refreshVesselFromPayload(registration.group, payload);
    } else {
      const group = createVesselAvatarMesh(payload, {
        zoneId,
        slot,
        footRingRadius: zone.kind === 'crown' ? 2.6 : 1.9,
      });
      const sprite = this.createAvatarSprite(payload);
      sprite.name = 'VesselIdentityBadge';
      sprite.position.y = 2.8;
      group.add(sprite);
      registration = { group, footRing: group.userData.footRing, payload, zoneId, slot };
      this.avatarRegistry.set(payload.key, registration);
      this.scene.add(group);
    }
    this.assignZoneSlot(registration, zoneId, slot);
    setVesselAnimationState(registration.group, payload.surge.active ? 'surge' : 'idle');
    return registration.group;
  }

  private tangent(zoneId: number): THREE.Vector3 {
    const point = this.zones.get(zoneId)!.position;
    return zoneId === 10 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-point.z, 0, point.x).normalize();
  }

  private clearZoneSlot(registration: ArenaAvatarRegistration): void {
    const zone = this.zones.get(registration.zoneId);
    if (!zone) return;
    if (zone.avatarMesh === registration.group) {
      zone.avatarMesh = undefined;
      zone.currentAgent = undefined;
      zone.footRingMesh = undefined;
    }
    if (zone.challengerMesh === registration.group) {
      zone.challengerMesh = undefined;
      zone.challengerAgent = undefined;
      zone.challengerFootRing = undefined;
    }
    // Travelling agents have already vacated the node's stationary layout.
    this.layoutZone(zone.zoneId, registration.payload.key);
  }

  private assignZoneSlot(registration: ArenaAvatarRegistration, zoneId: number, slot: AvatarSlot): void {
    const zone = this.zones.get(zoneId)!;
    const previous = slot === 'owner' ? zone.currentAgent : zone.challengerAgent;
    if (previous && previous.key !== registration.payload.key) {
      const displaced = this.avatarRegistry.get(previous.key);
      if (displaced) {
        displaced.slot = 'spectator';
        displaced.group.userData.slot = 'spectator';
      }
    }
    registration.zoneId = zoneId;
    registration.slot = slot;
    registration.group.userData.zoneId = zoneId;
    registration.group.userData.slot = slot;
    if (slot === 'owner') {
      zone.avatarMesh = registration.group;
      zone.currentAgent = registration.payload;
      zone.footRingMesh = registration.footRing;
    } else {
      zone.challengerMesh = registration.group;
      zone.challengerAgent = registration.payload;
      zone.challengerFootRing = registration.footRing;
    }
    this.layoutZone(zoneId);
  }

  private layoutZone(zoneId: number, excludeAgentId?: string): void {
    const zone = this.zones.get(zoneId)!;
    const center = zone.position;
    const tangent = this.tangent(zoneId);
    const occupants = [...this.avatarRegistry.values()].filter(registration =>
      registration.zoneId === zoneId && registration.payload.key !== excludeAgentId && !this.travels.has(registration.payload.key));
    let spectatorIndex = 0;
    const spectators = occupants.filter(registration => registration.slot === 'spectator');
    for (const registration of occupants) {
      if (registration.slot === 'spectator') {
        const angle = Math.PI / 2 + spectatorIndex++ * Math.PI * 2 / Math.max(1, spectators.length);
        registration.group.position.copy(center).add(new THREE.Vector3(Math.cos(angle) * 2.2, 0, Math.sin(angle) * 2.2));
      } else {
        const offset = registration.slot === 'challenger' ? 1.1 : zone.challengerMesh ? -1.1 : 0;
        registration.group.position.copy(center).addScaledVector(tangent, offset);
      }
      const facing = registration.slot === 'owner' ? zone.challengerMesh : zone.avatarMesh;
      if (facing && facing !== registration.group) {
        registration.group.lookAt(facing.position.x, center.y, facing.position.z);
      }
    }
    if (zone.avatarMesh && zone.challengerMesh) {
      zone.avatarMesh.lookAt(zone.challengerMesh.position.x, center.y, zone.challengerMesh.position.z);
      zone.challengerMesh.lookAt(zone.avatarMesh.position.x, center.y, zone.avatarMesh.position.z);
    }
  }

  /** Explicit removal releases the body, ring, badge textures and pending animations. */
  public removeAvatar(agentId: string): void {
    const registration = this.avatarRegistry.get(agentId);
    if (!registration) return;
    this.cancelContestsFor(agentId);
    this.cancelTravel(agentId);
    this.avatarRegistry.delete(agentId);
    this.clearZoneSlot(registration);
    disposeVesselAvatar(registration.group);
  }

  /** Tick-driven travel is independent of browser timers and follows connected edges. */
  public moveAvatarToZone(agentId: string, targetZoneId: number, durationMs = 900, slot: AvatarSlot = 'owner'): Promise<boolean> {
    return this.beginTravel(agentId, targetZoneId, durationMs, slot, false);
  }

  private beginTravel(agentId: string, targetZoneId: number, durationMs: number, slot: AvatarSlot, preserveContest: boolean): Promise<boolean> {
    const registration = this.avatarRegistry.get(agentId);
    if (!registration || !this.zones.has(targetZoneId) || this.destroyed) return Promise.resolve(false);
    const currentTravel = this.travels.get(agentId);
    if (currentTravel?.targetZoneId === targetZoneId && currentTravel.slot === slot) return currentTravel.promise;
    if (!preserveContest) this.cancelContestsFor(agentId);
    let sourceZoneId = registration.zoneId;
    let departureZoneId = sourceZoneId;
    let returnToEdge = false;
    if (currentTravel) {
      const from = currentTravel.waypoints[currentTravel.segment];
      const to = currentTravel.waypoints[currentTravel.segment + 1];
      sourceZoneId = registration.group.position.distanceTo(from.position) < registration.group.position.distanceTo(to.position) ? from.zoneId : to.zoneId;
      departureZoneId = sourceZoneId === from.zoneId ? to.zoneId : from.zoneId;
      returnToEdge = true;
    }
    this.cancelTravel(agentId);
    const sourcePosition = registration.group.position.clone();
    this.clearZoneSlot(registration);
    const route = getLeyLineRoute(sourceZoneId, targetZoneId);
    const waypoints: TravelWaypoint[] = [{ position: sourcePosition, zoneId: departureZoneId }];
    if (returnToEdge && sourcePosition.distanceTo(this.zones.get(sourceZoneId)!.position) > 0.001) {
      waypoints.push({ position: this.zones.get(sourceZoneId)!.position.clone(), zoneId: sourceZoneId });
    }
    for (const zoneId of route.slice(1)) waypoints.push({ position: this.zones.get(zoneId)!.position.clone(), zoneId });
    // The landing offset is applied only on the final node, including same-node assembly.
    const targetZone = this.zones.get(targetZoneId)!;
    const targetPosition = targetZone.position.clone().addScaledVector(this.tangent(targetZoneId), slot === 'challenger' ? 1.1 : targetZone.challengerMesh ? -1.1 : 0);
    if (waypoints.length === 1) waypoints.push({ position: targetPosition, zoneId: targetZoneId });
    else waypoints[waypoints.length - 1].position.copy(targetPosition);
    const lengths = waypoints.slice(1).map((point, index) => Math.max(0.00001, point.position.distanceTo(waypoints[index].position)));
    const totalLength = lengths.reduce((total, length) => total + length, 0);
    if (totalLength < 0.001 || durationMs <= 0) {
      this.assignZoneSlot(registration, targetZoneId, slot);
      setVesselAnimationState(registration.group, registration.payload.surge.active ? 'surge' : 'idle');
      return Promise.resolve(true);
    }
    let resolve!: (completed: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const pulse = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.9 }));
    pulse.name = `ActiveLeyLine_${agentId}`;
    this.scene.add(pulse);
    this.travels.set(agentId, { waypoints, lengths, totalLength, elapsed: 0, duration: Math.max(0.001, Number.isFinite(durationMs) ? durationMs / 1000 : 0.9), targetZoneId, slot, segment: 0, pulse, promise, resolve });
    registration.targetZoneId = targetZoneId;
    registration.group.userData.targetZoneId = targetZoneId;
    setVesselAnimationState(registration.group, 'travel');
    return promise;
  }

  private cancelTravel(agentId: string): void {
    const travel = this.travels.get(agentId);
    if (!travel) return;
    this.travels.delete(agentId);
    const registration = this.avatarRegistry.get(agentId);
    if (registration) {
      registration.targetZoneId = undefined;
      delete registration.group.userData.targetZoneId;
    }
    travel.pulse.removeFromParent();
    travel.pulse.geometry.dispose();
    travel.pulse.material.dispose();
    travel.resolve(false);
  }

  private advanceTravels(deltaSec: number): void {
    for (const [agentId, travel] of [...this.travels]) {
      const registration = this.avatarRegistry.get(agentId)!;
      travel.elapsed = Math.min(travel.duration, travel.elapsed + deltaSec);
      let distance = travel.elapsed / travel.duration * travel.totalLength;
      let segment = 0;
      while (segment < travel.lengths.length - 1 && distance > travel.lengths[segment]) distance -= travel.lengths[segment++];
      travel.segment = segment;
      const from = travel.waypoints[segment];
      const to = travel.waypoints[segment + 1];
      const phase = Math.min(1, distance / travel.lengths[segment]);
      registration.group.position.lerpVectors(from.position, to.position, phase);
      registration.group.position.y += 4 * phase * (1 - phase) * Math.min(4, Math.max(1.5, travel.lengths[segment] * 0.15));
      const direction = to.position.clone().sub(from.position);
      if (direction.x !== 0 || direction.z !== 0) registration.group.rotation.y = Math.atan2(direction.x, direction.z);
      const a = this.zones.get(from.zoneId)!.position;
      const b = this.zones.get(to.zoneId)!.position;
      travel.pulse.geometry.setFromPoints([a, b]);
      travel.pulse.visible = from.zoneId !== to.zoneId;
      travel.pulse.material.opacity = 0.65 + Math.sin(this.elapsedTime * 12) * 0.3;
      if (travel.elapsed >= travel.duration) {
        this.travels.delete(agentId);
        registration.targetZoneId = undefined;
        delete registration.group.userData.targetZoneId;
        travel.pulse.removeFromParent();
        travel.pulse.geometry.dispose();
        travel.pulse.material.dispose();
        this.assignZoneSlot(registration, travel.targetZoneId, travel.slot);
        setVesselAnimationState(registration.group, registration.payload.surge.active ? 'surge' : 'idle');
        travel.resolve(true);
      }
    }
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

  /** Assemble both actors before a visual clash; server ownership remains authoritative. */
  public animateZoneContest(
    zoneId: number,
    attacker: string | RatedAgentPayload,
    defender: string | RatedAgentPayload
  ): Promise<void> {
    if (this.destroyed || !this.zones.has(zoneId)) return Promise.resolve();
    const attackerId = typeof attacker === 'string' ? attacker : attacker.key;
    const defenderId = typeof defender === 'string' ? defender : defender.key;
    if (attackerId === defenderId) return Promise.resolve();
    if (typeof attacker !== 'string') {
      if (!this.avatarRegistry.has(attackerId)) this.placeAvatarOnZone(zoneId, attacker, 'challenger');
      else this.refreshAvatar(attacker);
    }
    if (typeof defender !== 'string') {
      if (!this.avatarRegistry.has(defenderId)) this.placeAvatarOnZone(zoneId, defender, 'owner');
      else this.refreshAvatar(defender);
    }
    if (!this.avatarRegistry.has(attackerId) || !this.avatarRegistry.has(defenderId)) return Promise.resolve();
    this.cancelContestsFor(attackerId);
    this.cancelContestsFor(defenderId);
    // The owner occupies -1.1, the challenger +1.1 after both arrive.
    this.beginTravel(defenderId, zoneId, 450, 'owner', true);
    this.beginTravel(attackerId, zoneId, 450, 'challenger', true);
    return new Promise<void>(resolve => {
      const assemblyRemaining = Math.max(...[attackerId, defenderId].map(id => {
        const travel = this.travels.get(id);
        return travel ? travel.duration - travel.elapsed : 0;
      }));
      this.contests.add({ zoneId, attackerId, defenderId, stage: 'assembling', assemblyRemaining, elapsed: 0, resolve });
    });
  }

  private finishContest(contest: ContestAnimation): void {
    this.contests.delete(contest);
    for (const id of [contest.attackerId, contest.defenderId]) {
      const registration = this.avatarRegistry.get(id);
      if (registration && !this.travels.has(id)) setVesselAnimationState(registration.group, registration.payload.surge.active ? 'surge' : 'idle');
    }
    const zone = this.zones.get(contest.zoneId);
    if (zone) this.updateZoneStatus(zone.zoneId, zone.owner, zone.control);
    contest.resolve();
  }

  private cancelContestsFor(agentId: string): void {
    for (const contest of [...this.contests]) {
      if (contest.attackerId === agentId || contest.defenderId === agentId) this.finishContest(contest);
    }
  }

  private advanceContests(deltaSec: number): void {
    for (const contest of [...this.contests]) {
      const attacker = this.avatarRegistry.get(contest.attackerId);
      const defender = this.avatarRegistry.get(contest.defenderId);
      if (!attacker || !defender) {
        this.finishContest(contest);
        continue;
      }
      if (contest.stage === 'assembling') {
        contest.assemblyRemaining -= deltaSec;
        if (this.travels.has(contest.attackerId) || this.travels.has(contest.defenderId)) continue;
        if (attacker.zoneId !== contest.zoneId || defender.zoneId !== contest.zoneId) {
          this.finishContest(contest);
          continue;
        }
        contest.stage = 'clash';
        contest.elapsed = Math.max(0, -contest.assemblyRemaining);
        setVesselAnimationState(attacker.group, 'contest-attack');
        setVesselAnimationState(defender.group, 'contest-defend');
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pentacle:zone-contest', {
            detail: { zoneId: contest.zoneId, attacker: attacker.payload, defender: defender.payload },
          }));
        }
      } else contest.elapsed += deltaSec;
      if (contest.elapsed >= 1.8) {
        this.finishContest(contest);
        continue;
      }
      const zone = this.zones.get(contest.zoneId)!;
      (zone.glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(contest.elapsed * 18) * 0.15;
    }
  }

  /** Refresh live ratings without interrupting travel or changing a combat slot. */
  public refreshAvatar(payload: RatedAgentPayload): boolean {
    const registration = this.avatarRegistry.get(payload.key);
    if (!registration) return false;
    refreshVesselFromPayload(registration.group, payload);
    registration.payload = registration.group.userData.agentPayload;
    const zone = this.zones.get(registration.zoneId);
    if (zone?.avatarMesh === registration.group) zone.currentAgent = registration.payload;
    if (zone?.challengerMesh === registration.group) zone.challengerAgent = registration.payload;
    const previousBadge = registration.group.getObjectByName('VesselIdentityBadge') as THREE.Sprite | undefined;
    if (previousBadge) {
      previousBadge.removeFromParent();
      previousBadge.material.map?.dispose();
      previousBadge.material.dispose();
      const badge = this.createAvatarSprite(payload);
      badge.name = 'VesselIdentityBadge';
      badge.position.y = 2.8;
      registration.group.add(badge);
    }
    return true;
  }

  /**
   * Update zone ownership and control status from SpacetimeDB table feed
   */
  public updateZoneStatus(zoneId: number, ownerFaction: number | null, control: number, inFlux?: boolean, fluxLevel?: number): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;

    zone.owner = ownerFaction;
    zone.control = Math.max(-1000, Math.min(1000, control));
    if (inFlux !== undefined || fluxLevel !== undefined) this.updateZoneFlux(zoneId, inFlux ?? zone.inFlux, fluxLevel ?? zone.fluxLevel);

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

    this.pointerHandler = handlePointerDown;
    canvas.addEventListener('click', handlePointerDown);
  }

  /** Advance visual state deterministically; the browser loop uses this same path. */
  public update(deltaSec: number, elapsedSec?: number): void {
    if (this.destroyed) return;
    const delta = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    this.elapsedTime = elapsedSec !== undefined && Number.isFinite(elapsedSec) ? elapsedSec : this.elapsedTime + delta;
    // Live wallet refreshes replace the body's payload, so never overwrite them with a stale ring snapshot.
    for (const registration of this.avatarRegistry.values()) {
      const payload = registration.group.userData.agentPayload as RatedAgentPayload | undefined;
      if (payload && payload !== registration.payload) this.refreshAvatar(payload);
    }
    this.advanceTravels(delta);
    this.advanceContests(delta);
    for (const registration of this.avatarRegistry.values()) {
      updateFootRing(registration.footRing, registration.payload, this.elapsedTime);
      updateVesselAvatarAnimation(registration.group, delta, this.elapsedTime);
    }
  }

  public startLoop(): void {
    if (this.destroyed || this.animFrameId !== null || typeof requestAnimationFrame !== 'function') return;
    this.lastTime = performance.now();
    const animate = () => {
      if (this.destroyed) return;
      const now = performance.now();
      this.update(Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000)));
      this.lastTime = now;
      this.renderer.render(this.scene, this.camera);
      this.animFrameId = requestAnimationFrame(animate);
    };
    this.animFrameId = requestAnimationFrame(animate);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.pointerHandler) this.renderer.domElement.removeEventListener('click', this.pointerHandler);
    this.pointerHandler = undefined;
    for (const contest of [...this.contests]) this.finishContest(contest);
    for (const agentId of [...this.avatarRegistry.keys()]) this.removeAvatar(agentId);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) materials.add(material);
      }
      const light = object as THREE.Light & { shadow?: THREE.LightShadow };
      light.shadow?.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.clear();
    this.zones.clear();
    this.leyLinesMesh = null;
    this.leyLineMaterial = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
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
  attackerPayload: string | RatedAgentPayload,
  defenderPayload: string | RatedAgentPayload
): Promise<void> {
  return arena.animateZoneContest(zoneId, attackerPayload, defenderPayload);
}
