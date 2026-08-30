import { create } from '../oscillator/index.js';
import { noteToFreq } from '../services/notes.js';
import { createInsert } from './inserts.js';

const VOICES_PER_TRACK = 8;

// vel 0..1 scales the whole envelope (attack peak and sustain); the model
// default velocity is 100, so absent velocity scales to 100/127.
function velocityScale(vel) {
  const v = typeof vel === 'number' ? vel : 100;
  return Math.max(0, Math.min(1, v / 127));
}

function scheduleEnvelope(param, ctx, at, adsr, vel) {
  const scale = velocityScale(vel);
  param.cancelScheduledValues(at);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(scale, at + adsr.a);
  param.linearRampToValueAtTime(adsr.s * scale, at + adsr.a + adsr.d);
}

function scheduleRelease(param, ctx, atEnd, adsr, vel) {
  param.cancelScheduledValues(atEnd);
  param.setValueAtTime(adsr.s * velocityScale(vel), atEnd);
  param.linearRampToValueAtTime(0.0001, atEnd + adsr.r);
  param.setValueAtTime(0, atEnd + adsr.r + 0.01);
}

function resetVoice(param, ctx, at) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(0, at);
}

// Independent voice path per track: osc → filter → env → insert chain → fader
// (backlog #32). The device chain is SID instrument (the voices) → inserts →
// fader: every voice's env feeds `insertIn`, the insert devices are chained
// between `insertIn` and `trackGain` (the fader), and the fader feeds the
// destination (master) — TrackVoices never connects straight to the master
// when inserts are present. Overlapping notes on one track get distinct voices,
// so envelopes (ANSR) behave like a real synth instead of retriggering one
// shared ADSR.
export class TrackVoices {
  constructor(ctx, track, destination) {
    this.ctx = ctx;
    this.track = track;
    this.trackGain = ctx.createGain();
    this.trackGain.gain.value = 0.85;
    this.trackGain.connect(destination);
    this.setGain(this.track && this.track.volume !== undefined ? this.track.volume : 0.85);
    this.insertIn = ctx.createGain();
    this.inserts = []; // live insert devices, chained insertIn -> ... -> trackGain
    this.voices = [];
    for (let i = 0; i < VOICES_PER_TRACK; i++) {
      this.voices.push(this._createVoice());
    }
    this.rebuildChain();
    // CC state (backlog #174): pitch bend, modulation, sustain
    this._pitchBend = 0;      // -1.0..1.0
    this._modulation = 0;     // 0..1
    this._sustain = false;     // sustain pedal held
    this._pitchBendRange = 2;  // semitones (±2 default)
  }

  _wave() {
    const t = this.track;
    return t.wave && t.wave !== 'none' ? t.wave : 'square';
  }

  _filterParams() {
    const t = this.track;
    if (!t.filterType || t.filterType === 'none') return null;
    return { type: t.filterType, freq: t.filterFreq, q: t.filterQ };
  }

  _createVoice() {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    const fp = this._filterParams();
    const usesFilter = !!fp;
    if (fp) {
      filter.type = 'lowpass';
      filter.frequency.value = fp.freq;
      filter.Q.value = fp.q;
    }

    const osc = create(this._wave(), ctx, noteToFreq('C4'));
    osc.connect(usesFilter ? filter : env);
    if (usesFilter) filter.connect(env);
    env.connect(this.insertIn);

    return { osc, filter, env, wave: this._wave(), usesFilter, _started: false, activeNote: null, busyUntil: 0 };
  }

  // Rebuild the insert chain from `this.track.inserts`: voices' `insertIn`
  // feeds the first insert, each insert's output feeds the next, and the last
  // output feeds the fader (`trackGain`). Unknown insert types are skipped, so
  // the chain stays valid even for forward-incompatible saved tracks.
  rebuildChain() {
    try { this.insertIn.disconnect(); } catch (e) {}
    this.inserts.forEach(ins => { try { ins.disconnect(); } catch (e) {} });
    this.inserts = [];
    const specs = (this.track && this.track.inserts) || [];
    let prev = this.insertIn;
    specs.forEach(spec => {
      const dev = createInsert(this.ctx, spec);
      if (!dev) return;
      try { prev.connect(dev.input); } catch (e) {}
      prev = dev.output;
      this.inserts.push(dev);
    });
    try { prev.connect(this.trackGain); } catch (e) {}
  }

