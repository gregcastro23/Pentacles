// ============================================================
// Pentacles — SpacetimeDB WebSocket row normalization
// ============================================================
// The SpacetimeDB 2.x SDK decodes a table row to camelCase keys with typed
// values: enums → { tag, value }, Option → { tag: 'some'|'none', value } (or the
// bare value/undefined), Identity/ConnectionId → class instances, Timestamp →
// instance, u64/u128 → bigint. Every consumer in this app (and the HTTP /sql
// path it mirrors) expects snake_case keys with plain values: enum → variant-name
// string, Option → value|null, identity → hex string, timestamp → micros number.
//
// `normalizeWsRow` bridges the two so the WebSocket subscription path is a drop-in
// behind the existing `subscribe(table, cb => rows)` interface. Kept free of any
// Vite/browser globals so it can be unit-tested headlessly (see scratch/ws-smoke).

export const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

export function normalizeWsRow(row) {
  const out = {}
  for (const k in row) out[camelToSnake(k)] = normalizeWsVal(row[k])
  return out
}

export function normalizeWsVal(v) {
  if (v == null) return null
  const t = typeof v
  if (t === 'bigint') return v.toString() // callers Number()-coerce; safe for u64/u128
  if (t === 'number' || t === 'string' || t === 'boolean') return v
  if (Array.isArray(v)) return v.map(normalizeWsVal)
  if (t === 'object') {
    // Identity / ConnectionId → hex string (matches what sameIdentity expects)
    if (typeof v.toHexString === 'function') return v.toHexString()
    if ('__identity__' in v) return identityFromBigInt(v.__identity__)
    // Timestamp → micros since epoch (number)
    if ('__timestamp_micros_since_unix_epoch__' in v) return Number(v.__timestamp_micros_since_unix_epoch__)
    if (typeof v.microsSinceUnixEpoch === 'bigint') return Number(v.microsSinceUnixEpoch)
    // Tagged enum / Option: { tag: 'Mars', value } | { tag: 'some'|'none', value }
    if ('tag' in v) {
      if (v.tag === 'none') return null
      if (v.tag === 'some') return normalizeWsVal(v.value)
      return v.tag // plain enum → variant-name string (e.g. "Mars")
    }
    // Nested product/struct → recurse
    return normalizeWsRow(v)
  }
  return v
}

export const identityFromBigInt = (b) => {
  try { return '0x' + BigInt(b).toString(16).padStart(64, '0') } catch { return String(b) }
}
