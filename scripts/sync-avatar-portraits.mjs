import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';

// Re-encode existing ASOL art, without generation, network or new dependencies.
// node scripts/sync-avatar-portraits.mjs /path/to/AlchmAgentsSolana
const source = process.argv[2] && resolve(process.argv[2]);
if (!source) throw new Error('Supply the local AlchmAgentsSolana checkout.');
const sharp = createRequire(join(source, 'package.json'))('sharp');
const root = fileURLToPath(new URL('../', import.meta.url));
const definitions = join(source, 'lib/agents/historical');
const references = new Map();
for (const file of await readdir(definitions)) {
  if (!file.endsWith('.ts')) continue;
  const text = await readFile(join(definitions, file), 'utf8');
  const id = text.match(/\bid:\s*['"]([^'"]+)/)?.[1];
  const avatar = text.match(/\bavatar:\s*['"]([^'"]+)/)?.[1];
  if (id && avatar && /^\/avatars\/[a-z0-9-]+\.png$/.test(avatar)) references.set(id, avatar);
}
const images = await Promise.all(HISTORICAL_AGENTS.map(async agent => {
  const avatar = references.get(agent.key);
  if (!avatar) throw new Error(`No portrait for ${agent.key}`);
  return { key: agent.key, avatar, bytes: await readFile(join(source, 'public', avatar)) };
}));
const output = join(root, 'public/avatars/historical');
await mkdir(output, { recursive: true });
const provenance = [];
for (const { key, avatar, bytes } of images) {
  const encoded = await sharp(bytes).webp({ quality: 82, effort: 6 }).toBuffer();
  await writeFile(join(output, `${key}.webp`), encoded);
  provenance.push({ key, source: `public/avatars/${basename(avatar)}`,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: encoded.length });
}
await writeFile(join(output, 'sources.json'), JSON.stringify({
  repository: 'https://github.com/gregcastro23/alchm-agents-solana',
  encoding: 'WebP quality 82, original dimensions, no crop', portraits: provenance,
}, null, 2) + '\n');
await writeFile(join(root, 'src/lib/agents/historical-portraits.ts'),
  '// Existing ASOL artwork. Rebuild with scripts/sync-avatar-portraits.mjs.\n' +
  'export const HISTORICAL_PORTRAITS: Readonly<Record<string, string>> = Object.freeze({\n' +
  images.map(({ key }) => `  '${key}': '/avatars/historical/${key}.webp',`).join('\n') + '\n});\n');
console.log(`Synced ${images.length} portraits: ${provenance.reduce((sum, p) => sum + p.bytes, 0)} bytes.`);
