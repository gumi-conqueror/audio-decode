# audio-decode

Incremental audio decoding through Symphonia, with a native Rust crate and a prebuilt WASM package.
The wrapper code is MIT. Symphonia remains MPL-2.0.

## Scope

Use formats that Symphonia already supports. A new format does not justify another codec toolchain by itself.
The initial selection includes WAV PCM, AIFF PCM, FLAC, Ogg Vorbis, MP3, AAC-LC and ALAC.
AAC supports ADTS and MP4/M4A. HE-AAC, Opus, APE audio and WavPack are not included.
Matroska (MKV/MKA) supports the enabled audio codecs; it does not add Opus support or video playback.
The `ape` Cargo feature only reads APE metadata.

The decoder detects file contents and selects the default audio track.
It returns interleaved Float32 chunks at the decoded sample rate and channel count.
It does not resample, downmix, apply ReplayGain, play audio, or export files.
Callers must apply their own channel and precision policy.
Changing sample rate or channel layout within a stream is an error.
Corrupt packets are reported instead of silently omitted.

MP3 and Vorbis use supported gapless metadata. AAC/MP4 does not promise sample-exact gapless editing in Symphonia 0.6.1.
Float32 output does not preserve every bit of 32-bit integer PCM.

## Native

Use the `audio-decode` crate from an exact Git revision of this repository.
Cargo compiles it for the application's native target. No platform DLL is required.

```rust
let file = std::fs::File::open("music.flac")?;
let mut decoder = audio_decode::Decoder::open(file)?;
while let Some(samples) = decoder.next_chunk()? {
    // Consume interleaved samples and check cancellation between chunks.
}
```

## Browser and Vite

Install the versioned `.tgz` from this repository's GitHub Release.
The repository must have a published release before this remote installation works.
Do not install the source checkout as an npm Git dependency: that checkout contains no prebuilt WASM.

```sh
npm install --save-exact https://github.com/gumi-conqueror/audio-decode/releases/download/v0.1.0/gumi-conqueror-audio-decode-0.1.0.tgz
```

Use the decoder inside a module Worker:

Set Vite's `worker.format` to `es` when the Worker uses top-level `await`.

```js
import init, { AudioDecoder } from '@gumi-conqueror/audio-decode';
import wasmUrl from '@gumi-conqueror/audio-decode/index_bg.wasm?url';

await init({ module_or_path: wasmUrl });
const decoder = new AudioDecoder(encodedBytes);
try {
  let samples;
  while ((samples = decoder.nextChunk()) !== undefined) {
    postMessage({ samples }, [samples.buffer]);
    // Yield periodically to receive cancellation and progress messages.
  }
} finally {
  decoder.free();
}
```

Vite copies the WASM asset into the application output. Runtime loading uses the application's own URL, without a CDN.
The Worker must allow WebAssembly compilation through its CSP. `wasm-unsafe-eval` permits this without enabling JavaScript `unsafe-eval`.
Each chunk is copied into a new JS Float32Array. It remains valid after the next decode or `free()`.
Dropping the native decoder, freeing the WASM decoder, or terminating its Worker releases input and codec state.

## Development

Install Node 26, the pinned Rust toolchain, and `wasm-pack 0.14.0`.
Install the WASM target with `rustup target add wasm32-unknown-unknown`.
FFmpeg is needed only to regenerate synthetic fixtures.

```sh
npm ci
cargo fmt --all --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo doc --locked --workspace --no-deps
npm run build
npm test
npm run package
npm run test:browser
```

Local native checks use debug. The WASM package is always optimized because it is a distributable dependency.
`npm run package` packs the existing tested WASM output. It does not compile it again.
`npm run test:browser` installs that tarball into a temporary Vite consumer, then tests its built module Worker in Chromium.
Install Chromium locally with `npm exec -- playwright install chromium` before that test.
Do not copy generated files into source control.

See [CI and distribution](docs/CI.md) for build order, caches, release promotion and application integration.

## Licensing

The WASM package includes generated `THIRD_PARTY_NOTICES.txt`, full dependency license texts, and exact-version source URLs.
The list comes from locked Cargo metadata rather than a second handwritten dependency database.
The root `LICENSE` applies to this wrapper, not to Symphonia.
Native applications must include their own notices for their resolved Cargo dependencies.
