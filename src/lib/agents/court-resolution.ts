/** Bound framebuffer work independently of the display's CSS size and density. */
export const COURT_PIXEL_BUDGET = 2_000_000;
export type AvatarRenderQuality = 'balanced' | 'sharp';
export const SHARP_PIXEL_BUDGET = 4_000_000;

/** Sharp also supersamples low-density displays; both modes retain a hard cap. */
export function avatarPixelRatio(width: number, height: number, density: number,
  quality: AvatarRenderQuality, maxDimension = 8192): number {
  const dpr = Number.isFinite(density) && density > 0 ? density : 1;
  return courtPixelRatio(width, height, quality === 'sharp' ? Math.max(1.5, dpr) : dpr,
    quality === 'sharp' ? SHARP_PIXEL_BUDGET : COURT_PIXEL_BUDGET, maxDimension);
}

export function courtPixelRatio(width: number, height: number, density: number,
  pixelBudget = COURT_PIXEL_BUDGET, maxDimension = 8192): number {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return 1;
  const dpr = Number.isFinite(density) && density > 0 ? Math.min(density, 2) : 1;
  const budget = Number.isFinite(pixelBudget) && pixelBudget >= 1 ? pixelBudget : COURT_PIXEL_BUDGET;
  const limit = Number.isFinite(maxDimension) && maxDimension >= 1 ? maxDimension : 8192;
  return Math.min(dpr, Math.sqrt(budget / (width * height)), limit / width, limit / height);
}
