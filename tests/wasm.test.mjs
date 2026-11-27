import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import init, { AudioDecoder, version } from '../pkg/index.js';

await init({ module_or_path: readFileSync(new URL('../pkg/index_bg.wasm', import.meta.url)) });

const tone = JSON.parse(readFileSync(new URL('fixtures/tone.json', import.meta.url), 'utf8'));
const toneSamples = tone.frames * tone.channels;
// Energy of a full-scale-normalized sine: frames × (amplitude / 32768)² / 2.
const toneEnergy = tone.amplitudes.map((amplitude) => (tone.frames * (amplitude / 32768) ** 2) / 2);

function decode(name) {
  const decoder = new AudioDecoder(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
  try {
    const samples = [];
    let chunk;
    while ((chunk = decoder.nextChunk()) !== undefined) {
      assert.ok(chunk instanceof Float32Array);
      samples.push(...chunk);
    }
    return {
      samples,
      rate: decoder.sampleRate,
      channels: decoder.channels,
      frames: decoder.frames,
    };
  } finally {
    decoder.free();
  }
}

test('WASM lossless output preserves exact PCM across containers', () => {
  const expected = decode('tone.wav');
  assert.equal(expected.rate, tone.sampleRate);
  assert.equal(expected.channels, tone.channels);
  assert.equal(expected.samples.length, toneSamples);
  // The declared frame count is known before decoding; Matroska declares none.
  assert.equal(expected.frames, tone.frames);
  for (const name of ['tone.flac', 'tone-alac.m4a', 'tone.aiff']) {
    assert.deepEqual(decode(name), expected, name);
  }
  assert.deepEqual(decode('tone.mka'), { ...expected, frames: undefined });
});

test('WASM supports compressed audio and gapless MP3/Vorbis', () => {
  for (const name of ['tone.mp3', 'tone.ogg', 'tone-aac.m4a', 'tone.aac', 'tone.mkv']) {
    const audio = decode(name);
    assert.equal(audio.rate, tone.sampleRate);
    assert.equal(audio.channels, tone.channels);
    assert.ok(audio.samples.every(Number.isFinite));
    const length = audio.samples.length;
    if (name === 'tone.mp3' || name === 'tone.ogg') assert.equal(length, toneSamples, name);
    // AAC/MP4 gapless editing is not promised by Symphonia 0.6.1.
    else assert.ok(length >= toneSamples && length <= toneSamples * 1.5, `${name}: ${length}`);
    const energy = [0, 0];
    audio.samples.forEach((value, index) => {
      energy[index % 2] += value * value;
    });
    const expectedRatio = toneEnergy[0] / toneEnergy[1];
    assert.ok(energy.every((value, channel) => value > toneEnergy[channel] / 4), `${name}: ${energy}`);
    const ratio = energy[0] / energy[1];
    assert.ok(Math.abs(ratio / expectedRatio - 1) < 0.25, `stereo channel order: ${name}: ${ratio}`);
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
});

test('rejects data that is not audio and codecs that are not enabled', () => {
  assert.throws(() => new AudioDecoder(new Uint8Array([1, 2, 3])));
  assert.throws(
    () => new AudioDecoder(readFileSync(new URL('fixtures/tone-opus.mka', import.meta.url))),
  );
});

test('reports a semantic version', () => {
  assert.match(version(), /^\d+\.\d+\.\d+/);
});
