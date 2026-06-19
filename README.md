# CreepyKey PWA 🎧

CreepyKey is a studio-grade, serverless **Progressive Web App (PWA)** designed specifically for DJs, music producers, and selectors. It allows you to batch-analyse local folders of MP3 files entirely within your web browser to detect BPM and Musical Key, outputting compatible keys in either **Camelot Wheel** or **Standard Key** formats.

Because it runs 100% client-side, your files never leave your computer—guaranteeing **100% privacy, zero server costs, and offline capability**.

---

## ✨ Key Features

*   📂 **Recursive Directory Processing**: Deep-scans selected folders using the *File System Access API*, bypassing the output folder to prevent loops.
*   ⚡ **Dual-Layer Skip Optimization**:
    *   **Destination Check**: Instantly skips processing if the target file already exists in the `Processed_Tracks` directory and matches the selected tagging options. If the tag options have changed (or a different notation is selected), it performs a fast tag-only write without decoding the audio.
    *   **Metadata Tag Bypass**: Scans the source file's ID3v2 headers for existing `TKEY` (Key) and `TBPM` (BPM) tags. If found, it bypasses the slow audio decoding and worker analysis steps entirely, resolving and copying the file in under 1 millisecond.
*   🧠 **Off-Main-Thread DSP**: Mathematical calculations (peak-detection for BPM and selective DFT chromagram correlation for Key) run inside a background Web Worker to keep the UI smooth and responsive.
*   🛡️ **In-Place Binary ID3 Preservation**: Modifies MP3 buffers directly to inject compatible Camelot Key (`TKEY`) and BPM (`TBPM`) tags. Unlike typical libraries, it **preserves 100% of your existing tags** (Artwork, Title, Artist, Album, Ratings, and DJ cue points/beatgrids from Rekordbox, Serato, or Traktor).
*   ⚙️ **Flexible Batch Action Panel**:
    *   **Rename Filename**: Prepends the key to the output file name (e.g. `8A - Track.mp3`).
    *   **Prepend Key to Track Title**: Modifies the internal title tag (e.g. `8A - Track Title`).
    *   **Write Key & BPM Tags**: Injects `TKEY` and `TBPM` tags directly.
    *   **Fast Byte Copy**: If no tagging options are checked, performs a pure binary copy to ensure 100% tag and cue point preservation.
*   🏷️ **Native Genre Extraction**: Automatically parses and decodes `TCON` (Genre) tags natively from the file binary, displaying them in the UI table and exporting them in CSV setlists.
*   🚥 **Harmonic Traffic Light System**: Selecting a processed track highlights compatible mixing partners (perfect matches, $\pm 1$ hour shift, or relative major/minor) while dimming incompatible ones.
*   🌊 **Interactive Waveform Deck**: Immediate preview playback with dynamic waveform renderings powered by `wavesurfer.js`.
*   📊 **Setlist Exports**: Instant downloads for standard `CSV` setlists and `M3U8` playlist files, ready to import into your library manager.

---

## 🛠️ Technology Stack

*   **Core**: HTML5, Vanilla CSS3 (Custom Variables), JavaScript (ES6+ Modules)
*   **Web APIs**: Web Audio API, Web Workers, Service Workers, File System Access API
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
