# SID SYNTH

A modular synthesizer inspired by the Commodore 64 SID chip, built with Web Audio API. Features a visual rack-based interface with drag-and-drop components, patch cable routing, and real-time audio visualization.

![SID Synth](https://img.shields.io/badge/Web%20Audio-API-green) ![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow) ![CSS3](https://img.shields.io/badge/CSS3-Modern-blue)

## Features

- **Modular Architecture** - Drag-and-drop components onto the rack
- **Patch Cable Routing** - Click-to-connect components with visual SVG cables
- **Modulation Cables** - LFO → target connections are routed to an `AudioParam` (oscillator frequency, filter cutoff) and drawn in pink
- **Splitter Channel Routing** - Per-channel outputs (`outChannel`) with channel-aware cable rendering
- **Step Sequencer** - Pattern programming with octaves and lookahead scheduling
- **3-Octave Keyboard** - C2 to B4 (36 keys) with mouse interaction
- **Recorder Panel** - Multi-track loop recorder (16-step grid + realtime capture) with per-voice ADSR engine
- **Arranger Canvas** - Timeline with bar ruler, track lanes (16-step pattern blocks), playhead, and zoom/scroll
- **MIDI Clips** - Clips on the timeline: add to the active track at the next free position, click to select, Ctrl+click for multi-select, Shift+click for range select, drag to move (grid-snapped; dragging a group moves it together), trim by dragging either edge, split (S) at the playhead, duplicate (D), loop 3x (L), Delete to remove all selected — all undoable via command history; the loop clip (start 0) carries the track's grid/realtime notes and renders them as mini-notes inside the clip
- **Markers** - Timeline markers: add at the playhead (`+ mrk`, auto-named M1/M2/…), rendered as flags on the ruler, click to seek the transport to the marker's position, remove with × — all undoable; markers persist in the project snapshot (`project.markers`) across reload
- **Track Mute/Solo** - Per-track M/S buttons in the recorder rows and in the arranger track headers; a muted track is silent, a soloed track isolates the others (engine `isAudible`); both run as undoable commands and the flags persist in the project snapshot (`track.muted`/`track.solo`) across reload
- **Track Rename** - Double-click a track name in a recorder row or an arranger lane label to rename it inline (Enter commits, Esc cancels); rename is an undoable command via history
- **Track Reorder** - ▲/▼ buttons in the recorder rows and arranger lane headers move a track up/down; reorder is an undoable command and the track order persists in the project snapshot across reload
- **Track Color** - A color input in each recorder row and arranger lane header sets the track accent (rows, grid labels, lane labels, clips); a color change is an undoable command and persists across reload
- **Input Monitor** - Per-track MNT buttons in the recorder rows and arranger lane headers toggle input monitoring (whether live notes are heard on the track); undoable and persisted
- **Lane Resize** - Drag the bottom edge of any arranger lane to change its height; the new height is an undoable command and persists across reload
- **Track Folders / Collapse** - Any track can be a folder (tracks reference it via `folder`); collapse toggles in recorder rows and arranger lane headers hide the lane/grid content or a folder's children, undoable and persisted
- **Full-Song Playback** - Every arranged clip plays once at its timeline position; the loop clip keeps looping the 16-step pattern while the song plays linearly through the rest
- **Piano Roll** - Select a clip in the arranger and its notes appear as bars on a pitch × sixteenth grid (C3–B4, step numbers on top); click an empty cell to add a one-sixteenth note (it auditions), drag on the grid to box-select notes (marquee), drag a note — or a whole selection — to move it (snapped to steps and pitch, the pitch auditions while you drag), drag a note's edges to resize its start/duration, click a note to remove it, press Delete to remove every selected note, and drag the bars in the velocity lane below the grid to set each note's velocity (0-127, persisted) — all undoable via history, and the velocity is audible (it scales the per-voice envelope gain on playback); the grid zooms with the −/+ buttons or Ctrl+wheel, and a snap selector quantizes drawing/moving/resizing to 1/16, 1/8, 1/4 or off; a quantize row (`quantize` strength/swing inputs and a Q button) snaps note starts toward the active snap grid — full strength lines notes up on the grid, swing 50 pushes every second sixteenth later for a swung feel, and strength < 100 pulls notes only part-way, applied to the marquee selection or all notes, undoable and persisted; a transpose row (`transpose` semitone input and a T button) shifts note pitches by the interval (clamped into the visible C3–B4 range), marquee-scope, undoable and persisted; Ctrl+D duplicates the selected notes right after the selection's span (phrase tiling), undoable and persisted; an L button extends each note to the start of the next one (monophonic legato, never shortening an overlapping note), marquee-scope, undoable and persisted; an F button snaps every note's duration to the active snap grid step (fixed length), marquee-scope, undoable and persisted
- **Instrument-Track Device Chain** - Each track routes its SID instrument (voices) through an insert chain (`track.inserts[]`) before its fader: an `INS` button in the recorder row opens the insert editor with `+ DLY` (delay: time/feedback/mix) and `+ RVB` (reverb: mix) devices, per-insert parameter inputs and a ✕ remove button; add/remove/param edits are undoable commands, the chain is rebuilt live, unknown device types are skipped (forward-compatible), and the inserts persist in the project snapshot across reload
- **Real-time Visualization** - Oscilloscope and spectrum analyzer
- **Preset System** - Save, load, and delete custom presets; export/import patch JSON
- **Multiple Oscillator Types** - Sine, square, triangle, sawtooth, noise
- **Filter Types** - Lowpass, highpass, bandpass, nonlinear
- **ADSR Envelope** - Attack, decay, sustain, release controls
- **Effects** - Delay and reverb
- **Master Output** - Connect any component to master out

## Components

| Component | Description |
|-----------|-------------|
| **OSC** | Oscillator with waveform selection and frequency knob |
| **FILTER** | 3-mode filter (LP/HP/BP) plus nonlinear mode, with frequency and Q controls |
| **ADSR** | Envelope generator with A/D/S/R knobs |
| **EFFECTS** | Delay and reverb with toggle and parameter controls |
| **LFO** | Low frequency oscillator for modulation (pink cable = mod) |
| **MIXER** | Mix multiple audio signals |
| **SPLITTER** | Split audio signal to multiple destinations with per-channel routing |
| **SEQ** | Step sequencer with note/octave steps |

## Getting Started

### Prerequisites

- Modern browser with Web Audio API support (Chrome, Firefox, Edge, Safari)
- Python 3 (for the dev server) **or** PowerShell 7+ (for the Python-free server)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/SergeiLitvinov/sid-synth.git
cd sid-synth
```

2. Serve the files using any HTTP server. For example:
```bash
# Included dev server (no-cache, Windows)
.\serve.ps1

# Or directly with Python (also no-cache)
python serve.py . 3000

# Or without Python at all (PS7-only, no-cache, port 3100)
pwsh -File tests/serve-ps.ps1
```

3. Open your browser and navigate to `http://localhost:3000` (or `http://127.0.0.1:3100` with `serve-ps.ps1`)

> **Note:** the dev server sends `Cache-Control: no-store`. A plain `python -m http.server` sends no cache headers, so browsers apply heuristic caching based on file mtime (the git-checkout date) and can serve stale ES modules after edits.

## Usage

### Creating Components
1. Drag a component from the **COMPONENTS** panel on the left
2. Drop it anywhere on the **rack** (workspace)

### Connecting Components
1. Click on the green **output port** (right side) of a component
2. Click on the green **input port** (left side) of another component
3. Or connect directly to **MASTER OUT** (right side of rack)
4. Click the same output port again to cancel connection

### Playing Sounds
1. Create an **OSC** (oscillator) component
2. Connect its output to **MASTER OUT**
3. Click any key on the 3-octave keyboard
4. The ADSR envelope triggers automatically

### Removing Components
- Click the **×** button in the component header to remove it from the rack

### Using Presets
Click any preset button to instantly configure your synth:
- **BASS** - Deep bass sound
- **LEAD** - Sharp lead synth
- **PAD** - Soft pad sound
- **DRUM** - Percussive sound
- **ARP** - Arpeggiated sound
- **BASS2** - Alternative bass
- **LEAD2** - Alternative lead
- **FX** - Special effects

### Custom Presets
- **SAVE** - Save current configuration as a preset
- **LOAD** - Load a saved preset
- **DEL** - Delete a saved preset
- **SAVE PATCH** - Export patch configuration as JSON
- **LOAD PATCH** - Import patch configuration from JSON

### Recorder Panel
1. **REC** starts looped recording (auto-arms the active track); **PLAY** toggles the transport; **STOP** ends the loop and commits captured notes.
2. Click grid cells to program the 16-step pattern. Each cell stores its own **pitch and duration**: click to toggle the note on/off (it becomes selected), then the track row's *note* and *length* fields edit exactly that step (`A3·4` = A3 for 4 steps). With no cell selected, those same fields set the track defaults for new notes.
3. Each track has its own wave, filter, and ADSR — overlapping notes get independent voices (per-voice envelopes).
4. The whole project (rack + tracks + tempo + active track) persists to one versioned `localStorage` snapshot (`sidSynthProject`); old `sidSynthAutosave`/`sidSynthTracks` keys migrate automatically on first load.

## Keyboard Controls

| Range | Notes |
|-------|-------|
| C2 - B2 | Lower octave |
| C3 - B3 | Middle octave |
| C4 - B4 | Upper octave |

- **Mouse down** on a key = Note ON
- **Mouse up** on a key = Note OFF
- **Mouse leave** while pressed = Note OFF (safety)

## Audio Routing

```
OSC → Filter → ADSR → Effects → Master Out → Speakers
```

Components can be connected in any order. Use the **SPLITTER** to send signals to multiple destinations, or **MIXER** to combine multiple signals.

**Modulation:** connect an **LFO** output to any input. LFO → target is detected as a modulation route and wired to the target's `AudioParam` (oscillator frequency / filter cutoff), not to the audio input. The cable is drawn in **pink**.

## Project Structure

```
sid-synth/
├── index.html              # Main HTML file
├── style.css               # Main styles
├── knob.css                # Knob component styles
├── serve.py                # No-cache dev server (Cache-Control: no-store)
├── serve.ps1               # PowerShell wrapper around serve.py (Windows)
├── docs/                   # TODO.md (план/статус), CODING_STANDARDS.md
├── tests/                  # Браузерные тесты без Node:
│   ├── smoke.html/js       #   smoke на реальном AudioContext (10/10)
│   ├── mock-test.html/js   #   unit-эквивалент на mockAudioContext (11/11)
│   ├── track-test.html/js  #   трек-движок/рекордер + folder/collapse + full-song clips + setClipEvents + inserts/device chain + audition when + record mode/quantize + chaseToTick + midiChannel routing + pitch bend/mod/sustain (112/112)
│   ├── project-test.html/js#   versioned project serialize/migrate round-trip + markers + mute/solo + folders + inserts + midiChannel (38/38)
│   ├── history-test.html/js #   undo/redo + track commands (28/28)
│   ├── recorderUI-test.html/js # recorder panel wiring through history + INS insert editor (27/27)
│   ├── musicalTime-test.html/js # PPQ / tempo map / time signature (26/26)
│   ├── transport-test.html/js # unified transport + step engine adapter + seek + arranged-clip restart + onSeek chase + loop locators + project end (48/48)
│   ├── projectStore-test.html/js # unified project snapshot + legacy migration (11/11)
│   ├── arranger-test.html/js #   arranger layout + clips + mini-notes + trim/split/dup/loop + multi-select + markers + mute/solo + rename + reorder + color + monitor + resize + folder/collapse + piano roll UI + quantize + transpose + duplicate + legato + fixed length + humanize + preview + step input (207/207)
│   ├── clipEvents-test.html/js # grid/rt ↔ clip events conversions (21/21)
│   ├── wavExport-test.html/js #  RIFF/WAVE header + PCM mapping + clamp/round + stereo interleave (8/8)
│   ├── mockAudioContext.js #   мок Web Audio API
│   ├── serve-ps.ps1        #   PS7-only no-cache server (порт 3100, без Python)
│   └── integration.js      #   E2E против живого приложения (219 шагов, Playwright)
├── src/
│   ├── main.js             # Core logic, drag-drop, visualization
│   ├── services/            # Services (router, presets, keyboard, MIDI, etc.)
│   ├── tracks/              # Multi-track recorder engine
│   │   ├── trackEngine.js   #   loop scheduler, transport, grid+rt recording
│   │   ├── stepEngineAdapter.js # drives trackEngine from the unified transport
│   │   ├── voiceEngine.js   #   per-track polyphonic voice bank (ADSR)
│   │   └── recorderUI.js    #   recorder panel UI
│   ├── project/             # Versioned project document (web-DAW foundation)
│   │   ├── defaultProject.js#   schema factory: id/name/tempo, empty rack+tracks
│   │   ├── serialize.js     #   serializeProject / parseProject / validate / roundTrip
│   │   ├── migrate.js       #   migrateProject + fromLegacy (старые localStorage keys)
│   │   ├── projectStore.js  #   unified snapshot (rack+tracks+tempo) + legacy migration
│   │   ├── history.js       #   undo/redo command history (dirty flag, markSaved)
│   │   ├── trackCommands.js #   add/remove/update/clear/grid track + clip move/remove commands
│   │   ├── musicalTime.js   #   PPQ ticks ↔ bar/beat/tick conversion
│   │   ├── clipEvents.js    #   grid/rt ↔ clip events conversions (PPQ ticks)
│   │   ├── tempoMap.js      #   tempo + time-signature events, ticks ↔ seconds
│   │   └── transport.js     #   unified PPQ transport: clock, lookahead, play/record
│   ├── arranger/            # Linear timeline (DAW arranger canvas)
│   │   ├── arrangerLayout.js #   pure geometry: ticks↔px, ruler, pattern/clip layout, snap
│   │   └── arranger.js      #   createArranger UI: ruler, lanes, playhead, zoom, clips
│   ├── oscillator/          # Oscillator implementations
│   │   ├── index.js
│   │   ├── sine.js
│   │   ├── square.js
│   │   ├── triangle.js
│   │   └── noise.js
│   ├── filter/             # Filter implementations
│   │   ├── index.js
│   │   ├── lp.js
│   │   ├── hp.js
│   │   ├── bp.js
│   │   └── nonlinear.js
│   ├── envelope/           # ADSR envelope
│   │   └── adshr.js
│   ├── modulator/          # Modulators
│   │   ├── index.js
│   │   ├── lfo.js
│   │   ├── pwm.js
│   │   ├── ring_mod.js
│   │   └── hard_sync.js
│   ├── sequencer/          # Sequencer core
│   │   └── pattern.js
│   ├── effects/            # Audio effects
│   │   ├── delay.js
│   │   └── reverb.js
│   └── components/         # UI components
│       ├── index.js            # Barrel export
│       ├── AudioComponent.js   # Base class
│       ├── OscillatorComponent.js
│       ├── FilterComponent.js
│       ├── AdsrComponent.js
│       ├── EffectsComponent.js
│       ├── LfoComponent.js
│       ├── MixerComponent.js
│       ├── SplitterComponent.js
│       ├── SequencerComponent.js
│       └── Knob.js             # Reusable knob control
└── LICENSE
```

## Technologies

- **Web Audio API** - Real-time audio processing
- **ES6 Modules** - Modern JavaScript module system
- **SVG** - Vector graphics for knobs and patch cables
- **CSS3** - Styling with flexbox and grid
- **Canvas API** - Real-time visualization

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 60+ | ✅ Full support |
| Firefox | 55+ | ✅ Full support |
| Edge | 79+ | ✅ Full support |
| Safari | 14+ | ✅ Full support |

## Known Issues

- AudioContext requires user gesture (click keyboard) to start in some browsers
- Some components may produce no sound if not connected to master output
- MIDI support is experimental

## Roadmap: from SID Synth to web DAW

The current application is a modular SID-inspired synthesizer with a 16-step multi-track loop recorder. The long-term goal is a complete browser DAW: linear arrangement, MIDI and audio clips, piano roll, recording, mixer/buses/sends, automation, project recovery, and stem export — while keeping the SID rack as its signature instrument and visual language. WAV export of the live mix is already in (real-time bounce button in the recorder).

The audited, prioritized roadmap and definition of done live in [`docs/TODO.md`](docs/TODO.md). Foundation work delivered: a unified versioned project model (`src/project/`, one `sidSynthProject` snapshot with legacy-key migration), undo/redo command history, musical-time/tempo map, a single transport shared by the rack and recorder (including seek), a minimal arranger canvas (ruler, track lanes, playhead, zoom), and a MIDI clip model where clips render on the timeline and the loop clip carries the track's grid/realtime notes as mini-notes. Clip editing is in place: select, multi-select (Ctrl+click) and range select (Shift+click), drag-move with snap (groups move together), edge-trim, split (S), duplicate (D), loop (L), and delete — all undoable. Timeline markers are in: add at the playhead, seek by clicking, remove with ×, undoable, persisted in the project snapshot. Track mute/solo is in: M/S buttons in recorder rows and arranger track headers, engine-level audibility, undoable and persisted. Track rename is in: double-click a track name or lane label to rename inline, undoable via history. Track reorder is in: ▲/▼ buttons in recorder rows and arranger lane headers, undoable, order persisted across reload. Track color is in: color inputs in recorder rows and arranger lane headers, undoable, persisted across reload. Input monitor is in: MNT buttons in recorder rows and arranger lane headers, undoable, persisted across reload. Lane resize is in: drag the bottom edge of any arranger lane, undoable, height persisted across reload. Track folders/collapse is in: collapse toggles in recorder rows and lane headers, folders hide their children, undoable, persisted across reload. Full-song playback is in: every arranged clip sounds once at its timeline position (the loop clip keeps looping the 16-step pattern), so a song longer than one loop plays linearly through all clips and the arrangement persists and restores. A piano roll is in: selecting any clip shows its notes on a pitch × sixteenth grid where notes can be drawn (auditioned on press, drag and draw), dragged to move (snapped to steps and pitch), edge-trimmed to resize start/duration, and deleted, notes can be marquee box-selected on the grid and moved/deleted as a group (Delete removes every selected note), and a velocity lane below the grid edits each note's velocity (all undoable and persisted, velocity is audible), the grid zooms with the −/+ buttons or Ctrl+wheel, and a snap selector quantizes draw/move/resize to 1/16, 1/8, 1/4 or off). An instrument-track device chain is in: every track routes its voices through an insert chain (delay/reverb with editable parameters, plus an `INS` editor in each recorder row) before the fader, all insert edits are undoable and persisted, and unknown device types are skipped so older/newer saves stay valid. Quantize is in: a Q button snaps note starts to the active snap grid with strength/swing controls (undoable, persisted), a T button transposes note pitches by a semitone interval clamped to the visible range (undoable, persisted), Ctrl+D duplicates the selected notes right after their span (undoable, persisted), an L button extends each note to the next one — monophonic legato (undoable, persisted), and an F button snaps every note's duration to the active snap grid step — fixed length (undoable, persisted); an H button nudges note starts and velocities with random offsets for a performed feel (humanize, undoable, persisted), and a preview button in every operation row auditions the transformation as one pass through the track voice before anything is committed (nothing is saved or pushed onto the history). Recording into the armed track's loop clip now has an OVERDUB/REPLACE mode toggle (REPLACE clears the clip first) and an optional REC Q switch that quantizes captured notes to the grid as they are committed. Step input is in: arming STEP in the piano roll turns the computer keyboard into a musical-typing entry (C3..B4) at an insert cursor that advances by the snap step, with arrow-key cursor moves, Backspace step-back erase, and Esc to exit — every entry undoable like any clip edit. WAV export is in: a WAV button in the recorder bounces the live mix (mute/solo and inserts applied) for the current tempo into a 16-bit stereo RIFF/WAVE file and downloads it.

## License

MIT License - feel free to use this project for learning or building your own synth!

## Acknowledgments

- Inspired by the MOS 6581 SID chip from Commodore 64
- Knob design inspired by classic analog synthesizers
- Built as a modern web implementation of vintage synth architecture

---

**Made with ❤️ using Web Audio API**
