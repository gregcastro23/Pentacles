import cv2
import numpy as np
from PIL import Image

def make_cosmic_six():
    # 1. Load original scan
    orig = Image.open('scratch/pents06_original.jpg').convert('RGB')
    orig_arr = np.array(orig)
    
    # Inner card frame from original: [58:1816, 46:1054]
    card_orig = orig_arr[58:1816, 46:1054]
    ch, cw, _ = card_orig.shape # 1758 x 1008
    
    # Target frame size inside an 848x1264 card (798 x 1205)
    target_w, target_h = 798, 1205
    card_resized = cv2.resize(card_orig, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    
    # Load cosmic nebula
    nebula = Image.open('scratch/cosmic_nebula_bg.jpg').convert('RGB')
    nebula_resized = cv2.resize(np.array(nebula), (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    
    c_rgb = card_resized.astype(np.float32) / 255.0
    n_rgb = nebula_resized.astype(np.float32) / 255.0
    
    sx = target_w / cw
    sy = target_h / ch
    
    # Centers of the 6 pentacles
    orig_centers = [
        (136, 188), (507, 191), (878, 193),
        (133, 453), (884, 458),
        (133, 722)
    ]
    p_centers = [(int(cx * sx), int(cy * sy)) for cx, cy in orig_centers]
    p_radius = int(88 * sx)
    
    lum = 0.299 * c_rgb[:,:,0] + 0.587 * c_rgb[:,:,1] + 0.114 * c_rgb[:,:,2]
    y_coords, x_coords = np.mgrid[0:target_h, 0:target_w]
    horizon_y = int(1395 * sy)
    
    # Precise sky separation:
    # Original sky paper has low saturation, high lum, and is above the horizon wall
    max_c = np.max(c_rgb, axis=2)
    min_c = np.min(c_rgb, axis=2)
    sat = (max_c - min_c) / (max_c + 1e-5)
    
    # Mask of figures
    # Merchant hat / coat: red/maroon
    is_red = (c_rgb[:,:,0] > c_rgb[:,:,1] * 1.15) & (c_rgb[:,:,0] > 0.35)
    # Scales: dark metal lines
    is_dark = lum < 0.36
    # Blue tunic
    is_blue = (c_rgb[:,:,2] > c_rgb[:,:,0] * 1.05) & (c_rgb[:,:,2] > c_rgb[:,:,1] * 0.95)
    # Ground/wall
    is_ground = y_coords >= horizon_y
    
    # Sky is paper area above horizon, excluding pentacles and figures
    is_paper = (sat < 0.18) & (lum > 0.48) & (~is_red) & (~is_dark) & (~is_blue) & (~is_ground)
    
    sky_mask = is_paper.astype(np.float32)
    
    # Exclude pentacles from sky mask with clean margin
    for cx, cy in p_centers:
        dist = np.sqrt((x_coords - cx)**2 + (y_coords - cy)**2)
        p_mask = np.clip((dist - (p_radius + 5)) / 7.0, 0.0, 1.0)
        sky_mask *= p_mask
        
    # Exclude top center "VI" numeral
    vi_x = int(507 * sx)
    vi_y = int(45 * sy)
    vi_dist = np.sqrt(((x_coords - vi_x)/1.8)**2 + (y_coords - vi_y)**2)
    vi_mask = np.clip((vi_dist - 28.0) / 8.0, 0.0, 1.0)
    sky_mask *= vi_mask
    
    # Smooth sky mask gently to preserve sharp character silhouettes
    sky_mask = cv2.GaussianBlur(sky_mask, (5, 5), 1.2)
    sky_mask_3d = np.repeat(sky_mask[:, :, np.newaxis], 3, axis=2)
    
    # Cosmic sky composition:
    # Deep indigo nebula with rich cosmic purple and dark space navy
    cosmic_sky = n_rgb * 1.15
    np.random.seed(108)
    stars = np.random.rand(target_h, target_w)
    star_points = (stars > 0.995) & (sky_mask > 0.4)
    cosmic_sky[star_points] = np.array([1.0, 0.97, 0.85], dtype=np.float32)
    
    # Brighter sparkling stars with soft 4-point diffraction spikes
    bright_stars = np.where((stars > 0.9991) & (sky_mask > 0.6))
    for sy_pt, sx_pt in zip(bright_stars[0], bright_stars[1]):
        for dist in range(1, 4):
            for ddy, ddx in [(-dist, 0), (dist, 0), (0, -dist), (0, dist)]:
                py, px = sy_pt + ddy, sx_pt + ddx
                if 0 <= py < target_h and 0 <= px < target_w:
                    cosmic_sky[py, px] = np.clip(cosmic_sky[py, px] + (4 - dist)*0.18, 0, 1)

    # 2. Smoothly Enrich Figures & Ground (no hard threshold lines!)
    c_enhanced = c_rgb.copy()
    
    # Crimson cloak: rich velvet crimson
    red_weight = np.clip((c_rgb[:,:,0] - np.maximum(c_rgb[:,:,1], c_rgb[:,:,2])) / 0.15, 0, 1) * np.clip(c_rgb[:,:,0] / 0.4, 0, 1)
    c_enhanced[:,:,0] = np.clip(c_enhanced[:,:,0] * (1.0 + 0.35 * red_weight), 0, 1)
    c_enhanced[:,:,1] = np.clip(c_enhanced[:,:,1] * (1.0 - 0.18 * red_weight), 0, 1)
    c_enhanced[:,:,2] = np.clip(c_enhanced[:,:,2] * (1.0 - 0.08 * red_weight), 0, 1)
    
    # Blue garments: celestial sapphire / lapis lazuli (smooth weight, no horizontal line!)
    blue_weight = np.clip((c_rgb[:,:,2] - c_rgb[:,:,0]) / 0.08, 0, 1) * np.clip((y_coords - 250) / 100, 0, 1)
    c_enhanced[:,:,0] = np.clip(c_enhanced[:,:,0] * (1.0 - 0.25 * blue_weight), 0, 1)
    c_enhanced[:,:,1] = np.clip(c_enhanced[:,:,1] * (1.0 - 0.05 * blue_weight), 0, 1)
    c_enhanced[:,:,2] = np.clip(c_enhanced[:,:,2] * (1.0 + 0.40 * blue_weight), 0, 1)
    
    # Warm golden lighting on beggar's robe
    tan_weight = np.clip((c_rgb[:,:,0] - c_rgb[:,:,2]) / 0.12, 0, 1) * np.clip((c_rgb[:,:,1] - c_rgb[:,:,2]) / 0.10, 0, 1) * np.clip((350 - x_coords) / 100, 0, 1) * np.clip((y_coords - 700) / 100, 0, 1)
    c_enhanced[:,:,0] = np.clip(c_enhanced[:,:,0] * (1.0 + 0.15 * tan_weight), 0, 1)
    c_enhanced[:,:,1] = np.clip(c_enhanced[:,:,1] * (1.0 + 0.08 * tan_weight), 0, 1)
    c_enhanced[:,:,2] = np.clip(c_enhanced[:,:,2] * (1.0 - 0.20 * tan_weight), 0, 1)
    
    # Ground pavement: warm cobblestone earth tone under starlight
    ground_weight = np.clip((y_coords - horizon_y) / 40.0, 0, 1) * np.clip((lum - 0.35) / 0.25, 0, 1) * (1.0 - red_weight) * (1.0 - blue_weight) * (1.0 - tan_weight)
    c_enhanced[:,:,0] = np.clip(c_enhanced[:,:,0] * (1.0 - 0.08 * ground_weight) + 0.02 * ground_weight, 0, 1)
    c_enhanced[:,:,1] = np.clip(c_enhanced[:,:,1] * (1.0 - 0.06 * ground_weight) + 0.02 * ground_weight, 0, 1)
    c_enhanced[:,:,2] = np.clip(c_enhanced[:,:,2] * (1.0 + 0.12 * ground_weight) + 0.04 * ground_weight, 0, 1)
    
    # Composite sky with figures
    composite = c_enhanced * (1.0 - sky_mask_3d) + cosmic_sky * sky_mask_3d
    
    # Re-apply PCS ink lines in sky area crisply
    for i in range(3):
        composite[:,:,i] = np.minimum(composite[:,:,i], np.clip(c_rgb[:,:,i] * 1.05 + 0.05, 0, 1))

    # 3. Authentic Glowing Golden Pentacles with Cosmic Geometry
    # We keep Pamela Colman Smith's exact hand-drawn lines, but infuse the discs with radiant gold
    for cx, cy in p_centers:
        dist = np.sqrt((x_coords - cx)**2 + (y_coords - cy)**2)
        inside = dist <= p_radius
        
        # Golden celestial halo radiating outward
        glow_r = int(p_radius * 1.7)
        gx1, gy1 = max(0, cx - glow_r), max(0, cy - glow_r)
        gx2, gy2 = min(target_w, cx + glow_r), min(target_h, cy + glow_r)
        gy_grid, gx_grid = np.mgrid[gy1:gy2, gx1:gx2]
        g_dist = np.sqrt((gx_grid - cx)**2 + (gy_grid - cy)**2)
        glow_val = np.clip(1.0 - g_dist / glow_r, 0.0, 1.0) ** 2.2 * 0.45
        for c_idx, val in enumerate([1.0, 0.88, 0.40]):
            composite[gy1:gy2, gx1:gx2, c_idx] = np.clip(
                composite[gy1:gy2, gx1:gx2, c_idx] + glow_val * val, 0.0, 1.0
            )
            
        # Inside disc: rich golden gradient and warm luminance
        norm_dist = np.clip(dist / p_radius, 0.0, 1.0)
        gold_r = 1.0 - 0.10 * norm_dist
        gold_g = 0.86 - 0.18 * norm_dist
        gold_b = 0.30 - 0.16 * norm_dist
        
        center_glow = np.clip(1.0 - dist / (p_radius * 0.65), 0.0, 1.0) ** 1.6 * 0.28
        
        # Dark ink preservation
        p_lum = lum[inside]
        ink_inside = np.clip((0.36 - p_lum) / 0.24, 0.0, 1.0)
        
        for c_idx, g_channel in enumerate([gold_r, gold_g, gold_b]):
            cur = composite[inside, c_idx]
            gold_color = np.clip(g_channel[inside] + center_glow[inside], 0, 1)
            composite[inside, c_idx] = gold_color * (1.0 - ink_inside) + cur * ink_inside

    # 4. Brass Scales Golden Gleam
    scale_cx, scale_cy = int(660 * sx), int(530 * sy)
    scale_r = int(140 * sx)
    sy1, sy2 = max(0, scale_cy - scale_r), min(target_h, scale_cy + scale_r)
    sx1, sx2 = max(0, scale_cx - scale_r), min(target_w, scale_cx + scale_r)
    s_ygrid, s_xgrid = np.mgrid[sy1:sy2, sx1:sx2]
    scale_dist = np.sqrt(((s_xgrid - scale_cx)*1.1)**2 + (s_ygrid - scale_cy)**2)
    scale_glow = np.clip(1.0 - scale_dist / scale_r, 0.0, 1.0) ** 2.2 * 0.35
    for c_idx, val in enumerate([1.0, 0.88, 0.45]):
        composite[sy1:sy2, sx1:sx2, c_idx] = np.clip(
            composite[sy1:sy2, sx1:sx2, c_idx] + scale_glow * val, 0.0, 1.0
        )
        
    # 5. Shower of Luminous Starlight Coins Falling to Petitioner
    drop_cx, drop_cy = int(245 * sx), int(720 * sy)
    drop_h = int(200 * sy)
    drop_w = int(90 * sx)
    dy1, dy2 = max(0, drop_cy - drop_h//2), min(target_h, drop_cy + drop_h//2)
    dx1, dx2 = max(0, drop_cx - drop_w//2), min(target_w, drop_cx + drop_w//2)
    d_ygrid, d_xgrid = np.mgrid[dy1:dy2, dx1:dx2]
    d_dist = np.sqrt(((d_xgrid - drop_cx)*2.2)**2 + (d_ygrid - drop_cy)**2)
    drop_glow = np.clip(1.0 - d_dist / (drop_h//2), 0.0, 1.0) ** 1.8 * 0.45
    for c_idx, val in enumerate([1.0, 0.90, 0.50]):
        composite[dy1:dy2, dx1:dx2, c_idx] = np.clip(
            composite[dy1:dy2, dx1:dx2, c_idx] + drop_glow * val, 0.0, 1.0
        )
        
    # 5 distinct sparkling golden starlight coins with celestial glints
    coin_pts = [(240*sx, 640*sy), (242*sx, 675*sy), (248*sx, 715*sy), (252*sx, 755*sy), (255*sx, 790*sy)]
    for f_x, f_y in coin_pts:
        fc_dist = np.sqrt((x_coords - f_x)**2 + (y_coords - f_y)**2)
        fc_mask = fc_dist <= 7.0 * sx
        fc_glow = np.clip(1.0 - fc_dist / (16.0 * sx), 0, 1) ** 2.0 * 0.6
        composite[:,:,0] = np.clip(composite[:,:,0] + fc_glow * 1.0, 0, 1)
        composite[:,:,1] = np.clip(composite[:,:,1] + fc_glow * 0.9, 0, 1)
        composite[:,:,2] = np.clip(composite[:,:,2] + fc_glow * 0.4, 0, 1)
        composite[fc_mask, :] = np.array([1.0, 0.92, 0.45], dtype=np.float32)
        glint_mask = fc_dist <= 3.0 * sx
        composite[glint_mask, :] = np.array([1.0, 1.0, 0.95], dtype=np.float32)

    # 6. Roman Numeral "VI" with Celestial Halo
    vi_x = int(507 * sx)
    vi_y = int(45 * sy)
    vi_gdist = np.sqrt(((x_coords - vi_x)/1.6)**2 + (y_coords - vi_y)**2)
    vi_halo = np.clip(1.0 - vi_gdist / 40.0, 0.0, 1.0) ** 2.0 * 0.35
    for c_idx, val in enumerate([1.0, 0.88, 0.45]):
        composite[:, :, c_idx] = np.clip(composite[:, :, c_idx] + vi_halo * val, 0, 1)

    # 7. Parchment Border and Frame (848x1264)
    ace = Image.open('public/assets/cards/minor/pentacles/01-ace.jpg').convert('RGB')
    final_card = np.array(ace).astype(np.float32) / 255.0
    bx, by = 25, 28
    final_card[by:by+target_h, bx:bx+target_w] = composite
    
    # Inner black frame line
    line_col = np.array([22.0/255.0, 20.0/255.0, 24.0/255.0], dtype=np.float32)
    final_card[by:by+3, bx:bx+target_w] = line_col
    final_card[by+target_h-3:by+target_h, bx:bx+target_w] = line_col
    final_card[by:by+target_h, bx:bx+3] = line_col
    final_card[by:by+target_h, bx+target_w-3:bx+target_w] = line_col
    
    out_img = Image.fromarray((np.clip(final_card, 0.0, 1.0) * 255.0).astype(np.uint8))
    out_img.save('public/assets/cards/minor/pentacles/06-six.jpg', quality=96)
    print('Saved to public/assets/cards/minor/pentacles/06-six.jpg successfully!')

if __name__ == '__main__':
    make_cosmic_six()
