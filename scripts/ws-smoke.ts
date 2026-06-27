// Headless end-to-end smoke test for the SpacetimeDB 2.x WebSocket transport.
// Connects to the LOCAL host, subscribes to zone + star_node, and validates that
// the real generated bindings + normalizeWsRow produce the snake_case shape the
// app's consumers expect. Run: bun run scratch/ws-smoke.ts
import { DbConnection } from '../src/module_bindings'
import { normalizeWsRow } from '../src/net/ws-normalize.js'

const URI = process.env.SMOKE_URI ?? 'http://127.0.0.1:3000'
const DB = process.env.SMOKE_DB ?? 'pentacleslocal'

const fail = (msg: string) => { console.error('❌ ' + msg); process.exit(1) }
const t = setTimeout(() => fail('timeout: no onApplied within 15s'), 15000)

let conn: any
conn = DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(DB)
  .onConnect((c: any, identity: any) => {
    console.log('✓ WS connected; identity =', identity?.toHexString?.().slice(0, 12) + '…')
    c.subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(t)
        const zones = [...c.db.zone.iter()].map(normalizeWsRow)
        const stars = [...c.db.star_node.iter()].map(normalizeWsRow)
        console.log(`✓ onApplied: zone=${zones.length} rows, star_node=${stars.length} rows`)

        // shape checks against a real decoded row
        const z = zones.find((r: any) => r.zone_id === 10) ?? zones[0]
        console.log('  sample zone row:', JSON.stringify(z))
        const s = stars[0]
        console.log('  sample star row:', JSON.stringify(s))

        const checks: Array<[string, boolean]> = [
          ['zone count == 11', zones.length === 11],
          ['star_node seeded (>= 512)', stars.length >= 512],
          ['zone row has snake_case zone_id', 'zone_id' in z],
          ['zone row has updated_at (camel→snake)', 'updated_at' in z],
          ['zone.owner is string|null (enum normalized)', z.owner === null || typeof z.owner === 'string'],
          ['star row has hip_id (camel→snake)', 'hip_id' in s],
          ['star row has held_by (camel→snake)', 'held_by' in s],
          ['star row has region_hint (camel→snake)', 'region_hint' in s],
          ['star.held_by is string|null', s.held_by === null || typeof s.held_by === 'string'],
          ['no camelCase leakage (hipId absent)', !('hipId' in s)],
        ]
        let ok = true
        for (const [name, pass] of checks) {
          console.log(`  ${pass ? '✓' : '✗'} ${name}`)
          if (!pass) ok = false
        }
        console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ SOME CHECKS FAILED')
        try { c.disconnect() } catch {}
        process.exit(ok ? 0 : 1)
      })
      .onError((ctx: any) => fail('subscription error: ' + (ctx?.event ?? 'unknown')))
      .subscribe(['SELECT * FROM zone', 'SELECT * FROM star_node'])
  })
  .onConnectError((_ctx: any, err: any) => fail('connect error: ' + (err?.message ?? err)))
  .build()
