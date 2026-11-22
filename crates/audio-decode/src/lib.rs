//! Decode one audio track into interleaved floating-point chunks.
//!
//! The same decoder runs in native applications and WebAssembly workers.
//! It does not resample, mix channels, apply replay gain, or quantize to Int16.
//! Callers control scheduling and can cancel by dropping the decoder between chunks.

mod decoder;

pub use decoder::{AudioInfo, DecodeError, Decoder};
