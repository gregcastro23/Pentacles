import { describe, expect, it } from 'bun:test';
import { COURT_PIXEL_BUDGET, SHARP_PIXEL_BUDGET, courtPixelRatio, avatarPixelRatio } from '../src/lib/agents/court-resolution';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';

describe('Court framebuffer budget', () => {
  it('supersamples Sharp on standard-density screens within an explicit GPU budget', () => {
    expect(avatarPixelRatio(600, 600, 1, 'sharp')).toBe(1.5);
    expect(avatarPixelRatio(600, 600, 1, 'balanced')).toBe(1);
    expect(avatarPixelRatio(600, 600, NaN, 'sharp')).toBe(1.5);
    for (const [w, h] of [[3840, 2160], [100000, 20], [390, 844]]) {
      const ratio = avatarPixelRatio(w, h, 3, 'sharp', 4096);
      expect(Math.floor(w * ratio) * Math.floor(h * ratio)).toBeLessThanOrEqual(SHARP_PIXEL_BUDGET);
      expect(Math.max(w, h) * ratio).toBeLessThanOrEqual(4096);
    }
  });

  it('switches quality without recreating the scene or changing camera framing', () => {
    const arena = new PentacleArena3D();
    try {
      const ratios: number[] = [];
      arena.renderer.setDrawingBufferSize = (_w, _h, ratio) => { ratios.push(ratio); };
      arena.resize(600, 600);
      const scene = arena.scene, camera = arena.camera;
      arena.setRenderQuality('sharp');
      arena.setRenderQuality('balanced');
      expect(ratios).toEqual([1, 1.5, 1]);
      expect(arena.scene).toBe(scene);
      expect(arena.camera).toBe(camera);
      expect(camera.aspect).toBe(1);
    } finally { arena.destroy(); }
  });
  it('keeps small screens crisp and caps large or unusually wide framebuffers', () => {
    expect(courtPixelRatio(320, 390, 3)).toBe(2);
    for (const [width, height, dpr] of [[1920, 1080, 2], [3840, 2160, 2], [100000, 20, 3]]) {
      const ratio = courtPixelRatio(width, height, dpr);
      expect(Math.floor(width * ratio) * Math.floor(height * ratio)).toBeLessThanOrEqual(COURT_PIXEL_BUDGET);
      expect(width * ratio).toBeLessThanOrEqual(8192);
      expect(height * ratio).toBeLessThanOrEqual(8192);
    }
    expect(courtPixelRatio(800, 600, 1)).toBe(1);
    expect(courtPixelRatio(800, 600, NaN)).toBe(1);
    expect(courtPixelRatio(0, 600, 2)).toBe(1);
    expect(courtPixelRatio(800, 600, 2, -1)).toBe(2);
    expect(courtPixelRatio(800, 600, 2, 1_000_000, 1024)).toBe(1.28);
  });

  it('resizes the framebuffer without changing camera framing or reallocating an unchanged size', () => {
    const arena = new PentacleArena3D();
    try {
      const sizes: number[][] = [];
      arena.renderer.setDrawingBufferSize = (w, h, ratio) => { sizes.push([w, h, ratio]); };
      const canvas = arena.renderer.domElement;
      canvas.style = {} as any;
      arena.resize(3840, 2160);
      expect(arena.camera.aspect).toBeCloseTo(16 / 9);
      expect(canvas.style.width).toBe('3840px');
      expect(canvas.style.height).toBe('2160px');
      const [w, h, ratio] = sizes[0];
      expect(Math.floor(w * ratio) * Math.floor(h * ratio)).toBeLessThanOrEqual(COURT_PIXEL_BUDGET);
      arena.resize(3840, 2160);
      arena.resize(0, 0);
      expect(sizes).toHaveLength(1);
      arena.resize(320, 390);
      expect(sizes).toHaveLength(2);
      expect(arena.camera.aspect).toBeCloseTo(320 / 390);
    } finally { arena.destroy(); }
  });
});
