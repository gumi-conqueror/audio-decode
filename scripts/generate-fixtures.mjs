import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const directory = new URL('../tests/fixtures/', import.meta.url);
mkdirSync(directory, { recursive: true });
const frames = 6000;
const rate = 48000;
const bytes = Buffer.alloc(44 + frames * 4);
bytes.write('RIFF');
bytes.writeUInt32LE(bytes.length - 8, 4);
bytes.write('WAVEfmt ', 8);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(rate, 24);
bytes.writeUInt32LE(rate * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(frames * 4, 40);
for (let frame = 0; frame < frames; frame++) {
  bytes.writeInt16LE(
    Math.round(8192 * Math.sin((2 * Math.PI * 440 * frame) / rate)),
    44 + frame * 4,
  );
  bytes.writeInt16LE(
    Math.round(4096 * Math.sin((2 * Math.PI * 880 * frame) / rate)),
    46 + frame * 4,
  );
}
writeFileSync(new URL('tone.wav', directory), bytes);
for (const [name, codec] of [
  ['tone.flac', 'flac'],
  ['tone.mp3', 'libmp3lame'],
  ['tone.ogg', 'libvorbis'],
  ['tone-aac.m4a', 'aac'],
  ['tone.aac', 'aac'],
  ['tone-alac.m4a', 'alac'],
  ['tone.aiff', 'pcm_s16be'],
  ['tone.mka', 'flac'],
  ['tone.mkv', 'aac'],
  ['tone-opus.mka', 'libopus'],
]) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'tests/fixtures/tone.wav',
      '-map_metadata',
      '-1',
      '-c:a',
      codec,
      `tests/fixtures/${name}`,
    ],
    {
      cwd: new URL('../', import.meta.url),
      stdio: 'inherit',
      windowsHide: true,
    },
  );
}
