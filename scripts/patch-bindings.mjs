#!/usr/bin/env node
// Post-`spacetime generate` patch for the SpacetimeDB 2.6.0 TypeScript codegen.
//
// BUG: codegen emits unit enums in the object form
//        export const Planet = __t.enum("Planet", { Sun: __t.unit(), ... });
//      which builds a `SumBuilderImpl` (no `.primaryKey()`), but then emits
//        get body() { return Planet.primaryKey(); }
//      for an enum-typed primary key (e.g. the `ephemeris.body: Planet` column).
//      `SumBuilderImpl.primaryKey` is undefined → the bindings THROW at runtime
//      when the table module is evaluated, crashing the client on load.
//
// FIX: convert every all-unit object-form enum to the array form
//        export const Planet = __t.enum("Planet", ["Sun","Moon",...]);
//      which builds a `SimpleSumBuilderImpl` that DOES expose `.primaryKey()`.
//      The resulting AlgebraicType is byte-identical (verified), so the wire
//      schema is unchanged and all other uses (option(Planet), variant
//      constructors) keep working.
//
// Idempotent. Run after every `spacetime generate`. See package.json `gen` script.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const typesPath = join(root, 'src/module_bindings/types.ts')

let src = readFileSync(typesPath, 'utf8')
let converted = []

// Match `__t.enum("Name", { ...body... })` (the object form only — array form has '[').
const enumRe = /__t\.enum\(\s*"([A-Za-z0-9_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g
src = src.replace(enumRe, (full, name, body) => {
  // Parse `Key: __t.unit(),` entries; bail if any variant carries a payload.
  const entries = [...body.matchAll(/([A-Za-z0-9_]+)\s*:\s*__t\.([A-Za-z0-9_]+)\([^)]*\)/g)]
  if (!entries.length) return full
  const allUnit = entries.every((m) => m[2] === 'unit')
  if (!allUnit) return full // payload-bearing sum — leave as object form
  const names = entries.map((m) => `"${m[1]}"`).join(', ')
  converted.push(`${name} (${entries.length} variants)`)
  return `__t.enum("${name}", [${names}])`
})

if (converted.length) {
  writeFileSync(typesPath, src)
  console.log(`patch-bindings: converted unit enums to array form → ${converted.join(', ')}`)
} else {
  console.log('patch-bindings: nothing to convert (already array form or no unit enums)')
}
