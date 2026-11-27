//! Browser bindings for the shared, incremental audio decoder.

use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

/// An owned decoder. Call `free()` to release its input and codec state.
#[wasm_bindgen(js_name = AudioDecoder)]
#[derive(Debug)]
pub struct AudioDecoder(audio_decode::Decoder);

#[wasm_bindgen(js_class = AudioDecoder)]
impl AudioDecoder {
    /// Copies an encoded file into WASM memory and detects its contents.
    ///
    /// # Errors
    /// Throws if the file is unsupported, malformed, or contains no audio samples.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<AudioDecoder, JsError> {
        Ok(Self(audio_decode::Decoder::from_bytes(bytes)?))
    }

    /// Returns the original sample rate in hertz.
    #[wasm_bindgen(getter, js_name = sampleRate)]
    pub fn sample_rate(&self) -> u32 {
        self.0.info().sample_rate
    }

    /// Returns the number of interleaved channels.
    #[wasm_bindgen(getter)]
    pub fn channels(&self) -> usize {
        self.0.info().channels
    }

    /// Returns the detected container name.
    #[wasm_bindgen(getter)]
    pub fn container(&self) -> String {
        self.0.info().container.to_owned()
    }

    /// Returns the detected codec name.
    #[wasm_bindgen(getter)]
    pub fn codec(&self) -> String {
        self.0.info().codec.to_owned()
    }

    /// Returns original sample precision when reported by the codec.
    #[wasm_bindgen(getter, js_name = bitsPerSample)]
    pub fn bits_per_sample(&self) -> Option<u32> {
        self.0.info().bits_per_sample
    }

    /// Returns the frames per channel that the container declares before decoding.
    ///
    /// Returns `undefined` when the container declares no count. The decoded count
    /// can differ, for example after gapless trimming.
    #[wasm_bindgen(getter)]
    pub fn frames(&self) -> Option<f64> {
        // Frame counts stay far below 2^53, so the conversion is exact.
        self.0.info().frames.map(|frames| frames as f64)
    }

    /// Copies the next interleaved chunk into a new JavaScript Float32Array.
    ///
    /// Returns `undefined` at the end. The result does not borrow WASM memory.
    ///
    /// # Errors
    /// Throws on a decode error or a change of audio format. Free the decoder afterwards.
    #[wasm_bindgen(js_name = nextChunk)]
    pub fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, JsError> {
        Ok(self.0.next_chunk()?)
    }
}

/// Returns the shared library release version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