  // Push a live insert's descriptor params into its audio device.
  applyInsert(index) {
    const spec = this.track && this.track.inserts && this.track.inserts[index];
    const dev = this.inserts[index];
    if (!spec || !dev || !dev.setParam) return;
    Object.keys(spec.params || {}).forEach(k => {
      try { dev.setParam(k, spec.params[k]); } catch (e) {}
    });
  }

  _ensureStarted(v) {
    if (v._started) return;
    v._started = true;
    try { v.osc.start(); } catch (e) {}
  }

  setParams({ wave, filterType, filterFreq, filterQ }) {
    // Nodes are updated live on note-on; only remembering wave for recreation.
    this.ctx;
  }

  // Live output gain for mute/solo (backlog #17). The envelope per voice stays
  // untouched; only the shared track output fades in/out.
  setGain(value, at) {
    const now = at !== undefined ? at : (this.ctx && this.ctx.currentTime) || 0;
    const target = Math.max(0, Math.min(1, value));
    try {
      this.trackGain.gain.cancelScheduledValues(now);
      this.trackGain.gain.setTargetAtTime(target, now, 0.02);
    } catch (e) {
      this.trackGain.gain.value = target;
    }
  }

  _acquireVoice(at) {
    const now = this.ctx.currentTime;
    let free = this.voices.find(v => v.activeNote === null && v.busyUntil <= now);
    if (!free) {
      free = this.voices.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b));
      resetVoice(free.env.gain, this.ctx, at);
    }
    return free;
  }

  _armOsc(v, note, at) {
    const freq = noteToFreq(note);
    const wave = this._wave();
    if (v.wave !== wave) {
      v.wave = wave;
      const ctx = this.ctx;
      try { v.osc.stop(); } catch (e) {}
      v.osc.disconnect();
      const usesFilter = v.usesFilter;
      // Recreate osc; keep the same filter node and env node.
      const node = create(wave, ctx, freq);
      node.connect(usesFilter ? v.filter : v.env);
      v._started = false;
      v.osc = node;
      this._ensureStarted(v);
    }
    const fp = this._filterParams();
    const wantsFilter = !!fp;
    if (v.usesFilter !== wantsFilter) {
      // Re-route between filter and env when filter type toggles.
      v.usesFilter = wantsFilter;
      try { v.osc.disconnect(); } catch (e) {}
      try {
        v.osc.connect(wantsFilter ? v.filter : v.env);
        if (wantsFilter) v.filter.connect(v.env);
      } catch (e) {}
    }
    if (v.filter) {
      if (fp) {
        v.filter.type = fp.type;
        try { v.filter.frequency.setValueAtTime(fp.freq, at); } catch (e) {}
        try { v.filter.Q.setValueAtTime(fp.q, at); } catch (e) {}
      } else {
        try { v.filter.frequency.setValueAtTime(20000, at); } catch (e) {}
        try { v.filter.Q.setValueAtTime(0, at); } catch (e) {}
      }
    }
    if (v.osc && v.osc.frequency) {
      try { v.osc.frequency.setValueAtTime(freq, at); } catch (e) {}
    }
  }

  noteOn(note, at, dur, vel) {
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const v = this._acquireVoice(at);
    this._armOsc(v, noteName, at);
    this._ensureStarted(v);
    v.velScale = velocityScale(vel);
    v._sustainHeld = false;
    scheduleEnvelope(v.env.gain, this.ctx, at, this.track.adsr, vel);
    // Apply current pitch bend to newly armed oscillator (backlog #174)
    if (this._pitchBend !== 0 && v.osc && v.osc.frequency) {
      const semitones = this._pitchBend * this._pitchBendRange;
      const freq = noteToFreq(noteName) * Math.pow(2, semitones / 12);
      try { v.osc.frequency.setValueAtTime(freq, at); } catch (e) {}
    }
    v.activeNote = noteName;
    if (dur) {
      const end = at + Math.max(0.03, dur);
      scheduleRelease(v.env.gain, this.ctx, end, this.track.adsr, vel);
      v.busyUntil = end + this.track.adsr.r + 0.01;
      v.activeNote = null;
    } else {
      v.busyUntil = Infinity;
    }
  }

  noteOff(note, at) {
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const v = this.voices.find(x => x.activeNote === noteName);
    if (!v) return;
    // Sustain pedal (backlog #174): hold the voice until sustain is released
    if (this._sustain) {
      v._sustainHeld = true;
      return;
    }
    scheduleRelease(v.env.gain, this.ctx, at, this.track.adsr, v.velScale);
    v.busyUntil = at + this.track.adsr.r + 0.01;
    v.activeNote = null;
    v.velScale = undefined;
  }

  allOff(at) {
    this.voices.forEach(v => {
      if (v.activeNote !== null || v.busyUntil > at) {
        try {
          const g = v.env.gain;
          const when = Math.max(at, this.ctx.currentTime);
          g.cancelScheduledValues(when);
          g.setValueAtTime(g.value > 0 ? g.value : 0, when);
          g.linearRampToValueAtTime(0.0001, when + this.track.adsr.r);
          g.setValueAtTime(0, when + this.track.adsr.r + 0.01);
        } catch (e) {}
        v.activeNote = null;
        v.busyUntil = 0;
      }
    });
  }

  activeVoices(at) {
    return this.voices.filter(v => v.activeNote !== null || v.busyUntil > at).length;
  }

  // Pitch bend (backlog #174): value -1.0..1.0 shifts active voices by
  // _pitchBendRange semitones. Applied to oscillator frequency in-place.
  pitchBend(value) {
    this._pitchBend = Math.max(-1, Math.min(1, value));
    const now = this.ctx.currentTime;
    this.voices.forEach(v => {
      if (v.activeNote && v.osc && v.osc.frequency) {
        const baseFreq = noteToFreq(v.activeNote);
        const semitones = this._pitchBend * this._pitchBendRange;
        const freq = baseFreq * Math.pow(2, semitones / 12);
        try { v.osc.frequency.setValueAtTime(freq, now); } catch (e) {}
      }
    });
  }

  // Modulation wheel (CC1, backlog #174): value 0..1 scales the filter
  // frequency — 0 = track default, 1 = full cutoff (20000 Hz).
  modulation(value) {
    this._modulation = Math.max(0, Math.min(1, value));
    const now = this.ctx.currentTime;
    const fp = this._filterParams();
    this.voices.forEach(v => {
      if (v.filter) {
        const base = fp ? fp.freq : 20000;
        const target = base + this._modulation * (20000 - base);
        try { v.filter.frequency.setTargetAtTime(target, now, 0.02); } catch (e) {}
      }
    });
  }

  // Sustain pedal (CC64, backlog #174): when held, noteOff does not release;
  // when released, all voices that were held get released.
  sustain(held) {
    const wasSustain = this._sustain;
    this._sustain = !!held;
    if (wasSustain && !this._sustain) {
      // Release all held voices
      const now = this.ctx.currentTime;
      this.voices.forEach(v => {
        if (v._sustainHeld) {
          scheduleRelease(v.env.gain, this.ctx, now, this.track.adsr, v.velScale);
          v.busyUntil = now + this.track.adsr.r + 0.01;
          v.activeNote = null;
          v.velScale = undefined;
          v._sustainHeld = false;
        }
      });
    }
  }

  getSustain() { return this._sustain; }
  getPitchBend() { return this._pitchBend; }
  getModulation() { return this._modulation; }

  dispose() {
    try {
      this.voices.forEach(v => {
        try { v.osc.stop(); } catch (e) {}
        v.osc.disconnect();
        if (v.filter) v.filter.disconnect();
        v.env.disconnect();
      });
    } catch (e) {}
    try { this.insertIn.disconnect(); } catch (e) {}
    this.inserts.forEach(ins => { try { ins.disconnect(); } catch (e) {} });
    this.trackGain.disconnect();
  }
}