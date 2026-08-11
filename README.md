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
- Python 3 (for the dev server)

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
```

3. Open your browser and navigate to `http://localhost:3000`

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
│   ├── mockAudioContext.js #   мок Web Audio API
│   └── integration.js      #   E2E против живого приложения (13 шагов, Playwright)
├── src/
│   ├── main.js             # Core logic, drag-drop, visualization
│   ├── oscillator/         # Oscillator implementations
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

## Future Enhancements

- [ ] Full polyphony (per-voice ADSR) — currently mono last-note retrigger
- [ ] More oscillator types (PWM, ring mod UI)
- [ ] More filter types (notch, allpass)
- [ ] Waveform visualization on each component
- [ ] Component minimization/expansion

## License

MIT License - feel free to use this project for learning or building your own synth!

## Acknowledgments

- Inspired by the MOS 6581 SID chip from Commodore 64
- Knob design inspired by classic analog synthesizers
- Built as a modern web implementation of vintage synth architecture

---

**Made with ❤️ using Web Audio API**
