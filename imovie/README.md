# iMovie for the web

A browser-based movie editor modeled closely on **iMovie 10 for Mac** — same layout, menus,
keyboard shortcuts and magnetic timeline — with a frame-exact export renderer and background
pre-rendering.

Open `imovie/index.html` from any static web server (for example `python3 -m http.server`,
then visit `http://localhost:8000/imovie/`). Everything runs locally in the browser; imported
media and projects are stored in the browser's IndexedDB.

Works best in current Chrome, Edge or Safari on macOS or Windows (H.264/AAC export). Browsers
without H.264 encoding export VP9/WebM automatically.

## Highlights

- **Projects browser**, **Media** view, Libraries list with events, Project Media and Photos Library.
- **Import** window: files, folders, drag & drop, and recording from the FaceTime camera.
- **Browser** with skimmable filmstrips that wrap across rows, range selection, Favorite /
  Reject / Unmark, "+" to add to the movie, used-in-project markers.
- **Timeline** with iMovie's behaviors: magnetic primary storyline, clips sliding apart for
  inserts, drag to reorder, drop on a clip for Replace / Replace from Start / Replace from End /
  Insert, cutaways and connected clips that ride with their clip (connection line when selected),
  purple title bars, background music well (songs start at the beginning and play back to
  back), ripple trimming with limit feedback, range selection (hold **R**), volume line with
  percentages, gray fade handles, yellow/red clipping peaks, turtle/rabbit speed slider,
  transitions that overlap clips, split / join / detach audio / freeze frame, Clip Trimmer
  (⌘\\) and Precision Editor (⌘/), snapping, skimming, zoom.
- **Adjustments**: Enhance, color balance (auto, match color, white balance, skin tone), color
  correction, crop / Ken Burns / rotation, stabilization, volume and ducking, noise reduction
  and equalizer, speed (slow, fast, custom, reverse, preserve pitch, instant replay, rewind),
  38 clip filters, 12 audio effects, video overlays (cutaway, green/blue screen, split screen,
  picture in picture), clip information.
- **Titles** (40+ animated styles, edited directly in the viewer), **Backgrounds** (25),
  **Transitions** (all 24 of iMovie's), **Themes**, **Soundtracks** and **Sound Effects**
  (synthesized), **Voiceover** recording.
- **Share**: File (MP4 H.264/AAC, or VP9/WebM), Email, YouTube & Facebook, Image, Audio Only.

## Export renderer

- The viewer and the exporter share one composition path; the timeline is laid out in whole
  frames, so paused viewer frames and exported frames are identical compositions.
- Export decodes source frames with WebCodecs (no `<video>` seeking); missing frames are errors,
  never silent black frames. Rotation metadata, fonts, photos and generated audio are all
  resolved before rendering starts.
- Audio is mixed offline with the same gain, fade, ducking and effect code as live playback;
  speed changes use a pitch-preserving time stretch and reverse plays reversed audio, both in
  preview and export.
- **Pre-rendering**: while you're idle, the movie is split into content-hashed, shift-invariant
  sections that are rendered and encoded in the background. Exports reuse those sections
  without re-encoding, so unchanged parts of a movie export almost instantly.
- **Verification**: after every export the file is decoded again, frame count and duration are
  checked, and sampled frames (plus their neighbors, to catch off-by-one timing) are compared
  against fresh renders. Failing sections are re-rendered automatically.

This is an independent project and is not affiliated with Apple Inc. It uses
[Mediabunny](https://mediabunny.dev) (MPL-2.0, `vendor/mediabunny.min.js`) for media reading
and writing.
