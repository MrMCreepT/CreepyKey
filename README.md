# CreepyCrate & Key DJ PWA 🎧

CreepyCrate & Key DJ is a studio-grade, serverless **Progressive Web App (PWA)** designed specifically for DJs, music producers, and selectors. It allows you to batch-analyse local folders of MP3 files entirely within your web browser to detect BPM and Musical Key, outputting compatible keys in either **Camelot Wheel** or **Standard Key** formats.

Because it runs 100% client-side, your files never leave your computer—guaranteeing **100% privacy, zero server costs, and offline capability**.

---

## ✨ Key Features

*   📂 **Recursive Directory Processing**: Deep-scans selected folders using the *File System Access API*, bypassing the output folder to prevent loops.
*   🔄 **Duplicate Prevention (Automatic Sync)**: Avoids duplicate copies of the same song (e.g. `5A - Song.mp3` and `Song.mp3`) in `Processed_Tracks`. When options or key notations change, it scans and deletes old matching files using the native `removeEntry` API.
*   🎡 **Interactive Camelot Wheel HUD**:
    *   **Selection Sync**: Selecting a track in the table automatically lights up its key on the wheel and displays a soft glow on its compatible harmonic neighbors.
    *   **Harmonic Filtering**: Clicking any segment on the Camelot Wheel filters the tracks table in real-time to show only that key and its harmonic matches.
*   📊 **Dynamic Header Sorting**: Click any table header (`Original Name`, `New Filename`, `BPM`, `Key`, `Energy`, `Genre`, `Status`) to sort the table ascending or descending with visual arrows (`▲`/`▼`).
*   🔥 **DJ Energy Level Estimation (1–10)**: Analyzes audio intensity (Root-Mean-Square level) of the audio buffer and maps it to a 1–10 Energy rating, complete with colorful dynamic flame indicators.
*   ⚡ **Dual-Layer Skip Optimization**:
    *   **Destination Check**: Instantly skips processing if the target file already exists in the `Processed_Tracks` directory and matches the selected tagging options. If the tag options have changed (or a different notation is selected), it performs a fast tag-only write without decoding the audio.
    *   **Metadata Tag Bypass**: Scans the source file's ID3v2 headers for existing `TKEY` (Key) and `TBPM` (BPM) tags. If found, it bypasses the slow audio decoding and worker analysis steps entirely, resolving and copying the file in under 1 millisecond.
*   🧠 **Concurrent Worker Pool**: Instantiates a pool of background Web Workers (matching `navigator.hardwareConcurrency` up to 4 parallel slots) to decode and analyse files concurrently. This scales processing speed by **200% to 300%** on multi-core systems.
*   🛡️ **In-Place Binary ID3 Preservation**: Modifies MP3 buffers directly to inject compatible Camelot Key (`TKEY`) and BPM (`TBPM`) tags. Unlike typical libraries, it **preserves 100% of your existing tags** (Artwork, Title, Artist, Album, Ratings, and DJ cue points/beatgrids from Rekordbox, Serato, or Traktor).
*   ⚙️ **Flexible Batch Action Panel**:
    *   **Rename Filename**: Prepends the key and DJ energy level to the output file name (e.g. `8A - 5 - Track.mp3`).
    *   **Prepend Key to Track Title**: Modifies the internal title tag (e.g. `8A - Track Title`).
    *   **Write Key & BPM Tags**: Injects `TKEY` and `TBPM` tags directly.
    *   **Fast Byte Copy**: If no tagging options are checked, performs a pure binary copy to ensure 100% tag and cue point preservation.
