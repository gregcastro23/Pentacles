export interface NameplateAnchor { key: string; x: number; y: number; depth: number; selected: boolean }
export interface NameplatePlacement { key: string; x: number; y: number; width: number }

/** Screen-space labels: selection first, then near vessels; crowded labels defer to the roster. */
export function layoutCourtNameplates(anchors: NameplateAnchor[], width: number, height: number): NameplatePlacement[] {
  const plateWidth = Math.min(204, width - 24), plateHeight = 62;
  const top = 112, bottom = height - 112;
  if (plateWidth < 100 || bottom - top < plateHeight) return [];
  const placed: NameplatePlacement[] = [];
  for (const anchor of [...anchors].sort((a, b) => Number(b.selected) - Number(a.selected) || a.depth - b.depth || a.key.localeCompare(b.key))) {
    if (![anchor.x, anchor.y, anchor.depth].every(Number.isFinite) || anchor.depth < -1 || anchor.depth > 1
      || anchor.x < 0 || anchor.x > width || anchor.y < 0 || anchor.y > height) continue;
    const x = Math.max(12, Math.min(width - plateWidth - 12, anchor.x - plateWidth / 2));
    const preferred = anchor.y - plateHeight - 8;
    const y = Math.max(top, Math.min(bottom - plateHeight, preferred));
    if (placed.some(other => x < other.x + other.width + 8 && x + plateWidth + 8 > other.x
      && y < other.y + plateHeight + 8 && y + plateHeight + 8 > other.y)) continue;
    placed.push({ key: anchor.key, x, y, width: plateWidth });
  }
  return placed;
}
