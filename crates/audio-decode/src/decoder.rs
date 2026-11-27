use std::fmt;
use std::io::{self, Cursor, Read, Seek, SeekFrom};

use symphonia::core::audio::AudioSpec;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatReader, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};

/// Describes the selected audio track and the samples returned by the decoder.
#[non_exhaustive]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioInfo {
    /// Detected container name, independent of the filename extension.
    pub container: &'static str,
    /// Detected audio codec name.
    pub codec: &'static str,
    /// Output sample rate in hertz. No resampling is performed.
    pub sample_rate: u32,
    /// Number of channels in each interleaved output frame.
    pub channels: usize,
    /// Original decoded sample precision, when supplied by the codec.
    pub bits_per_sample: Option<u32>,
    /// Frames per channel that the container declares before decoding, when it
    /// declares a count. The decoded count can differ, for example after gapless trimming.
    pub frames: Option<u64>,
}

/// A file cannot be opened or decoded without losing audio data.
#[derive(Debug)]
pub struct DecodeError(String);

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecodeError {}

impl From<io::Error> for DecodeError {
    fn from(error: io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<symphonia::core::errors::Error> for DecodeError {
    fn from(error: symphonia::core::errors::Error) -> Self {
        Self(error.to_string())
    }
}

/// Owns one source and decodes its default audio track one packet at a time.
pub struct Decoder {
    format: Box<dyn FormatReader>,
    codec: Box<dyn AudioDecoder>,
    track_id: u32,
    info: AudioInfo,
    spec: Option<AudioSpec>,
    pending: Option<Vec<f32>>,
    finished: bool,
}

impl fmt::Debug for Decoder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Decoder")
            .field("info", &self.info)
            .field("finished", &self.finished)
            .finish_non_exhaustive()
    }
}

impl Decoder {
    /// Opens an owned byte buffer and reads the first nonempty audio packet.
    ///
    /// # Errors
    /// Returns an error for unsupported, malformed, or empty audio.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, DecodeError> {
        Self::open(Cursor::new(bytes))
    }

    /// Opens a seekable source at its beginning and detects its contents.
    ///
    /// The source must remain owned by the decoder. Native callers can pass a file;
    /// browser callers can pass an owned byte buffer through [`Self::from_bytes`].
    ///
    /// # Examples
    /// ```no_run
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let file = std::fs::File::open("music.flac")?;
    /// let mut decoder = audio_decode::Decoder::open(file)?;
    /// while let Some(samples) = decoder.next_chunk()? {
    ///     // Consume interleaved samples, then check cancellation before the next call.
    ///     assert_eq!(samples.len() % decoder.info().channels, 0);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Errors
    /// Returns an error if detection or the first audio packet fails.
    /// An unsupported default audio track is reported instead of selecting another track.
    pub fn open(mut source: impl Read + Seek + Send + Sync + 'static) -> Result<Self, DecodeError> {
        // Matroska needs the source length to distinguish EOF from a truncated element.
        let length = source.seek(SeekFrom::End(0))?;
        source.rewind()?;
        let stream = MediaSourceStream::new(
            Box::new(Source {
                inner: source,
                length,
            }),
            Default::default(),
        );
        let format = symphonia::default::get_probe().probe(
            &Hint::new(),
            stream,
            Default::default(),
            Default::default(),
        )?;
        let track = format
            .default_track(TrackType::Audio)
            .ok_or_else(|| DecodeError("no default audio track".into()))?;
        let params = track
            .codec_params
            .as_ref()
            .and_then(|params| params.audio())
            .ok_or_else(|| DecodeError("missing audio codec parameters".into()))?;
        let codec = symphonia::default::get_codecs()
            .make_audio_decoder(params, &AudioDecoderOptions::default())?;
        let info = AudioInfo {
            container: format.format_info().short_name,
            codec: codec.codec_info().short_name,
            sample_rate: 0,
            channels: 0,
            bits_per_sample: params.bits_per_sample,
            frames: track.num_frames,
        };
        let track_id = track.id;
        let mut result = Self {
            format,
            codec,
            track_id,
            info,
            spec: None,
            pending: None,
            finished: false,
        };
        result.pending = Some(
            result
                .next_chunk()?
                .ok_or_else(|| DecodeError("audio contains no samples".into()))?,
        );
        Ok(result)
    }

    /// Returns the format established by the first decoded audio packet.
    pub fn info(&self) -> &AudioInfo {
        &self.info
    }

    /// Returns interleaved samples, or `None` after the selected track ends.
    ///
    /// Chunk sizes follow codec packet sizes. Gapless trimming uses metadata supported
    /// by Symphonia. Samples are not clipped. Drop the decoder to release its input.
    ///
    /// # Errors
    /// Returns an error on malformed packets, unsupported chained streams, or a change
    /// in sample rate or channel layout. Discard the decoder after an error.
    /// Failed packets are never silently skipped.
    pub fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, DecodeError> {
        if let Some(samples) = self.pending.take() {
            return Ok(Some(samples));
        }
        if self.finished {
            return Ok(None);
        }
        while let Some(packet) = self.format.next_packet()? {
            if packet.track_id != self.track_id {
                continue;
            }
            let decoded = self.codec.decode(&packet)?;
            if decoded.frames() == 0 {
                continue;
            }
            let spec = decoded.spec();
            if spec.rate() == 0 || spec.channels().count() == 0 {
                return Err(DecodeError("invalid decoded audio format".into()));
            }
            if self.spec.as_ref().is_some_and(|previous| previous != spec) {
                return Err(DecodeError("audio format changes within the track".into()));
            }
            if self.spec.is_none() {
                self.info.sample_rate = spec.rate();
                self.info.channels = spec.channels().count();
                self.spec = Some(spec.clone());
            }
            let mut samples = vec![0.0; decoded.samples_interleaved()];
            decoded.copy_to_slice_interleaved(&mut samples);
            return Ok(Some(samples));
        }
        self.finished = true;
        Ok(None)
    }
}

struct Source<R> {
    inner: R,
    length: u64,
}

impl<R: Read> Read for Source<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buffer)
    }
}

impl<R: Seek> Seek for Source<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

impl<R: Read + Seek + Send + Sync> MediaSource for Source<R> {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.length)
    }
}
