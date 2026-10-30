import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PentacleArena3D } from './pentacle-arena-3d';

/** Fit a bounding sphere inside both dimensions, including portrait screens. */
export function courtFrameDistance(aspect: number, radius = 29, fov = 45): number {
  const vertical = THREE.MathUtils.degToRad(fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.1, aspect));
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
}

export class ArenaNavigation {
  readonly controls: OrbitControls;
  private preset: 'overview' | 'top' | null = 'overview';

  constructor(private arena: PentacleArena3D) {
    this.controls = new OrbitControls(arena.camera, arena.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 300;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.addEventListener('start', () => {
      this.preset = null;
      this.arena.cameraFocusTarget = null;
    });
    this.overview();
  }

  overview(top = false): void {
    this.preset = top ? 'top' : 'overview';
    const direction = top ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(0, 0.7, 1).normalize();
    this.frame(new THREE.Vector3(0, 3, 0), direction, courtFrameDistance(this.arena.camera.aspect));
  }

  focusSelection(): void {
    const selection = this.arena.selection;
    if (!selection) return;
    const agent = selection.agentId && this.arena.avatarRegistry.get(selection.agentId);
    const zone = this.arena.zones.get(selection.zoneId);
    if (!zone) return;
    this.preset = null;
    const target = (agent ? agent.group.position : zone.position).clone();
    target.y += agent ? 1.2 : 0.6;
    this.frame(target, new THREE.Vector3(0, 0.4, 1).normalize(), courtFrameDistance(this.arena.camera.aspect, agent ? 3 : 5));
  }

  zoom(factor: number): void {
    this.preset = null;
    const offset = this.arena.camera.position.clone().sub(this.controls.target);
    this.frame(this.controls.target.clone(), offset.clone().normalize(), THREE.MathUtils.clamp(offset.length() * factor, 5, 300));
  }

  resize(): void {
    if (this.preset) this.overview(this.preset === 'top');
  }

  update(): void {
    if (this.arena.cameraFocusTarget) {
      // The arena advances the position and look-at together. OrbitControls
      // must follow that target instead of turning back to its previous one.
      this.controls.target.copy(this.arena.cameraLookAt);
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = true;
    } else this.controls.update();
  }

  private frame(target: THREE.Vector3, direction: THREE.Vector3, distance: number): void {
    this.arena.cameraFocusTarget = null;
    // Clear residual orbit momentum before changing the inspection target.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(target);
    this.arena.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.update();
    this.controls.enableDamping = true;
  }

  destroy(): void { this.controls.dispose(); }
}
