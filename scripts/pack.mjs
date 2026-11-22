import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (!process.env.npm_execpath) throw new Error('Run this command through npm run package');
mkdirSync('release', { recursive: true });
const packed = JSON.parse(
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'pack',
      './pkg',
      '--pack-destination',
      'release',
      '--ignore-scripts',
      '--json',
    ],
    { encoding: 'utf8', windowsHide: true },
  ),
)[0];
const names = new Set(packed.files.map((file) => file.path));
for (const name of [
  'index.js',
  'index.d.ts',
  'index_bg.wasm',
  'build-info.json',
  'THIRD_PARTY_NOTICES.txt',
  'LICENSE',
]) {
  assert.ok(names.has(name), `Package must include ${name}`);
}
const filename = packed.filename;
const sha256 = createHash('sha256')
  .update(readFileSync(`release/${filename}`))
  .digest('hex');
writeFileSync('release/SHA256SUMS', `${sha256}  ${filename}\n`);
writeFileSync('release/build-info.json', readFileSync('pkg/build-info.json'));
console.log(`Packed ${filename} (${packed.size} bytes), SHA-256 ${sha256}`);
