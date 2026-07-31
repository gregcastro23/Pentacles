/**
 * PENTACLES - RAW POSTGRESQL HIPPARCOS CATALOG INGESTION SCRIPT
 *
 * Ingests equatorial astronomical datasets (RA, Dec, Distance in Parsecs),
 * converts coordinates to 3D Cartesian vectors (X, Y, Z), and builds
 * the GIST-indexed PostgreSQL cube extension table for zero-latency volumetric queries.
 *
 * Math Pipeline:
 *   X = r * cos(Dec) * cos(RA)
 *   Y = r * cos(Dec) * sin(RA)
 *   Z = r * sin(Dec)
 */

export const PG_MIGRATION_SQL = `
-- Enable 3D bounding box spatial queries
CREATE EXTENSION IF NOT EXISTS cube;

CREATE TABLE IF NOT EXISTS stars (
    star_id BIGSERIAL PRIMARY KEY,
    hipparcos_id INT UNIQUE,
    right_ascension FLOAT8 NOT NULL, -- RA in radians
    declination FLOAT8 NOT NULL,     -- Dec in radians
    distance_pc FLOAT8 NOT NULL,     -- Distance (r) in parsecs
    apparent_mag FLOAT4,
    spectral_type VARCHAR(10),
    coords cube                      -- 3D Cartesian representation (x, y, z)
);

-- Index for ultra-fast 3D bounding box queries
CREATE INDEX IF NOT EXISTS stars_coords_idx ON stars USING gist (coords);
`;

export function raDecDistToCartesian(raRad: number, decRad: number, distPc: number) {
  const x = distPc * Math.cos(decRad) * Math.cos(raRad);
  const y = distPc * Math.cos(decRad) * Math.sin(raRad);
  const z = distPc * Math.sin(decRad);
  return { x, y, z };
}

export function buildCubeSqlInsert(
  hipparcosId: number,
  raRad: number,
  decRad: number,
  distPc: number,
  appMag: number,
  spectralType: string
) {
  const { x, y, z } = raDecDistToCartesian(raRad, decRad, distPc);

  return {
    query: `
      INSERT INTO stars (hipparcos_id, right_ascension, declination, distance_pc, apparent_mag, spectral_type, coords)
      VALUES ($1, $2, $3, $4, $5, $6, cube(ARRAY[$7, $8, $9]))
      ON CONFLICT (hipparcos_id) DO UPDATE SET
        distance_pc = EXCLUDED.distance_pc,
        apparent_mag = EXCLUDED.apparent_mag,
        coords = EXCLUDED.coords;
    `,
    params: [hipparcosId, raRad, decRad, distPc, appMag, spectralType, x, y, z]
  };
}

console.log("✨ Pentacles Hipparcos Catalog Ingestion & Cartesian Math Pipeline Loaded.");
