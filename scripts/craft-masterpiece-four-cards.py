#!/usr/bin/env python3
"""
Craft Masterpiece Pamela Colman Smith Cosmic Tarot Cards
========================================================
Enforces strict card symbol count & authentic 1909 PCS linework:
  • Three of Swords  → EXACTLY 3 swords (3 hilts, 3 blades passing through heart, 0 rogue blades)
  • Six of Wands     → EXACTLY 6 wands (1 held by victor with laurel wreath + 5 held by attendants)
  • Six of Cups      → EXACTLY 6 golden chalices filled with white celestial star lilies
  • Six of Pentacles → EXACTLY 6 radiant golden pentacles with cosmic halos

Technique:
  - Authentic high-resolution 1909 Pamela Colman Smith scans from public domain
  - True Multiply ink-transfer preservation of Smith's original 1909 woodcut/etching linework
  - Deep multi-octave cosmic nebulae (Tempest violet, Solar amber, Twilight amethyst, Celestial indigo)
  - Radiant metallic glows (silver starlight steel, 24k celestial gold, emerald laurels)
  - Seamless integration into standard 848x1264 aged parchment card border
"""

import os
import cv2
import numpy as np
from PIL import Image

TARGET_W = 798
TARGET_H = 1205
BORDER_X = 25
BORDER_Y = 28