*   🏷️ **Native Genre Extraction**: Automatically parses and decodes `TCON` (Genre) tags natively from the file binary, displaying them in the UI table and exporting them in CSV setlists.
*   🚥 **Harmonic Traffic Light System**: Selecting a processed track highlights compatible mixing partners (perfect matches, $\pm 1$ hour shift, or relative major/minor) while dimming incompatible ones.
*   🌊 **Interactive Waveform Deck**: Immediate preview playback with dynamic waveform renderings powered by `wavesurfer.js`.
*   📋 **Setlist Timeline Builder**:
    *   **Drag-and-Drop Reordering**: Drag tracks from your library into the setlist and reorder them easily.
    *   **Transition Flow Auditor**: Audits transitions between consecutive tracks in real-time, showing visual indicators (Perfect Match, Relative Key, Adjacent Shift, Tempo Match, or Harmonic Clash) with exact BPM offsets.
    *   **Direct Library Integration**: Build your setlist directly from the Crate Library using quick `+ Setlist` buttons on the main results table.
*   🎛️ **Dual-Deck DJ Mixer**:
    *   **Flexible Deck Layouts**: Toggle between Classic (side-by-side) decks or Stacked Waveforms (vertical mixing layout) to align beatgrid lines.
    *   **On-the-Fly Analysis**: Dynamically decodes and estimates beatgrid offsets and energy ratings if a track bypassed the initial batch analysis because it was already tagged.
    *   **Manual Beatgrid Nudging**: Shift the beatgrid left or right in 10ms increments using `◀ Grid` and `Grid ▶` controls to adjust phase offsets on the fly.
    *   **Web Audio Metronome Audit**: Toggle an audible synth click (`Metronome 🔊`) to verify beatgrid accuracy against the kick transients.
    *   **Platter Jog Bend (Pitch Nudge)**: Temporarily speed up or slow down a deck by $\pm 3.5\%$ for 150ms to align beats by hand.
    *   **Quantized Loop Rolls**: Seamlesly roll loops (`1`, `4`, `8`, or `16` beats) that snap to the nearest beatgrid line.
    *   **Sync Matching**: Sync pitches (matching BPMs) and align playhead times instantly based on beatgrid phase offsets.
    *   **Crossfader**: Blend levels between Deck A and Deck B, or trigger automated 16-bar Auto-Mix crossfades.
*   ⌨️ **DJ Workflow UX Polish**:
    *   **Drag & Drop Folders**: Drag any music folder and drop it directly onto the window to begin processing.
    *   **Spacebar Play/Pause**: Toggles audio preview playback globally (disabled inside form inputs).
    *   **Accidental Close Protection**: Warns the user if they try to close or refresh the tab while a batch run is active.
    *   **Zero Memory Leaks**: Revokes Object URLs after track previewing to keep browser memory usage clean.
*   📊 **Setlist Exports**: Instant downloads for standard `CSV` setlists (now containing Energy metrics) and `M3U8` playlist files, ready to import into your library manager.

---

## 🛠️ Technology Stack

*   **Core**: HTML5, Vanilla CSS3 (Custom Variables), JavaScript (ES6+ Modules)
*   **Web APIs**: Web Audio API, Web Workers, Service Workers, File System Access API
*   **Standards-Compliant ID3 Encoding**: Dynamically encodes text frames (using ISO-8859-1 for ASCII or UTF-16 with BOM for international characters in ID3v2.3; UTF-8 in ID3v2.4) to guarantee native metadata rendering across Windows Explorer, macOS Finder, Rekordbox, Serato, and CDJs.
*   **Client-Side Libraries**:
    *   [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) (Interactive Waveforms)
    *   [browser-id3-writer](https://github.com/egoroof/browser-id3-writer) (Metadata tag writing fallback)

---

## 🚀 Getting Started

### Prerequisites

You need [Node.js](https://nodejs.org/) installed locally.

### Local Development

1.  Clone or navigate to the project directory:
    ```bash
    cd creepykey
    ```
2.  Install development dependencies:
    ```bash
    npm install
    ```
3.  Launch the development server:
    ```bash
    npm run dev
    ```
4.  Open the local address in your browser:
    *   **Local URL**: `http://localhost:5173`

---

## 🔒 Privacy & Offline Capability

*   **No Servers**: All audio decoding, analytical DSP, and file writing occur locally on your machine.
*   **Offline Ready**: Built as a PWA, the service worker caches the application shell. Once visited online, you can launch and use CreepyKey completely offline in the DJ booth, studio, or on the road.
