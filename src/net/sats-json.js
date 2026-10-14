// ============================================================
// Pentacles — SATS-JSON decoding for the HTTP /sql endpoint
// ============================================================
// Pure (no network, no SDK) so tests can import it directly.

// ---- SQL response normalization --------------------------------------------
// SpacetimeDB's /sql returns an array of statement results. Across versions a
// result is `{ schema, rows }` where rows are positional arrays and column names
// live in schema.elements[].name (sometimes wrapped as {some:"x"}). We map each
// row to a {col: value} object, and pass through already-object rows untouched.
// SpacetimeDB /sql returns [{ schema, rows }]. Rows are positional arrays in SATS
// JSON: enums/Options encode as [tagIndex, payload] (e.g. owner [0,[1,[]]] =
// some(Moon); none = [1,[]]). We use the schema's AlgebraicType to decode each
// value: plain enums → variant name ("Mars"), Option → inner value or null,
// primitives → through (u64/u128 may be strings; callers coerce).
export function normalizeSqlResult(json) {
  const stmt = Array.isArray(json) ? json[json.length - 1] : json
  if (!stmt) return []
  const schema = stmt.schema || stmt.Schema
  const rows = stmt.rows || stmt.Rows || []
  if (!rows.length) return []
  const elements = schema?.elements || schema?.Elements || []
  const cols = elements.map((el, i) => elName(el, i))
  const types = elements.map((el) => el?.algebraic_type ?? el?.algebraicType)
  if (!Array.isArray(rows[0])) return rows // already objects (defensive)
  return rows.map((row) => {
    const obj = {}
    row.forEach((val, i) => {
      obj[cols[i] ?? `col${i}`] = decodeSats(types[i], val)
    })
    return obj
  })
}

function elName(el, i) {
  const n = el?.name ?? el?.Name
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') return n.some ?? n.Some ?? `col${i}`
  return `col${i}`
}

export function decodeSats(type, val) {
  if (!type) return val
  if (type.Sum) {
    const variants = type.Sum.variants || []
    if (!Array.isArray(val)) return val
    const [tag, payload] = val
    const variant = variants[tag]
    const vname = (variant && (variant.name?.some ?? variant.name)) ?? String(tag)
    const isOption = variants.length === 2 && variants.some((v) => (v?.name?.some ?? v?.name) === 'none')
    if (isOption) {
      if (vname === 'none') return null
      return decodeSats(variant?.algebraic_type ?? variant?.algebraicType, payload) // unwrap some
    }
    return vname // plain enum → variant name (e.g. "Mars", "House")
  }
  if (type.Array) {
    // Vec<T>: a JSON array of T, each decoded with the element type (e.g.
    // melee_result.seats → [{ seat_id, faction: "Mars", control_delta, … }]).
    return Array.isArray(val) ? val.map((v) => decodeSats(type.Array, v)) : val
  }
  if (type.Product) {
    const els = type.Product.elements || []
    if (Array.isArray(val)) {
      const o = {}
      els.forEach((e, i) => {
        o[elName(e, i)] = decodeSats(e?.algebraic_type ?? e?.algebraicType, val[i])
      })
      return o
    }
    return val
  }
  return val // primitives
}
