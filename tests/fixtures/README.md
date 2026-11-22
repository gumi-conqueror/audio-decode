# Synthetic audio fixtures

`tone.wav` contains 6,000 stereo PCM16 frames at 48 kHz.
The left channel is a 440 Hz tone at amplitude 8,192. The right is an 880 Hz tone at amplitude 4,096.
`npm run fixtures` creates that WAV and transcodes it with FFmpeg into FLAC, MP3, Vorbis, AAC, ALAC and AIFF.
FFmpeg is a fixture-generation tool. It is not linked into either decoder output.

`generated-tone.ogg` comes from the MIT woslicer-dx test suite.
It contains a synthetic 440 Hz mono tone at 44.1 kHz for 0.3 seconds.
It checks the final buffered Ogg page.

All fixture audio is synthetic. These files contain no recorded or third-party music.

`tone.mka` stores FLAC in Matroska, and `tone.mkv` stores AAC. `tone-opus.mka` verifies that a supported container does not imply support for its Opus codec.
