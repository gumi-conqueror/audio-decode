import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('../', import.meta.url);
const capture = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
const tool = capture('wasm-pack', ['--version']);
if (tool !== 'wasm-pack 0.14.0') throw new Error('Install wasm-pack 0.14.0 before building');
execFileSync(
  'wasm-pack',
  [
    'build',
    'crates/audio-decode-wasm',
    '--target',
    'web',
    '--out-dir',
    '../../pkg',
    '--out-name',
    'index',
    '--release',
    '--locked',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  },
);

const metadata = JSON.parse(
  capture('cargo', [
    'metadata',
    '--locked',
    '--format-version',
    '1',
    '--filter-platform',
    'wasm32-unknown-unknown',
  ]),
);
const binding = metadata.packages.find((item) => item.name === 'audio-decode-wasm');
const version = binding.version;
const manifest = {
  name: '@gumi-conqueror/audio-decode',
  version,
  description: 'Incremental Symphonia audio decoder with prebuilt WebAssembly',
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  exports: {
    '.': { types: './index.d.ts', import: './index.js' },
    './index_bg.wasm': './index_bg.wasm',
    './build-info.json': './build-info.json',
    './THIRD_PARTY_NOTICES.txt': './THIRD_PARTY_NOTICES.txt',
  },
  files: [
    'index.js',
    'index.d.ts',
    'index_bg.wasm',
    'index_bg.wasm.d.ts',
    'build-info.json',
    'THIRD_PARTY_NOTICES.txt',
    'LICENSE',
    'README.md',
    'docs/CI.md',
  ],
  license: 'MIT',
  sideEffects: false,
  repository: { type: 'git', url: 'git+https://github.com/gumi-conqueror/audio-decode.git' },
};
writeFileSync(new URL('pkg/package.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(new URL('LICENSE', root), new URL('pkg/LICENSE', root));
copyFileSync(new URL('README.md', root), new URL('pkg/README.md', root));
mkdirSync(new URL('pkg/docs/', root), { recursive: true });
copyFileSync(new URL('docs/CI.md', root), new URL('pkg/docs/CI.md', root));

// Cargo metadata remains the dependency inventory. Notices are generated release files.
let notices =
  'This package contains MIT wrapper code and third-party software.\n' +
  'The following entries include runtime and build dependencies of this locked WASM build.\n' +
  'MPL-covered source is available at each exact-version source URL below.\n';
for (const dependency of metadata.packages
  .filter((item) => item.source)
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const directory = dirname(dependency.manifest_path);
  const names = readdirSync(directory).filter((name) => /^(LICENSE|COPYING)([-_.]|$)/i.test(name));
  if (dependency.license_file && !names.includes(dependency.license_file))
    names.push(dependency.license_file);
  if (!names.length) throw new Error(`No license text found for ${dependency.name}`);
  notices +=
    `\n\n${dependency.name} ${dependency.version}\nLicense: ${dependency.license ?? 'see text'}\n` +
    `Source: https://crates.io/api/v1/crates/${dependency.name}/${dependency.version}/download\n`;
  for (const name of names.sort())
    notices += `\n${name}\n${readFileSync(join(directory, name), 'utf8')}\n`;
}
writeFileSync(new URL('pkg/THIRD_PARTY_NOTICES.txt', root), notices);
let commit = null;
try {
  commit = capture('git', ['rev-parse', '--verify', 'HEAD']);
} catch {
  /* Initial local checkout. */
}
const changes = capture('git', ['status', '--porcelain']);
if (process.env.GITHUB_ACTIONS === 'true' && changes) {
  throw new Error(`CI build changed the source checkout:\n${changes}`);
}
const info = {
  version,
  commit,
  dirty: changes.length > 0,
  profile: 'release',
  target: 'wasm32-unknown-unknown',
  rustc: capture('rustc', ['--version']),
  wasmPack: tool,
  wasmBindgen: metadata.packages.find((item) => item.name === 'wasm-bindgen').version,
  lockSha256: createHash('sha256')
    .update(readFileSync(new URL('Cargo.lock', root)))
    .digest('hex'),
};
writeFileSync(new URL('pkg/build-info.json', root), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Prepared ${manifest.name}@${version}`);
