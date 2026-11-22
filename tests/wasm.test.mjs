import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import init, { AudioDecoder, version } from '../pkg/index.js';

await init({ module_or_path: readFileSync(new URL('../pkg/index_bg.wasm', import.meta.url)) });

function decode(name) {
  const decoder = new AudioDecoder(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
  try {
    const samples = [];
    let chunk;
    while ((chunk = decoder.nextChunk()) !== undefined) {
      assert.ok(chunk instanceof Float32Array);
      samples.push(...chunk);
    }
    return { samples, rate: decoder.sampleRate, channels: decoder.channels };
  } finally {
    decoder.free();
  }
}

test('WASM lossless output preserves exact PCM across containers', () => {
  const expected = decode('tone.wav');
  assert.equal(expected.rate, 48000);
  assert.equal(expected.channels, 2);
  assert.equal(expected.samples.length, 12000);
  for (const name of ['tone.flac', 'tone-alac.m4a', 'tone.aiff']) {
    assert.deepEqual(decode(name), expected, name);
  }
});

test('WASM supports compressed audio and gapless MP3/Vorbis', () => {
  for (const name of ['tone.mp3', 'tone.ogg', 'tone-aac.m4a', 'tone.aac']) {
    const audio = decode(name);
    assert.equal(audio.rate, 48000);
    assert.equal(audio.channels, 2);
    assert.ok(audio.samples.every(Number.isFinite));
    if (name === 'tone.mp3' || name === 'tone.ogg') assert.equal(audio.samples.length, 12000, name);
    else assert.ok(audio.samples.length >= 12000 && audio.samples.length <= 18000, name);
    const energy = [0, 0];
    audio.samples.forEach((value, index) => {
      energy[index % 2] += value * value;
    });
    assert.ok(energy[0] > 50 && energy[1] > 10, name);
    assert.ok(energy[0] / energy[1] > 3 && energy[0] / energy[1] < 5, name);
  }
});

test('WASM preserves the final Vorbis page', () => {
  const audio = decode('generated-tone.ogg');
  assert.equal(audio.rate, 44100);
  assert.equal(audio.channels, 1);
  assert.equal(audio.samples.length, 13230);
});

test('returned chunks survive subsequent decoding and free', () => {
  const decoder = new AudioDecoder(readFileSync(new URL('fixtures/tone.flac', import.meta.url)));
  const first = decoder.nextChunk();
  const snapshot = first.slice();
  while (decoder.nextChunk() !== undefined) {
    /* consume the rest */
  }
  decoder.free();
  assert.deepEqual(first, snapshot);
  assert.throws(() => new AudioDecoder(new Uint8Array([1, 2, 3])));
  assert.match(version(), /^\d+\.\d+\.\d+/);
});
