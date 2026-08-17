import { create } from '../oscillator/index.js';
import { noteToFreq } from '../services/notes.js';

const VOICES_PER_TRACK = 8;

function scheduleEnvelope(param, ctx, at, adsr) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(1, at + adsr.a);
  param.linearRampToValueAtTime(adsr.s, at + adsr.a + adsr.d);
}

function scheduleRelease(param, ctx, atEnd, adsr) {
  param.cancelScheduledValues(atEnd);
  param.setValueAtTime(adsr.s, atEnd);
  param.linearRampToValueAtTime(0.0001, atEnd + adsr.r);
  param.setValueAtTime(0, atEnd + adsr.r + 0.01);
}

function resetVoice(param, ctx, at) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(0, at);
}

// Independent voice path per track: osc → filter → env → trackGain → dest.
// Overlapping notes on one track get distinct voices, so envelopes (ANSR)
// behave like a real synth instead of retriggering one shared ADSR.
export class TrackVoices {
  constructor(ctx, track, destination) {
    this.ctx = ctx;
    this.track = track;
    this.trackGain = ctx.createGain();
    this.trackGain.gain.value = 0.85;
    this.trackGain.connect(destination);
    this.setGain(this.track && this.track.volume !== undefined ? this.track.volume : 0.85);
    this.voices = [];
    for (let i = 0; i < VOICES_PER_TRACK; i++) {
      this.voices.push(this._createVoice());
    }
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
    env.connect(this.trackGain);

    return { osc, filter, env, wave: this._wave(), usesFilter, _started: false, activeNote: null, busyUntil: 0 };
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

  noteOn(note, at, dur) {
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const v = this._acquireVoice(at);
    this._armOsc(v, noteName, at);
    this._ensureStarted(v);
    scheduleEnvelope(v.env.gain, this.ctx, at, this.track.adsr);
    v.activeNote = noteName;
    if (dur) {
      const end = at + Math.max(0.03, dur);
      scheduleRelease(v.env.gain, this.ctx, end, this.track.adsr);
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
    scheduleRelease(v.env.gain, this.ctx, at, this.track.adsr);
    v.busyUntil = at + this.track.adsr.r + 0.01;
    v.activeNote = null;
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

  dispose() {
    try {
      this.voices.forEach(v => {
        try { v.osc.stop(); } catch (e) {}
        v.osc.disconnect();
        if (v.filter) v.filter.disconnect();
        v.env.disconnect();
      });
    } catch (e) {}
    this.trackGain.disconnect();
  }
}