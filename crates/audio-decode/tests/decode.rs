//! Checks real encoded fixtures through the public native API.

use std::fs;
use std::path::Path;

use audio_decode::Decoder;

fn fixture(name: &str) -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures")
            .join(name),
    )
    .expect("synthetic fixture exists")
}

fn decode(name: &str) -> (audio_decode::AudioInfo, Vec<f32>) {
    let mut decoder = Decoder::from_bytes(fixture(name)).expect("open synthetic audio");
    let info = decoder.info().clone();
    let mut samples = Vec::new();
    while let Some(chunk) = decoder.next_chunk().expect("decode synthetic audio") {
        assert_eq!(chunk.len() % info.channels, 0, "whole frames: {name}");
        samples.extend(chunk);
    }
    assert!(decoder.next_chunk().expect("repeat EOF").is_none());
    (info, samples)
}

#[test]
fn lossless_formats_preserve_rate_channels_and_pcm() {
    let (reference, expected) = decode("tone.wav");
    assert_eq!((reference.sample_rate, reference.channels), (48000, 2));
    assert_eq!(expected.len(), 12000);
    for name in ["tone.flac", "tone-alac.m4a", "tone.aiff", "tone.mka"] {
        let (info, samples) = decode(name);
        assert_eq!((info.sample_rate, info.channels), (48000, 2), "{name}");
        assert_eq!(samples, expected, "lossless PCM: {name}");
    }
}

#[test]
fn compressed_formats_preserve_stereo_and_nonempty_output() {
    for name in [
        "tone.mp3",
        "tone.ogg",
        "tone-aac.m4a",
        "tone.aac",
        "tone.mkv",
    ] {
        let (info, samples) = decode(name);
        assert_eq!((info.sample_rate, info.channels), (48000, 2), "{name}");
        assert!(samples.iter().all(|value| value.is_finite()), "{name}");
        if name == "tone.mp3" || name == "tone.ogg" {
            assert_eq!(samples.len(), 12000, "gapless frame count: {name}");
        } else {
            // AAC/MP4 gapless editing is not promised by Symphonia 0.6.1.
            assert!(
                (12000..=18000).contains(&samples.len()),
                "AAC padding: {name}"
            );
        }
        let left: f32 = samples.iter().step_by(2).map(|value| value * value).sum();
        let right: f32 = samples
            .iter()
            .skip(1)
            .step_by(2)
            .map(|value| value * value)
            .sum();
        assert!(left > 50.0 && right > 10.0, "non-silent output: {name}");
        assert!(
            (3.0..5.0).contains(&(left / right)),
            "stereo channel order: {name}"
        );
    }
}

#[test]
fn vorbis_flushes_the_final_page() {
    let (info, samples) = decode("generated-tone.ogg");
    assert_eq!((info.sample_rate, info.channels), (44100, 1));
    assert_eq!(samples.len(), 13230);
}

#[test]
fn input_detection_does_not_require_a_filename() {
    let mut bytes = fixture("tone.wav");
    bytes.splice(12..12, *b"JUNK\x04\0\0\0test");
    let riff_len = u32::try_from(bytes.len() - 8).expect("small fixture");
    bytes[4..8].copy_from_slice(&riff_len.to_le_bytes());
    let mut decoder = Decoder::from_bytes(bytes).expect("WAV with an extra chunk");
    assert_eq!(decoder.info().sample_rate, 48000);
    assert!(
        !decoder
            .next_chunk()
            .expect("first chunk")
            .expect("audio")
            .is_empty()
    );
}

#[test]
fn malformed_input_is_reported() {
    for bytes in [
        vec![],
        b"not audio".to_vec(),
        fixture("tone.flac")[..20].to_vec(),
        fixture("tone-opus.mka"),
    ] {
        assert!(Decoder::from_bytes(bytes).is_err());
    }
}

#[test]
fn native_file_sources_and_early_cancellation_work() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/tone.flac");
    let file = fs::File::open(path).expect("fixture file");
    let mut decoder = Decoder::open(file).expect("native source");
    assert!(decoder.next_chunk().expect("first chunk").is_some());
    drop(decoder);
    let replacement = Decoder::from_bytes(fixture("tone.mp3")).expect("replacement source");
    assert_eq!(replacement.info().sample_rate, 48000);
}
