import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { packageFilename } from './release.mjs';

if (!process.env.npm_execpath) throw new Error('Run this command through npm run test:browser');
const { version } = JSON.parse(readFileSync('release/build-info.json', 'utf8'));
const tarball = resolve(`release/${packageFilename(version)}`);
const tone = JSON.parse(readFileSync('tests/fixtures/tone.json', 'utf8'));
mkdirSync('test-artifacts', { recursive: true });
const consumer = mkdtempSync(resolve('test-artifacts/consumer-'));
writeFileSync(
  `${consumer}/package.json`,
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
execFileSync(
  process.execPath,
  [
    process.env.npm_execpath,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarball,
  ],
  { cwd: consumer, stdio: 'inherit', windowsHide: true },
);
mkdirSync(`${consumer}/public`);
copyFileSync('tests/fixtures/tone.flac', `${consumer}/public/tone.flac`);
writeFileSync(
  `${consumer}/index.html`,
  '<!doctype html><title>Decoder consumer test</title><script type="module" src="/main.js"></script>',
);
writeFileSync(
  `${consumer}/main.js`,
  `
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => { window.decoderResult = data; worker.terminate(); };
worker.onerror = (error) => { window.decoderResult = { error: error.message }; worker.terminate(); };
`,
);
writeFileSync(
  `${consumer}/worker.js`,
  `
import init, { AudioDecoder, version } from '@gumi-conqueror/audio-decode';
import wasmUrl from '@gumi-conqueror/audio-decode/index_bg.wasm?url';
import notices from '@gumi-conqueror/audio-decode/THIRD_PARTY_NOTICES.txt?raw';
try {
  await init({ module_or_path: wasmUrl });
  const bytes = new Uint8Array(await (await fetch('/tone.flac')).arrayBuffer());
  const decoder = new AudioDecoder(bytes);
  try {
    let frames = 0;
    let energy = 0;
    let samples;
    while ((samples = decoder.nextChunk()) !== undefined) {
      frames += samples.length / decoder.channels;
      for (const sample of samples) energy += sample * sample;
    }
    postMessage({ rate: decoder.sampleRate, channels: decoder.channels, frames, energy, version: version(), notices: notices.includes('MPL-2.0') });
  } finally { decoder.free(); }
} catch (error) { postMessage({ error: String(error) }); }
`,
);
await build({ root: consumer, configFile: false, logLevel: 'warn', worker: { format: 'es' } });
const server = await preview({
  root: consumer,
  configFile: false,
  logLevel: 'warn',
  preview: {
    host: '127.0.0.1',
    port: 0,
    headers: {
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'",
    },
  },
});
let browser;
try {
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, timeout: 10000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const wasmRequests = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.wasm')) wasmRequests.push(response);
  });
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    errors.push(`External request: ${route.request().url()}`);
    return route.abort();
  });
  await page.goto(origin, { waitUntil: 'load', timeout: 10000 });
  await page.waitForFunction(() => window.decoderResult, undefined, { timeout: 10000 });
  const result = await page.evaluate(() => window.decoderResult);
  assert.equal(result.error, undefined);
  assert.deepEqual(
    {
      rate: result.rate,
      channels: result.channels,
      frames: result.frames,
      version: result.version,
    },
    { rate: tone.sampleRate, channels: tone.channels, frames: tone.frames, version },
  );
  // A quarter of the expected sine energy: frames × (amplitude / 32768)² / 2 per channel.
  const expectedEnergy = tone.amplitudes.reduce(
    (sum, amplitude) => sum + (tone.frames * (amplitude / 32768) ** 2) / 2,
    0,
  );
  assert.ok(result.energy > expectedEnergy / 4, `energy ${result.energy}`);
  assert.equal(result.notices, true, 'Consumers can bundle the embedded dependency notices');
  assert.deepEqual(errors, []);
  assert.equal(wasmRequests.length, 1, 'Load exactly one bundled WASM asset');
  assert.equal(wasmRequests[0].status(), 200);
  console.log(
    'Packed dependency: Vite build, same-origin WASM, strict CSP and module Worker passed',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
