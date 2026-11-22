# CI and distribution

## Build order

1. Check Rust formatting, JavaScript syntax and release-selection tests.
2. Run native debug tests, Clippy and rustdoc on Linux, Windows and macOS. In parallel, build one optimized WASM package on Linux and test it in Node.
3. Upload the WASM npm tarball, its SHA-256 checksum and build identity as one artifact. Install that exact tarball in a clean Vite consumer and run its module Worker in Chromium under a restrictive CSP.
4. Require every job to pass. A tag workflow selects the successful push build of the same main commit, downloads its artifact and publishes it without rebuilding.

Tag publication fails if the main build has not passed, its artifact has expired, or the package identity or checksum differs. Re-run the main build before tagging if its artifact has expired. Releases are not overwritten.

The initial version is a candidate until this repository has a remote and a successful main build. Do not treat a locally generated tarball with a null commit or a dirty checkout as a release.

## Cache boundaries

- Select the compiler from `rust-toolchain.toml` before restoring `Swatinem/rust-cache`. Install the WASM target before the WASM cache step.
- Keep native debug caches separate by OS and architecture. Use one Linux WASM release cache. The cache action also hashes the compiler, Cargo manifests, lockfile and build environment.
- Only main push builds save shared Rust caches. Pull requests can restore them. Cache misses must not change results.
- Cache npm downloads through `setup-node` and `package-lock.json`; use `npm ci`, not a cached `node_modules` tree.
- Cache Cargo-installed tools and the explicit `WASM_PACK_CACHE` directory. Check the exact wasm-pack version before use. Keep wasm-bindgen pinned so its CLI and Rust bindings match.
- Transfer packages between jobs with artifacts. A build cache is not a source for release files. Do not compile WASM again in each native OS job or in the consuming application.

The Rust release profile preserves WASM feature metadata. wasm-pack's extra Binaryen optimization is disabled: LLVM already optimizes the package, and this avoids a second optimizer version and download. Measure package size before adding it later.

## Consuming the release

The WASM binary comes from the versioned `.tgz` attached to this repository's GitHub Release. The package contains the binary, JS loader, type declarations, build identity and license notices. It has no install script and requires no Rust tools in the application's web build.

Install the full release asset URL shown in the README and commit `package-lock.json`. npm records the URL and integrity hash. Do not depend on `latest`, a branch URL, the source Git checkout, an expiring Actions artifact, or a runtime CDN. Network access is needed at dependency-install time only. The runtime WASM URL is bundled by Vite and remains local to the application.

For native use, add a Git dependency on package `audio-decode` with `rev` set to the full commit in the release's `build-info.json`. Commit the application's Cargo lockfile. The wrapper pins Symphonia to the version used by WASM; review both resolved dependency graphs during updates. The native build compiles Rust for its own target and does not download a native DLL.

For local evaluation, install the generated `.tgz` and use a Cargo `path` dependency on `crates/audio-decode`. Remove machine-specific paths before committing an application integration.

## woslicer-dx integration boundary

This repository does not change the application's decoder selection. Integrate a published version in a separate application change:

- Keep the decoder in the existing audio Worker. Yield between packets so progress and cancellation remain responsive. The WASM constructor copies the complete encoded input; this is incremental decoding, not network streaming or zero-copy input.
- Keep channel selection, PCM quantization, resampling and waveform generation in the application. Float32 decoding does not preserve every bit of 32-bit integer PCM.
- Native decoding can run on a dedicated blocking task with cancellation checks between packets. Measure IPC copy costs before selecting it over the existing Worker on desktop.
- Compare sample counts and waveform alignment before replacing the current Vorbis decoder. Preserve existing Ogg end-page regression cases. Check MP3 delay/padding metadata and AAC/MP4 timing separately.
- Use content detection and surface unsupported-codec errors. Do not advertise HE-AAC, Opus, APE audio or WavPack support from this package.
- Extend the application's generated license notices to include the WASM package's `THIRD_PARTY_NOTICES.txt`. npm metadata alone only identifies the MIT wrapper; it does not list the embedded Rust dependencies. Native Cargo notices cover the native graph separately.
- Keep `.wos` and original `.bmh` serialization unchanged. A broader import list must not change those formats.

## Licenses and scope

The wrapper is MIT. Symphonia's crates use MPL-2.0; their source-file obligations remain in effect when linked into native code or WASM. The package includes the full license text and exact-version source links. If a future change patches MPL-covered files, publish those modified files under MPL and update source access instructions.

The selected graph uses pure Rust codecs. Supporting dependencies primarily use MIT/Apache-2.0 alternatives; `unicode-ident` also requires Unicode-3.0 notices. Generated notices include every locked registry package, including binding build tools. Review the generated notices whenever Cargo.lock changes rather than maintaining a separate license inventory. Codec patent questions are separate from source-code licenses.

APE metadata support does not decode Monkey's Audio. Adding another decoder is a separate decision about coverage, license obligations, code size and native/WASM build cost. There is no commitment to complete every format.

## References

- [resvg-js WASM package](https://github.com/thx/resvg-js/tree/main/wasm): a mature package that ships the WASM asset beside its JS loader and declarations.
- [wasm-bindgen deployment](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html): explicit initialization with the `web` target.
- [Rust cache usage](https://github.com/Swatinem/rust-cache): select Rust before restoring caches.
- [GitHub cache and artifact roles](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching): caches accelerate builds; artifacts preserve job output.
- [Symphonia 0.6.1](https://github.com/pdeljanov/Symphonia/tree/v0.6.1): format coverage and upstream license.
- [MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/): distribution and source availability.