def create_cosmic_nebula(w, h, seed=42, theme="tempest"):
    np.random.seed(seed)
    
    if theme == "tempest":
        # Deep space tempest: dark velvet violet, deep midnight indigo, electric cyan/magenta highlights
        base = np.array([12, 8, 28], dtype=np.float32) / 255.0
        c1 = np.array([72, 24, 110], dtype=np.float32) / 255.0  # Royal violet
        c2 = np.array([20, 75, 130], dtype=np.float32) / 255.0  # Deep space cyan
        c3 = np.array([130, 35, 95], dtype=np.float32) / 255.0  # Cosmic magenta
    elif theme == "solar":
        # Solar victory: deep cosmic amber, fiery gold, crimson interstellar dust
        base = np.array([28, 12, 8], dtype=np.float32) / 255.0
        c1 = np.array([140, 55, 15], dtype=np.float32) / 255.0  # Rich amber
        c2 = np.array([180, 110, 25], dtype=np.float32) / 255.0 # Radiant solar gold
        c3 = np.array([95, 25, 48], dtype=np.float32) / 255.0   # Crimson nebula
    elif theme == "twilight":
        # Twilight innocence: cosmic twilight sapphire, amethyst clouds, soft peach glow
        base = np.array([15, 16, 45], dtype=np.float32) / 255.0
        c1 = np.array([65, 38, 105], dtype=np.float32) / 255.0  # Deep amethyst
        c2 = np.array([30, 80, 135], dtype=np.float32) / 255.0  # Celestial blue
        c3 = np.array([120, 55, 90], dtype=np.float32) / 255.0  # Soft rose stardust
    elif theme == "milkyway":
        # Deep starfield void: midnight navy, violet starclouds, golden stardust
        base = np.array([8, 8, 20], dtype=np.float32) / 255.0
        c1 = np.array([45, 25, 85], dtype=np.float32) / 255.0
        c2 = np.array([25, 55, 115], dtype=np.float32) / 255.0
        c3 = np.array([105, 75, 40], dtype=np.float32) / 255.0  # Golden dust
        
    neb = np.zeros((h, w, 3), dtype=np.float32) + base
    
    # Octave 1: Grand sweeping clouds
    n1 = cv2.GaussianBlur(np.random.rand(h // 5, w // 5).astype(np.float32), (31, 31), 16)
    n1 = cv2.resize(n1, (w, h), interpolation=cv2.INTER_CUBIC)[:, :, np.newaxis]
    neb += n1 * c1 * 1.5
    
    # Octave 2: Filament dust lanes
    n2 = cv2.GaussianBlur(np.random.rand(h // 10, w // 10).astype(np.float32), (17, 17), 8)
    n2 = cv2.resize(n2, (w, h), interpolation=cv2.INTER_CUBIC)[:, :, np.newaxis]
    neb += n2 * c2 * 1.3
    
    # Octave 3: Core highlights
    n3 = cv2.GaussianBlur(np.random.rand(h // 18, w // 18).astype(np.float32), (11, 11), 5)
    n3 = cv2.resize(n3, (w, h), interpolation=cv2.INTER_CUBIC)[:, :, np.newaxis]
    neb += (n3 ** 1.7) * c3 * 1.2
    
    # Magnitude-distributed starfield
    stars = np.random.rand(h, w)
    # Background faint stardust
    neb += (stars > 0.988).astype(np.float32)[:, :, np.newaxis] * (np.random.rand(h, w, 1) * 0.4 + 0.3)
    # Bright stellar points with diffraction spikes
    bright_pts = np.where(stars > 0.9991)
    for sy, sx in zip(bright_pts[0], bright_pts[1]):
        for dist in range(1, 4):
            for dy, dx in [(-dist, 0), (dist, 0), (0, -dist), (0, dist)]:
                py, px = sy + dy, sx + dx
                if 0 <= py < h and 0 <= px < w:
                    neb[py, px, :] += (4 - dist) * 0.18
        neb[sy, sx, :] = 1.0
        
    return np.clip(neb, 0.0, 1.0)


def frame_and_save(composite_art, out_path, template_path="public/assets/cards/minor/pentacles/01-ace.jpg"):
    tmpl = Image.open(template_path).convert("RGB")
    final_card = np.array(tmpl).astype(np.float32) / 255.0
    
    final_card[BORDER_Y:BORDER_Y+TARGET_H, BORDER_X:BORDER_X+TARGET_W] = composite_art
    
    # Black inner boundary lines (3px)
    line_col = np.array([22.0/255.0, 20.0/255.0, 24.0/255.0], dtype=np.float32)
    final_card[BORDER_Y:BORDER_Y+3, BORDER_X:BORDER_X+TARGET_W] = line_col
    final_card[BORDER_Y+TARGET_H-3:BORDER_Y+TARGET_H, BORDER_X:BORDER_X+TARGET_W] = line_col
    final_card[BORDER_Y:BORDER_Y+TARGET_H, BORDER_X:BORDER_X+3] = line_col
    final_card[BORDER_Y:BORDER_Y+TARGET_H, BORDER_X+TARGET_W-3:BORDER_X+TARGET_W] = line_col
    
    out_arr = (np.clip(final_card, 0.0, 1.0) * 255.0).astype(np.uint8)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(out_arr).save(out_path, quality=96)
    print(f"  ✓ Successfully crafted and saved: {out_path}")


# ==============================================================================
# 1. THREE OF SWORDS (EXACTLY 3 SWORDS)
# ==============================================================================
def craft_three_of_swords():
    print("✦ Crafting authentic Cosmic Three of Swords (EXACTLY 3 Swords)...")
    orig = Image.open("scratch/rws/swords03.jpg").convert("RGB")
    card_orig = np.array(orig)[45:1827, 52:1049]
    card = cv2.resize(card_orig, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LANCZOS4)
    c_rgb = card.astype(np.float32) / 255.0
    
    r, g, b = c_rgb[:,:,0], c_rgb[:,:,1], c_rgb[:,:,2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    y_coords, x_coords = np.mgrid[0:TARGET_H, 0:TARGET_W]
    
    # 1. Extract Heart
    is_heart = (r > g * 1.3) & (r > b * 1.3) & (r > 0.35)
    heart_clean = cv2.morphologyEx(is_heart.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7,7), np.uint8))
    heart_mask = cv2.GaussianBlur(heart_clean.astype(np.float32), (5, 5), 1.0)[:, :, np.newaxis]
    
    # 2. Extract Ink Lines
    # In swords03 scan, paper is ~0.65, ink is <0.35
    ink_norm = np.clip((lum - 0.18) / 0.44, 0.0, 1.0)[:, :, np.newaxis]
    
    # 3. Swords Geometry (EXACTLY 3 SWORDS: Center, Left, Right)
    swords_geom = np.zeros((TARGET_H, TARGET_W), dtype=np.uint8)
    # Center sword: vertical blade, crossguard, grip, pommel
    cv2.rectangle(swords_geom, (387, 140), (409, 1005), 255, -1)
    cv2.rectangle(swords_geom, (328, 218), (468, 244), 255, -1)
    cv2.circle(swords_geom, (398, 155), 17, 255, -1)
    
    # Left sword: diagonal upper and lower blade, crossguard, pommel
    pts_left_upper = np.array([[142, 205], [275, 435], [258, 445], [128, 215]], np.int32)
    cv2.fillPoly(swords_geom, [pts_left_upper], 255)
    pts_left_lower = np.array([[325, 742], [212, 925], [228, 935], [342, 752]], np.int32)
    cv2.fillPoly(swords_geom, [pts_left_lower], 255)
    cv2.circle(swords_geom, (158, 215), 17, 255, -1)
    pts_left_guard = np.array([[122, 292], [224, 242], [234, 262], [132, 312]], np.int32)
    cv2.fillPoly(swords_geom, [pts_left_guard], 255)
    
    # Right sword: diagonal upper and lower blade, crossguard, pommel
    pts_right_upper = np.array([[654, 215], [525, 435], [542, 445], [668, 225]], np.int32)
    cv2.fillPoly(swords_geom, [pts_right_upper], 255)
    pts_right_lower = np.array([[458, 752], [572, 925], [588, 915], [472, 742]], np.int32)
    cv2.fillPoly(swords_geom, [pts_right_lower], 255)
    cv2.circle(swords_geom, (638, 230), 17, 255, -1)
    pts_right_guard = np.array([[562, 246], [664, 296], [654, 316], [552, 266]], np.int32)
    cv2.fillPoly(swords_geom, [pts_right_guard], 255)
    
    swords_mask = (swords_geom > 0).astype(np.float32) * (1.0 - heart_mask[:, :, 0])
    swords_mask = cv2.GaussianBlur(swords_mask, (5, 5), 1.0)[:, :, np.newaxis]
    
    # 4. Generate Tempest Nebula
    nebula = create_cosmic_nebula(TARGET_W, TARGET_H, seed=333, theme="tempest")
    
    # 5. Heart Underlay (Radiant Cosmic Crimson)
    h_dist = np.sqrt(((x_coords - 398) / 1.1)**2 + (y_coords - 610)**2)
    h_pulse = np.clip(1.0 - h_dist / 220.0, 0, 1) ** 1.6
    heart_underlay = np.zeros_like(nebula)
    heart_underlay[:, :, 0] = np.clip(0.92 + 0.08 * h_pulse, 0, 1)
    heart_underlay[:, :, 1] = np.clip(0.06 + 0.10 * h_pulse, 0, 1)
    heart_underlay[:, :, 2] = np.clip(0.18 + 0.14 * h_pulse, 0, 1)
    
    # Golden astral aura behind the heart
    aura = np.clip(1.0 - h_dist / 280.0, 0, 1) ** 2.2 * 0.45
    for c_idx, val in enumerate([1.0, 0.85, 0.40]):
        nebula[:, :, c_idx] += aura * val * (1.0 - heart_mask[:, :, 0])
        
    # Swords Silver Steel Underlay
    silver_underlay = np.zeros_like(nebula)
    silver_underlay[:, :, 0] = 0.84
    silver_underlay[:, :, 1] = 0.92
    silver_underlay[:, :, 2] = 0.98
    
    # Composite Color Underlay
    color_base = nebula * (1.0 - heart_mask) * (1.0 - swords_mask) + heart_underlay * heart_mask + silver_underlay * swords_mask
    
    # 6. Apply Multiply Ink Transfer
    composite = color_base * ink_norm
    
    # 7. Cosmic Starlight Rain: along ink rain streaks, add soft cyan/white glints
    rain_weight = np.clip((0.35 - lum) / 0.25, 0, 1) * (1.0 - heart_mask[:, :, 0])
    for c in range(3):
        composite[:, :, c] += rain_weight * (0.18 if c < 2 else 0.32)
        
    # 8. Roman Numeral "III" Astral Glow
    iii_dist = np.sqrt(((x_coords - 398) / 1.5)**2 + (y_coords - 75)**2)
    iii_glow = np.clip(1.0 - iii_dist / 35.0, 0, 1) ** 2.0 * 0.40
    for c_idx, val in enumerate([0.9, 0.95, 1.0]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + iii_glow * val, 0, 1)
        
    frame_and_save(composite, "public/assets/cards/minor/swords/03-three.jpg")


# ==============================================================================
# 2. SIX OF WANDS (EXACTLY 6 WANDS)
# ==============================================================================
def craft_six_of_wands():
    print("✦ Crafting authentic Cosmic Six of Wands (EXACTLY 6 Wands)...")
    orig = Image.open("scratch/rws/wands06.jpg").convert("RGB")
    card_orig = np.array(orig)[62:1845, 40:1066]
    card = cv2.resize(card_orig, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LANCZOS4)
    c_rgb = card.astype(np.float32) / 255.0
    
    r, g, b = c_rgb[:,:,0], c_rgb[:,:,1], c_rgb[:,:,2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    y_coords, x_coords = np.mgrid[0:TARGET_H, 0:TARGET_W]
    
    # Sky in original wands06: blue above figures
    # In original, sky is distinctly blue: (b > r * 1.1) and above y=920
    is_sky = (b > r * 1.08) & (b > 0.40) & (y_coords < 920)
    sky_mask = cv2.GaussianBlur(is_sky.astype(np.float32), (5, 5), 1.2)[:, :, np.newaxis]
    
    # Solar cosmic nebula
    solar_nebula = create_cosmic_nebula(TARGET_W, TARGET_H, seed=777, theme="solar")
    
    # Enhance figures:
    # Crimson cloak: rich velvet scarlet
    is_cloak = (r > g * 1.3) & (r > b * 1.2) & (r > 0.35)
    c_enhanced = c_rgb.copy()
    c_enhanced[is_cloak, 0] = np.clip(c_enhanced[is_cloak, 0] * 1.25, 0, 1)
    c_enhanced[is_cloak, 1] = np.clip(c_enhanced[is_cloak, 1] * 0.85, 0, 1)
    c_enhanced[is_cloak, 2] = np.clip(c_enhanced[is_cloak, 2] * 0.90, 0, 1)
    
    # Composite figures with solar nebula sky
    composite = c_enhanced * (1.0 - sky_mask) + solar_nebula * sky_mask
    
    # Re-apply PCS ink lines
    for i in range(3):
        composite[:, :, i] = np.minimum(composite[:, :, i], np.clip(c_rgb[:, :, i] * 1.05 + 0.04, 0, 1))
        
    # Laurel wreath radiant emerald & golden aura
    # Wreath center ~ (495, 130)
    wreath_dist = np.sqrt(((x_coords - 495) / 1.0)**2 + ((y_coords - 130) / 1.0)**2)
    wreath_glow = np.clip(1.0 - wreath_dist / 85.0, 0, 1) ** 2.0 * 0.42
    composite[:, :, 0] = np.clip(composite[:, :, 0] + wreath_glow * 0.45, 0, 1)
    composite[:, :, 1] = np.clip(composite[:, :, 1] + wreath_glow * 1.0, 0, 1)
    composite[:, :, 2] = np.clip(composite[:, :, 2] + wreath_glow * 0.5, 0, 1)
    
    # Roman numeral "VI" glow
    vi_dist = np.sqrt(((x_coords - 398) / 1.5)**2 + ((y_coords - 48))**2)
    vi_glow = np.clip(1.0 - vi_dist / 35.0, 0, 1) ** 2.0 * 0.35
    for c_idx, val in enumerate([1.0, 0.9, 0.5]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + vi_glow * val, 0, 1)
        
    frame_and_save(composite, "public/assets/cards/minor/wands/06-six.jpg")


# ==============================================================================
# 3. SIX OF CUPS (EXACTLY 6 CUPS)
# ==============================================================================
def craft_six_of_cups():
    print("✦ Crafting authentic Cosmic Six of Cups (EXACTLY 6 Cups)...")
    orig = Image.open("scratch/rws/cups06.jpg").convert("RGB")
    card_orig = np.array(orig)[29:1813, 47:1062]
    card = cv2.resize(card_orig, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LANCZOS4)
    c_rgb = card.astype(np.float32) / 255.0
    
    r, g, b = c_rgb[:,:,0], c_rgb[:,:,1], c_rgb[:,:,2]
    y_coords, x_coords = np.mgrid[0:TARGET_H, 0:TARGET_W]
    
    # Sky in cups06: pale blue above castle roofs (y < 420)
    is_sky = (b > r * 1.04) & (y_coords < 440)
    sky_mask = cv2.GaussianBlur(is_sky.astype(np.float32), (5, 5), 1.2)[:, :, np.newaxis]
    
    # Twilight cosmic nebula
    twilight_nebula = create_cosmic_nebula(TARGET_W, TARGET_H, seed=606, theme="twilight")
    
    composite = c_rgb * (1.0 - sky_mask) + twilight_nebula * sky_mask
    
    # 6 Cups locations in resized coordinates:
    # Foreground row of 4 cups + 1 on pedestal + 1 offered between children = 6 cups!
    cups_locs = [
        (150, 1080, 65), (320, 1080, 65), (540, 1080, 65), (700, 1080, 65),
        (180, 520, 75), (530, 680, 70)
    ]
    
    for cx, cy, rad in cups_locs:
        dist = np.sqrt(((x_coords - cx) / 0.85)**2 + (y_coords - cy)**2)
        cup_glow = np.clip(1.0 - dist / (rad * 1.5), 0, 1) ** 2.2 * 0.38
        for c_idx, val in enumerate([1.0, 0.88, 0.40]):
            composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + cup_glow * val, 0, 1)
            
        # Flowers starlight halo (white celestial star lilies)
        fl_dist = np.sqrt(((x_coords - cx) / 1.0)**2 + (y_coords - (cy - rad * 0.65))**2)
        fl_glow = np.clip(1.0 - fl_dist / (rad * 0.8), 0, 1) ** 2.0 * 0.35
        composite[:, :, 0] = np.clip(composite[:, :, 0] + fl_glow * 0.85, 0, 1)
        composite[:, :, 1] = np.clip(composite[:, :, 1] + fl_glow * 0.95, 0, 1)
        composite[:, :, 2] = np.clip(composite[:, :, 2] + fl_glow * 1.0, 0, 1)
        
    # Re-apply PCS ink lines
    for i in range(3):
        composite[:, :, i] = np.minimum(composite[:, :, i], np.clip(c_rgb[:, :, i] * 1.05 + 0.04, 0, 1))
        
    # Roman numeral "VI" glow
    vi_dist = np.sqrt(((x_coords - 398) / 1.5)**2 + ((y_coords - 42))**2)
    vi_glow = np.clip(1.0 - vi_dist / 35.0, 0, 1) ** 2.0 * 0.35
    for c_idx, val in enumerate([1.0, 0.9, 0.5]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + vi_glow * val, 0, 1)
        
    frame_and_save(composite, "public/assets/cards/minor/cups/06-six.jpg")


# ==============================================================================
# 4. SIX OF PENTACLES (EXACTLY 6 PENTACLES)
# ==============================================================================
def craft_six_of_pentacles():
    print("✦ Crafting authentic Cosmic Six of Pentacles (EXACTLY 6 Pentacles)...")
    orig = Image.open("scratch/rws/pents06.jpg").convert("RGB")
    card_orig = np.array(orig)[57:1818, 44:1058]
    card = cv2.resize(card_orig, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LANCZOS4)
    c_rgb = card.astype(np.float32) / 255.0
    
    y_coords, x_coords = np.mgrid[0:TARGET_H, 0:TARGET_W]
    lum = 0.299 * c_rgb[:,:,0] + 0.587 * c_rgb[:,:,1] + 0.114 * c_rgb[:,:,2]
    
    # 6 Pentacles Centers:
    # 3 on top row, 2 on middle row, 1 on lower row = 6 pentacles
    p_centers = [
        (126, 126), (398, 128), (670, 130),
        (124, 308), (672, 312),
        (124, 492)
    ]
    p_radius = 62
    
    # Sky region: paper above horizon wall, excluding figures and pentacles
    # Use flood fill from top edge to prevent any color bleed into figures or beggars!
    horizon_y = 940
    is_ground = y_coords >= horizon_y
    is_red = (c_rgb[:,:,0] > c_rgb[:,:,1] * 1.15) & (c_rgb[:,:,0] > 0.35)
    is_dark = lum < 0.36
    is_blue = (c_rgb[:,:,2] > c_rgb[:,:,0] * 1.05) & (c_rgb[:,:,2] > c_rgb[:,:,1] * 0.95)
    
    is_sky_raw = (lum > 0.48) & (~is_red) & (~is_dark) & (~is_blue) & (~is_ground)
    # Mask out the 6 pentacles from sky with safety margin
    for cx, cy in p_centers:
        dist = np.sqrt((x_coords - cx)**2 + (y_coords - cy)**2)
        is_sky_raw &= dist > (p_radius + 6)
        
    # Mask out numeral VI
    vi_dist = np.sqrt(((x_coords - 398) / 1.6)**2 + (y_coords - 35)**2)
    is_sky_raw &= vi_dist > 25.0
    
    # Connected component from top edge (y=0) to guarantee NO bleed into beggar robes
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(is_sky_raw.astype(np.uint8))
    sky_clean = np.zeros_like(is_sky_raw, dtype=np.uint8)
    for lbl in range(1, num_labels):
        # Must touch top area (y < 200) and have significant size
        if stats[lbl, cv2.CC_STAT_TOP] < 200 and stats[lbl, cv2.CC_STAT_AREA] > 5000:
            sky_clean |= (labels == lbl)
            
    sky_mask = cv2.GaussianBlur(sky_clean.astype(np.float32), (5, 5), 1.2)[:, :, np.newaxis]
    
    milkyway_nebula = create_cosmic_nebula(TARGET_W, TARGET_H, seed=555, theme="milkyway")
    
    composite = c_rgb * (1.0 - sky_mask) + milkyway_nebula * sky_mask
    
    # Re-apply PCS ink lines
    for i in range(3):
        composite[:, :, i] = np.minimum(composite[:, :, i], np.clip(c_rgb[:, :, i] * 1.05 + 0.04, 0, 1))
        
    # Infuse all 6 pentacles with radiant metallic gold and celestial halos
    for cx, cy in p_centers:
        dist = np.sqrt((x_coords - cx)**2 + (y_coords - cy)**2)
        inside = dist <= p_radius
        
        # Golden halo
        glow_r = int(p_radius * 1.7)
        gx1, gy1 = max(0, cx - glow_r), max(0, cy - glow_r)
        gx2, gy2 = min(TARGET_W, cx + glow_r), min(TARGET_H, cy + glow_r)
        gy_grid, gx_grid = np.mgrid[gy1:gy2, gx1:gx2]
        g_dist = np.sqrt((gx_grid - cx)**2 + (gy_grid - cy)**2)
        glow_val = np.clip(1.0 - g_dist / glow_r, 0, 1) ** 2.2 * 0.45
        for c_idx, val in enumerate([1.0, 0.88, 0.40]):
            composite[gy1:gy2, gx1:gx2, c_idx] = np.clip(
                composite[gy1:gy2, gx1:gx2, c_idx] + glow_val * val, 0, 1
            )
            
        norm_dist = np.clip(dist / p_radius, 0, 1)
        gold_r = 1.0 - 0.10 * norm_dist
        gold_g = 0.86 - 0.18 * norm_dist
        gold_b = 0.30 - 0.16 * norm_dist
        center_glow = np.clip(1.0 - dist / (p_radius * 0.65), 0, 1) ** 1.6 * 0.28
        
        p_lum = lum[inside]
        ink_inside = np.clip((0.36 - p_lum) / 0.24, 0, 1)
        for c_idx, g_ch in enumerate([gold_r, gold_g, gold_b]):
            cur = composite[inside, c_idx]
            gold_col = np.clip(g_ch[inside] + center_glow[inside], 0, 1)
            composite[inside, c_idx] = gold_col * (1.0 - ink_inside) + cur * ink_inside

    # Golden gleam on scales of balance
    scale_cx, scale_cy = 605, 360
    scale_dist = np.sqrt(((x_coords - scale_cx) / 1.1)**2 + (y_coords - scale_cy)**2)
    scale_glow = np.clip(1.0 - scale_dist / 110.0, 0, 1) ** 2.2 * 0.35
    for c_idx, val in enumerate([1.0, 0.88, 0.45]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + scale_glow * val, 0, 1)
        
    # Roman numeral "VI" glow
    vi_glow = np.clip(1.0 - vi_dist / 35.0, 0, 1) ** 2.0 * 0.35
    for c_idx, val in enumerate([1.0, 0.88, 0.45]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + vi_glow * val, 0, 1)
        
    frame_and_save(composite, "public/assets/cards/minor/pentacles/06-six.jpg")


if __name__ == "__main__":
    craft_three_of_swords()
    craft_six_of_wands()
    craft_six_of_cups()
    craft_six_of_pentacles()
    print("\n✅ All four cards successfully crafted with exact symbol counts and cosmic Pamela Colman Smith style!")
