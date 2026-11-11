# Background music

Drop royalty-free music files here (`.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`). Each video picks
one at random and mixes it quietly under the narration (see `mixBackgroundMusic` in `server.ts`).

- Levels are handled automatically: every track is loudness-normalised to a soft background level
  (`BACKGROUND_MUSIC_LUFS`, default -34), dips further while the voice speaks, and fades in and out.
- Short tracks loop to fill a long meditation video.
- With no files here, a built-in ambient pad (synthesized by the app, nothing to license) is used.
- `BACKGROUND_MUSIC=off` turns music off entirely.

Only add music you have the right to use on YouTube/Instagram/Facebook - e.g. tracks from the YouTube
Audio Library or Pixabay Music marked free for commercial use. Calm instrumental piano, strings or
ambient pads suit devotional narration best; avoid tracks with vocals.
