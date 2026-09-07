import { createClipSelection } from './clipSelection.js';
import { createLiveInput } from './liveInput.js';
import { editStepEvent } from '../project/stepEditing.js';
import { TrackVoices } from './voiceEngine.js';
import { defaultInsertParams } from './inserts.js';
import {
  gridToClipEvents, rtToClipEvents, mergeClipEvents,
  clipEventsToGrid, clipEventsToRt, stepTicks, ticksPerSecond,
} from '../project/clipEvents.js';
import { normalizeAudioRef, createAudioEngine } from '../audio/audioEngine.js';

export const STEPS_PER_LOOP = 16;
export const NOTE_BEATS = 4;

function defaultClip(cfg = {}) {
  return {
    id: cfg.id || 'clip_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Clip',
    color: cfg.color || null,
    start: cfg.start === undefined ? 0 : cfg.start,
    length: cfg.length === undefined ? 1920 : cfg.length,
    events: Array.isArray(cfg.events) ? cfg.events.map(ev => ({ ...ev })) : [],
    // Audio reference (M4): { hash, offset, gain, fadeIn, fadeOut } or null.
    // A clip with audio plays the asset at clip.start; MIDI events and audio
    // coexist on one clip (layered), the piano roll only edits the events.
    audio: normalizeAudioRef(cfg.audio),
  };
}

export function defaultTrackConfig(cfg = {}) {
  return {
    id: cfg.id || 'trk_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Track 1',
    color: cfg.color || '#4af74a',
    enabled: cfg.enabled !== false,
    monitor: cfg.monitor !== false,
    muted: !!cfg.muted,
    solo: !!cfg.solo,
    height: cfg.height || null,
    folder: cfg.folder || null,
    collapsed: !!cfg.collapsed,
    wave: cfg.wave || 'square',
    filterType: cfg.filterType || 'none',
    filterFreq: cfg.filterFreq === undefined ? 1200 : cfg.filterFreq,
    filterQ: cfg.filterQ === undefined ? 1 : cfg.filterQ,
    adsr: cfg.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.1 },
    volume: cfg.volume === undefined ? 0.85 : cfg.volume,
    gridNote: cfg.gridNote || 'C4',
    gridDur: cfg.gridDur || 1,
    midiChannel: typeof cfg.midiChannel === 'number' ? cfg.midiChannel : null,
    grid: Array.isArray(cfg.grid) ? cfg.grid.slice() : Array(STEPS_PER_LOOP).fill(null),
    rt: Array.isArray(cfg.rt) ? cfg.rt.map(n => ({ ...n })) : [],
    clips: Array.isArray(cfg.clips) ? cfg.clips.map(defaultClip) : [],
    inserts: Array.isArray(cfg.inserts)
      ? cfg.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
      : [],
  };
}

// Multi-track recorder built on TrackVoices. One 16-step loop (4/4 sixteenths).
// Two event sources per track: a step grid (quantized pattern) and realtime
// notes captured from the keyboard while recording. Both are scheduled with a
// lookahead timer against the Web Audio clock, so they stay sample-accurate.
//
// Grid cells hold `{ note, dur }` (dur in steps, default from track.gridDur) or
// null. Legacy string cells ("C4") are normalized on read, so old saved tracks
// keep working.
export function createTrackEngine(ctx, dest, config = {}) {
  const engine = {
    ctx,
    bpm: config.bpm || 120,
    ppq: config.ppq || 480,
    playbackMode: config.playbackMode === 'song' ? 'song' : 'pattern',
    tracks: [],
    byId: {},
    onTick: config.onTick || null,
    onGridStep: config.onGridStep || null,
    onLoopWrap: config.onLoopWrap || null,
    onStateChange: config.onStateChange || null,
    _nowMs: config.nowMs || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())),
    _timer: null,
    _playing: false,
    _recording: false,
    _startMs: 0,
    _playStartCtx: 0,
    _loopPos: 0,
    _loopCount: 0,
    _cursor: 0,
    _cursorLoopAbs: 0,
    _armed: new Set(),
    _recBuffer: new Map(), // trackId -> open events [{note,start,dur:null}]
    recordMode: config.recordMode || 'overdub', // 'overdub' | 'replace'
    recordQuantize: config.recordQuantize || null, // { grid, strength, swing } | null
    // Clip audio playback (M4): injectable for tests, real engine otherwise.
    // Routes through each track's voice chain (inserts + fader), so mute/solo
    // and insert devices apply to audio exactly like they do to MIDI voices.
    audio: config.audioEngine || createAudioEngine({ ctx, store: config.audioStore || null }),
  };

  engine.stepDur = 60 / engine.bpm / NOTE_BEATS;
  engine.loopDur = engine.stepDur * STEPS_PER_LOOP;

  engine._idCount = 0;
  const clipSelection = createClipSelection({ getTrack: id => engine.byId[id], ppq: engine.ppq, onChange: () => _emitState() });
  engine.getStepClip = clipSelection.getClip;
  engine.getStepGrid = clipSelection.getGrid;
  engine.selectStepClip = clipSelection.select;

  engine.recalcTempo = () => {
    engine.stepDur = 60 / engine.bpm / NOTE_BEATS;
    engine.loopDur = engine.stepDur * STEPS_PER_LOOP;
  };

  engine.setPlaybackMode = (mode) => {
    if (!['song', 'pattern'].includes(mode) || mode === engine.playbackMode) return;
    if (engine._playing) engine.stop();
    engine.playbackMode = mode;
    if (mode === 'song') engine.tracks.forEach(t => {
      if (!t.clips.length && (t.grid.some(Boolean) || t.rt.length)) engine.addClip(t.id, { start: 0 });
    });
    _emitState();
  };

  // ---- MIDI clips -----------------------------------------------------
  // Backlog #9: the loop clip (clips[0], start 0) is the canonical note store.
  // Grid cells + realtime notes are mirrored into its `events` (PPQ ticks), and
  // a clip-first document (events inside the clip, empty grid/rt) is expanded
  // back into grid/rt so the step scheduler plays unchanged.
  const loopMirrors = new WeakMap();
  const mirrorKey = t => JSON.stringify([t.grid, (t.rt || []).map(({ note, start, dur, velocity }) => ({ note, start, dur, velocity }))]);
  function syncLoopClip(t) {
    if (!t.clips || !t.clips.length) return;
    const loop = t.clips.find(c => c.start === 0);
    if (!loop) return;
    const key = mirrorKey(t);
    if (loopMirrors.get(t) === key) return;
    loop.events = mergeClipEvents(
      gridToClipEvents(t.grid, { ppq: engine.ppq }),
      rtToClipEvents(t.rt, { bpm: engine.bpm, ppq: engine.ppq }),
    );
    loopMirrors.set(t, key);
  }

  // ---- track management ------------------------------------------------
  engine.addTrack = (cfg = {}) => {
    let id = cfg.id;
    if (id && engine.byId[id]) throw new Error('Duplicate track id: ' + id);
    if (id) {
      engine._idCount = Math.max(engine._idCount, parseInt(String(id).replace(/\D/g, ''), 10) || 0);
    } else {
      id = 'trk_' + (++engine._idCount);
    }
    const t = defaultTrackConfig({ ...cfg, id });
    // Legacy backing (grid/rt) folds once into a start-0 loop clip so the
    // schedulers never read grid/rt directly anymore.
    if (!t.clips.length && (t.grid.some(Boolean) || t.rt.length)) {
      t.clips.push(defaultClip({ start: 0, events: mergeClipEvents(gridToClipEvents(t.grid, { ppq: engine.ppq }), rtToClipEvents(t.rt, { bpm: engine.bpm, ppq: engine.ppq })) }));
    }
    const loopClip = (t.clips || []).find(c => c.start === 0);
    if (loopClip && (loopClip.events || []).length) {
      const hasGrid = (t.grid || []).some(c => !!c);
      if (!hasGrid && !(t.rt || []).length) {
        t.grid = clipEventsToGrid(loopClip.events, { ppq: engine.ppq });
        t.rt = clipEventsToRt(loopClip.events, { bpm: engine.bpm, ppq: engine.ppq });
      }
      loopMirrors.set(t, mirrorKey(t));
    }
    t.voice = new TrackVoices(engine.ctx, t, dest);
    syncLoopClip(t);
    engine.tracks.push(t);
    engine.byId[t.id] = t;
    _applyAudibility();
    _emitState();
    return t;
  };

  engine.removeTrack = (id) => {
    const t = engine.byId[id];
    if (!t) return;
    const i = engine.tracks.indexOf(t);
    if (i >= 0) engine.tracks.splice(i, 1);
    delete engine.byId[id];
    clipSelection.forget(id);
    engine._armed.delete(id);
    if (engine.activeTrackId === id) engine.activeTrackId = engine.tracks[0]?.id || null;
    _applyAudibility();
    try { t.voice.dispose(); } catch (e) {}
    _emitState();
  };

  // Reorder a track to a new position in the track list (backlog #19). The
  // index is clamped to the list bounds; no-op when the track is missing or
  // already at that position. Returns true when the order changed.
  engine.reorderTrack = (id, toIndex) => {
    const t = engine.byId[id];
    if (!t) return false;
    const from = engine.tracks.indexOf(t);
    if (from < 0) return false;
    const target = Math.max(0, Math.min(Math.round(toIndex), engine.tracks.length - 1));
    if (target === from) return false;
    engine.tracks.splice(from, 1);
    engine.tracks.splice(target, 0, t);
    _emitState();
    return true;
  };

  engine.updateTrack = (id, patch) => {
    const t = engine.byId[id];
    if (!t) return;
    Object.keys(patch).forEach(k => {
      if (k === 'adsr') t.adsr = { ...t.adsr, ...patch.adsr };
      else if (k === 'rt') t.rt = Array.isArray(patch.rt) ? patch.rt.map(n => ({ ...n })) : t.rt;
      else if (k === 'clips') t.clips = Array.isArray(patch.clips) ? patch.clips.map(defaultClip) : t.clips;
      else if (k === 'inserts') t.inserts = Array.isArray(patch.inserts)
        ? patch.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
        : (t.inserts || []);
      else t[k] = patch[k];
    });
    if ('clips' in patch) {
      const loop = t.clips.find(c => c.start === 0);
      if (loop) t.grid = clipEventsToGrid(loop.events || [], { ppq: engine.ppq });
      loopMirrors.set(t, mirrorKey(t));
    } else if ('grid' in patch || 'rt' in patch) syncLoopClip(t);
    _applyAudibility();
    if ('inserts' in patch && t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
  };

  // ---- insert devices (backlog #32) -----------------------------------
  // Insert descriptors are plain data `{ id, type, params }` on the track;
  // TrackVoices rebuilds its audio chain (`insertIn → inserts → trackGain`)
  // whenever the list changes. `updateInsert` only touches params — the chain
  // topology is unchanged, so the live device is updated in place.
  engine.addInsert = (id, type, params) => {
    const t = engine.byId[id];
    if (!t) return null;
    const insert = {
      id: 'ins_' + Math.random().toString(36).slice(2, 8),
      type,
      params: { ...defaultInsertParams(type), ...(params || {}) },
    };
    t.inserts.push(insert);
    if (t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
    return insert;
  };

  engine.removeInsert = (id, index) => {
    const t = engine.byId[id];
    if (!t || !Array.isArray(t.inserts) || !t.inserts[index]) return false;
    t.inserts.splice(index, 1);
    if (t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
    return true;
  };

  engine.updateInsert = (id, index, patch) => {
    const t = engine.byId[id];
    const ins = t && t.inserts && t.inserts[index];
    if (!ins) return false;
    Object.keys(patch || {}).forEach(k => {
      if (k === 'id' || k === 'type') return;
      ins.params[k] = patch[k];
    });
    if (t.voice && t.voice.applyInsert) t.voice.applyInsert(index);
    _emitState();
    return true;
  };

  // ---- mute / solo ------------------------------------------------------
  // Audibility: a track is inaudible when it is muted, or when some other
  // track is soloed (then only the soloed tracks play). `enabled: false`
  // already gates scheduling; mute/solo adjust the track output gain live.
  // Solo semantics: if ANY track has solo=true, only solo tracks are heard.
  engine._anySolo = () => engine.tracks.some(t => t.solo);

  engine.isAudible = (id) => {
    const t = engine.byId[id];
    if (!t || t.muted) return false;
    if (engine._anySolo()) return !!t.solo;
    return true;
  };

  function _applyAudibility() {
    engine.tracks.forEach(t => {
      const target = engine.isAudible(t.id) ? t.volume : 0;
      if (t.voice && t.voice.setGain) t.voice.setGain(target);
    });
  }

  // ---- MIDI clips -----------------------------------------------------
  // A clip is a block of musical time on a track (`start`/`length` in PPQ ticks).
  // Backlog #9 moves grid/rt events inside clip.events; for now clips are the
  // timeline containers the arranger renders.
  engine.addClip = (id, cfg = {}) => {
    const t = engine.byId[id];
    if (!t) return null;
    const clip = defaultClip(cfg);
    t.clips.push(clip);
    if (clip.start === 0 && clip.events.length) {
      t.grid = clipEventsToGrid(clip.events, { ppq: engine.ppq });
      t.rt = [];
      loopMirrors.set(t, mirrorKey(t));
    } else syncLoopClip(t);
    _emitState();
    return clip;
  };

  engine.removeClip = (id, clipId) => {
    const t = engine.byId[id];
    if (!t) return false;
    const i = t.clips.findIndex(c => c.id === clipId);
    if (i < 0) return false;
    if (t.clips[i].start === 0) {
      t.grid = Array(STEPS_PER_LOOP).fill(null);
      t.rt = [];
      loopMirrors.delete(t);
    }
    t.clips.splice(i, 1);
    _emitState();
    return true;
  };

  // Reposition/resize a clip on the timeline (start/length in PPQ ticks).
  engine.moveClip = (id, clipId, patch = {}) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    if (typeof patch.start === 'number') clip.start = Math.max(0, Math.round(patch.start));
    if (typeof patch.length === 'number') clip.length = Math.max(1, Math.round(patch.length));
    _emitState();
    return true;
  };

  // Clip events retain full timing/polyphony. The legacy zero-clip grid is
  // only a compatibility projection; editor selection has its own projection.
  engine.setClipEvents = (id, clipId, events) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    clip.events = (events || []).map(ev => ({ ...ev })).sort((a, b) => (a.start || 0) - (b.start || 0));
    const loop = t.clips.find(c => c.start === 0);
    if (clip === loop) {
      t.grid = clipEventsToGrid(clip.events, { ppq: engine.ppq });
      t.rt = [];
      loopMirrors.set(t, mirrorKey(t));
    }
    _emitState();
    return true;
  };

  // Attach/detach an audio reference on a clip (M4). Null clears it; the
  // piano-roll event editing never touches it.
  engine.setClipAudio = (id, clipId, audio) => {
    const t = engine.byId[id];
    const clip = t && (t.clips || []).find(c => c.id === clipId);
    if (!clip) return false;
    clip.audio = normalizeAudioRef(audio);
    delete clip._scheduledAudio;
    _emitState();
    return true;
  };

  // Split a clip at an absolute timeline tick `atTicks` (must be strictly inside
  // the clip). The clip becomes two clips: the original keeps [start, atTicks),
  // a new clip covers [atTicks, start+length). Events are partitioned by their
  // start tick; events on the right keep their offset from the split point.
  // Returns the new (right) clip, or null when the split point is outside.
  engine.splitClip = (id, clipId, atTicks) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return null;
    const cut = Math.max(clip.start, Math.min(Math.round(atTicks), clip.start + clip.length));
    if (cut <= clip.start || cut >= clip.start + clip.length) return null;
    const splitOffset = cut - clip.start;
    const leftEvents = [];
    const rightEvents = [];
    (clip.events || []).forEach(ev => {
      if (ev.start < splitOffset) leftEvents.push({ ...ev });
      else rightEvents.push({ ...ev, start: ev.start - splitOffset });
    });
    const right = defaultClip({
      name: clip.name,
      color: clip.color,
      start: cut,
      length: clip.start + clip.length - cut,
      events: rightEvents,
      audio: clip.audio ? { ...clip.audio, offset: (clip.audio.offset || 0) + splitOffset / ticksPerSecond(engine.bpm, engine.ppq) } : null,
    });
    clip.length = splitOffset;
    clip.events = leftEvents;
    t.clips.push(right);
    syncLoopClip(t);
    _emitState();
    return right;
  };

  // Duplicate a clip: a copy with the same name/color/events placed immediately
  // after the original. Returns the new clip.
  engine.duplicateClip = (id, clipId) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return null;
    const copy = defaultClip({
      name: clip.name,
      color: clip.color,
      start: clip.start + clip.length,
      length: clip.length,
      events: clip.events,
      audio: clip.audio,
    });
    t.clips.push(copy);
    syncLoopClip(t);
    _emitState();
    return copy;
  };

  // Loop a clip: repeat it `times` times, stacking `times` total occurrences
  // back-to-back starting at the original start. Returns the array of the
  // added copies (empty when times <= 1 or the clip is missing).
  engine.repeatClip = (id, clipId, times) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return [];
    const n = Math.max(1, Math.round(times || 1));
    const copies = [];
    for (let i = 1; i < n; i++) {
      const copy = defaultClip({
        name: clip.name,
        color: clip.color,
        start: clip.start + i * clip.length,
        length: clip.length,
        events: clip.events,
        audio: clip.audio,
      });
      t.clips.push(copy);
      copies.push(copy);
    }
    syncLoopClip(t);
    _emitState();
    return copies;
  };

  engine.selectTrack = (id) => { engine.activeTrackId = id; _emitState(); };
  engine.activeTrackId = engine.activeTrackId || null;

  engine.armTrack = (id, armed) => {
    if (armed) engine._armed.add(id);
    else engine._armed.delete(id);
    _emitState();
  };

  engine.isArmed = (id) => engine._armed.has(id);

  engine.getTracks = () => engine.tracks.map(t => {
    return {
      id: t.id, name: t.name, color: t.color, enabled: t.enabled, monitor: t.monitor, height: t.height || null,
      muted: t.muted, solo: t.solo, folder: t.folder || null, collapsed: !!t.collapsed,
      wave: t.wave, filterType: t.filterType, filterFreq: t.filterFreq, filterQ: t.filterQ,
      adsr: { ...t.adsr }, volume: t.volume, gridNote: t.gridNote, gridDur: t.gridDur,
      midiChannel: typeof t.midiChannel === 'number' ? t.midiChannel : null,
      grid: t.grid.map(c => normalizeCell(c)), rt: t.rt.map(n => ({ ...n })),
      clips: t.clips.map(c => ({ ...c, audio: c.audio ? { ...c.audio } : null, events: (c.events || []).map(ev => ({ ...ev })) })),
      inserts: t.inserts.map(i => ({ id: i.id, type: i.type, params: { ...(i.params || {}) } })),
    };
  });

  // Folders (backlog #23): a track is a folder when other tracks reference it
  // via their `folder` id. Collapsing a folder hides its children; collapsing
  // a track without children hides its own lane content (grid row / clips).
  engine.folderChildren = (id) => engine.tracks.filter(t => t.folder === id);
  engine.visibleTracks = () => engine.tracks.filter(t => {
    if (!t.folder) return true;
    const parent = engine.byId[t.folder];
    return !parent || !parent.collapsed;
  });

  engine.getState = () => ({
    playbackMode: engine.playbackMode,
    playing: engine._playing,
    recording: engine._recording,
    bpm: engine.bpm,
    stepDur: engine.stepDur,
    loopDur: engine.loopDur,
    loopPos: engine._loopPos,
    step: Math.floor((engine._loopPos / engine.stepDur) % STEPS_PER_LOOP),
    activeTrackId: engine.activeTrackId,
  });

// ---- grid editing -----------------------------------------------------
  // Grid cells are `{ note, dur, vel }` or null. `note` is a pitch name like
  // "C4"; `dur` is note length in sixteenth-steps (default 1); `vel` (0-127) is
  // the note velocity the cell was derived from (piano roll, backlog #27).
  function normalizeCell(c) {
    if (!c) return null;
    if (typeof c === 'string') return { note: c, dur: 1 };
    const out = { note: c.note, dur: typeof c.dur === 'number' && c.dur > 0 ? c.dur : 1 };
    if (typeof c.vel === 'number') out.vel = c.vel;
    return out;
  }

  engine.toggleGridStep = (id, step, note, dur) => {
    const t = engine.byId[id];
    if (!t || !Number.isInteger(step) || step < 0 || step >= STEPS_PER_LOOP) return false;
    // The step grid is a projection of clip events: edits always land on a
    // clip (creating the loop clip when the track has none), never on grid.
    let clip = engine.getStepClip(id);
    if (!clip) clip = engine.addClip(id, { start: 0 });
    if (!clip) return false;
    const was = !!engine.getStepGrid(id)[step];
    engine.setClipEvents(id, clip.id, editStepEvent(clip.events, step, {
      note: note || t.gridNote, dur: dur || t.gridDur,
    }, { ppq: engine.ppq, remove: was }));
    return was ? false : engine.getStepGrid(id)[step];
  };

  // Change the pitch and/or duration of an existing grid step.
  engine.setGridStep = (id, step, patch) => {
    const t = engine.byId[id];
    if (!t || !Number.isInteger(step) || step < 0 || step >= STEPS_PER_LOOP) return null;
    let clip = engine.getStepClip(id);
    if (!clip) clip = engine.addClip(id, { start: 0 });
    if (!clip) return null;
    const values = engine.getStepGrid(id)[step] ? patch : { note: t.gridNote, dur: t.gridDur, ...patch };
    engine.setClipEvents(id, clip.id, editStepEvent(clip.events, step, values, { ppq: engine.ppq }));
    return engine.getStepGrid(id)[step];
  };

  engine.setGridNote = (id, note) => {
    const t = engine.byId[id];
    if (t) { t.gridNote = note; _emitState(); }
  };

  engine.setGridDur = (id, dur) => {
    const t = engine.byId[id];
    if (t && typeof dur === 'number' && dur > 0) { t.gridDur = dur; _emitState(); }
  };

  engine.clearTrack = (id) => {
    const t = engine.byId[id];
    const clip = engine.getStepClip(id);
    if (clip) { engine.setClipEvents(id, clip.id, []); return; }
    if (t) { t.grid = Array(STEPS_PER_LOOP).fill(null); t.rt = []; syncLoopClip(t); _emitState(); }
  };

  // ---- transport --------------------------------------------------------
  // Backlog #24: full-song playback. Besides the loop scheduler above, every
  // clip except the loop mirror plays its events once at its absolute timeline
  // position. Per-event `_scheduledLin` flags stop an event from being
  // scheduled twice within one playback session; reset on every start.
  engine._resetLinearPlayback = () => {
    engine.tracks.forEach(t => {
      (t.clips || []).forEach(c => {
        (c.events || []).forEach(ev => delete ev._scheduledLin);
        delete c._scheduledAudio;
      });
    });
  };

  // Mark finished linear events as scheduled up to an absolute tick (seek).
  // After a seek the adapter clears all flags and chases; without this, the
  // scheduler would replay every finished clip from the top (late-pass
  // catch-up cannot tell a seek from timer jitter). Sustained notes stay
  // unflagged — retriggering them is the chase path's job; open notes keep
  // legacy behavior. Audio clips need no marking here: the audio chase
  // claims every started clip itself.
  engine._markPastLinear = (absTick) => {
    engine.tracks.forEach(t => {
      const loopClip = engine.playbackMode === 'pattern' ? (t.clips || []).find(c => c.start === 0) : null;
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        (clip.events || []).forEach(ev => {
          const evStart = typeof ev.start === 'number' ? ev.start : 0;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evDur > 0 && clip.start + evStart + evDur <= absTick) ev._scheduledLin = true;
        });
      });
    });
  };

  // Silence every clip-audio voice (stop, seek, dispose paths). The unified
  // transport adapter calls this alongside voice.allOff.
  engine._stopAudio = () => {
    try {
      if (engine.audio && typeof engine.audio.stopAll === 'function') engine.audio.stopAll();
    } catch (e) {}
  };

  // Chase: fire noteOn for all sustained notes at the given absolute tick.
  // Called after seek so notes that started before the seek point but haven't
  // ended yet are re-triggered with a truncated duration.
  engine.chaseToTick = (absTick) => {
    if (!engine._playing) return;
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    const nowAbs = engine._playStartCtx + ((engine._nowMs() - engine._startMs) / 1000);
    const loopLenTicks = STEPS_PER_LOOP * (engine.ppq / 4);
    engine.tracks.forEach(t => {
      if (engine.byId[t.id].enabled === false) return;
      const loopClip = engine.playbackMode === 'pattern' ? (t.clips || []).find(c => c.start === 0) : null;
      // Loop clip: check events against loop-relative position (ticks)
      if (loopClip) {
        const loopPosTicks = absTick % loopLenTicks;
        (loopClip.events || []).forEach(ev => {
          const evStart = typeof ev.start === 'number' ? ev.start : 0;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evStart <= loopPosTicks && evStart + evDur > loopPosTicks) {
            const remainingTicks = (evStart + evDur) - loopPosTicks;
            const durSec = remainingTicks / tps;
            t.voice.noteOn(ev.note, nowAbs, durSec, ev.velocity);
          }
        });
      }
      // Arranged clips: check events against absolute position (ticks)
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        (clip.events || []).forEach(ev => {
          const evStart = typeof ev.start === 'number' ? ev.start : 0;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          const absStart = clip.start + evStart;
          const absEnd = Math.min(absStart + evDur, clip.start + clip.length);
          if (absStart <= absTick && absEnd > absTick) {
            const remainingTicks = absEnd - absTick;
            const durSec = remainingTicks / tps;
            t.voice.noteOn(ev.note, nowAbs, durSec, ev.velocity);
            ev._scheduledLin = true;
          }
        });
      });
      // Audio clips (M4): restart every started-but-unfinished clip. The flag
      // is claimed even when the buffer is not cached yet, so the scheduler
      // never replays it from the top; playClip trims late decodes to the
      // remainder by itself.
      (t.clips || []).forEach(clip => {
        const ref = clip.audio;
        if (!ref || typeof ref.hash !== 'string' || !ref.hash) return;
        const absSec = clip.start / tps;
        const posSec = absTick / tps;
        if (posSec < absSec) return;
        clip._scheduledAudio = true;
        if (!engine.audio || typeof engine.audio.playClip !== 'function') return;
        engine.audio.playClip({
          hash: ref.hash,
          when: engine._playStartCtx + absSec,
          offset: Math.max(0, ref.offset || 0),
          duration: clip.length / tps,
          gain: ref.gain === undefined ? 1 : ref.gain,
          fadeIn: 0,
          fadeOut: ref.fadeOut || 0,
          destination: t.voice.insertIn,
        });
      });
    });
  };

  engine.play = () => {
    _resumeIfNeeded();
    engine.recalcTempo();
    engine.stopTimer();
    engine._playing = true;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine._cursor = 0;
    engine._startMs = engine._nowMs();
    engine._playStartCtx = engine.ctx.currentTime + 0.03;
    engine._cursorLoopAbs = engine._playStartCtx;
    engine._resetLinearPlayback();
    _emitState();
    _scheduleAhead(0.02);
    engine._timer = setInterval(_tick, 25);
  };

  engine.prepareRecording = () => {
    if (!engine._armed.size && engine.activeTrackId) engine.armTrack(engine.activeTrackId, true);
    if (engine.recordMode === 'replace') {
      const ids = engine._armed.size ? [...engine._armed] : (engine.activeTrackId ? [engine.activeTrackId] : []);
      ids.forEach(id => _clearLoopClip(engine.byId[id]));
    }
    engine._recording = true;
    engine._recBuffer.clear();
    _emitState();
  };

  engine.record = () => {
    engine.prepareRecording();
    if (!engine._playing) engine.play();
  };

  engine.stop = () => {
    engine._recording = false;
    _commitBuffer(true);
    engine.stopTimer();
    engine._playing = false;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
    engine._stopAudio();
    _emitState();
  };

  engine.stopTimer = () => {
    if (engine._timer) { clearInterval(engine._timer); engine._timer = null; }
  };

  function _emitState() {
    if (engine.onStateChange) engine.onStateChange(engine.getState());
  }

  // ---- live notes ------------------------------------------------------
  // Any note-on while the transport runs in record mode is stamped into the
  // armed tracks' realtime buffer; the same note is always monitored through
  // the track voices so the player hears what will be recorded.
  const liveInput = createLiveInput(engine, {
    stampOn: _stampOn, stampOff: _stampOff, emitNote: _emitNote,
  });
  engine.noteOn = liveInput.noteOn;
  engine.noteOff = liveInput.noteOff;

  // Route MIDI CC to matching tracks (by midiChannel).
  engine.routeCC = (channel, cc, value) => {
    const tracks = engine.tracks;
    const matching = tracks.filter(t => t.midiChannel === null || t.midiChannel === channel);
    const norm = value / 127; // 0..1
    matching.forEach(t => {
      if (cc === 1) t.voice.modulation(norm);           // CC1: modulation → filter
      else if (cc === 64) t.voice.sustain(norm >= 0.5); // CC64: sustain pedal
      else if (cc === 7) { t.volume = norm; _applyAudibility(); }         // CC7: volume → fader
    });
  };

  // Route MIDI pitch bend to matching tracks.
  engine.routePitchBend = (channel, value) => {
    const tracks = engine.tracks;
    const matching = tracks.filter(t => t.midiChannel === null || t.midiChannel === channel);
    matching.forEach(t => t.voice.pitchBend(value));
  };

  // ---- piano roll audition (backlog #30) ----------------------------------
  // Preview a note through one specific track's voice — the track the selected
  // clip belongs to — bypassing the global live-note routing (active/armed
  // tracks, monitor gating), so drawing and dragging in the piano roll always
  // auditions the instrument being edited. Respects mute/solo audibility;
  // `dur` (seconds) makes the note self-terminating (used when drawing);
  // `when` (absolute ctx time) schedules ahead for one-pass previews (#40).
  engine.auditionNote = (trackId, note, vel, dur, when) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const t = engine.byId[trackId];
    if (!t || !engine.isAudible(t.id)) return;
    t.voice.noteOn(resolve(note), typeof when === 'number' ? when : engine.ctx.currentTime, dur, vel);
  };

  engine.auditionNoteOff = (trackId, note) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const t = engine.byId[trackId];
    if (!t) return;
    t.voice.noteOff(resolve(note), engine.ctx.currentTime);
  };

  function _emitNote(note) {
    if (engine.onNote) engine.onNote({ note, loopPos: engine._loopPos, loopCount: engine._loopCount });
  }

  function _resumeIfNeeded() {
    if (engine.ctx && engine.ctx.state === 'suspended') {
      try { engine.ctx.resume(); } catch (e) {}
    }
  }

  function _stampOn(t, noteName, velocity = 100) {
    const buf = engine._recBuffer.get(t.id) || [];
    const start = _withinLoop();
    buf.push({ note: noteName, start: Math.max(0, start), dur: null, velocity });
    engine._recBuffer.set(t.id, buf);
  }

  function _stampOff(t, noteName) {
    const buf = engine._recBuffer.get(t.id) || [];
    const idx = buf.map(e => e.note).lastIndexOf(noteName);
    if (idx < 0) return;
    const e = buf[idx];
    const tEnd = _withinLoop();
    let dur = tEnd - e.start;
    if (dur < 0) dur += engine.loopDur;
    e.dur = Math.max(0.03, dur);
  }

  function _withinLoop() {
    return engine._loopPos;
  }

  function _commitBuffer(finalizeHold) {
    engine._recBuffer.forEach((buf, trackId) => {
      const t = engine.byId[trackId];
      if (!t) return;
      const committed = buf
        .filter(e => e.dur !== null)
        .map(e => ({ note: e.note, start: e.start, dur: e.dur, velocity: e.velocity }));
      buf.forEach(e => {
        if (e.dur === null) {
          let dur = engine.loopDur - e.start;
          if (finalizeHold && dur < 0.03 && e.start > 0) dur = 0.03;
          if (dur > 0) committed.push({ note: e.note, start: e.start, dur, velocity: e.velocity });
        }
      });
      if (committed.length) {
        let out = committed;
        if (engine.recordQuantize) {
          const tps = (engine.bpm / 60) * engine.ppq;
          const q = engine.recordQuantize;
          out = committed.map(e => {
            const qd = quantizeTick(e.start * tps, engine.ppq, q.grid, q.strength, q.swing);
            return { ...e, start: qd / tps };
          });
        }
        let clip = t.clips.find(c => c.start === 0);
        if (!clip) {
          // First take on a clipless track: fold any legacy grid/rt backing
          // into the new loop clip so overdub keeps playing it.
          clip = engine.addClip(t.id, { start: 0 });
          if (clip) {
            clip.events = mergeClipEvents(
              gridToClipEvents(t.grid, { ppq: engine.ppq }),
              rtToClipEvents(t.rt, { bpm: engine.bpm, ppq: engine.ppq }),
            );
          }
        }
        if (clip) {
          clip.events = mergeClipEvents(clip.events, rtToClipEvents(out, { bpm: engine.bpm, ppq: engine.ppq }));
          loopMirrors.set(t, mirrorKey(t));
        }
      }
    });
    engine._recBuffer.clear();
    engine.tracks.forEach(syncLoopClip);
  }

  // Clear the loop (start-0) clip so a REPLACE-mode record starts empty —
  // the same clip _commitBuffer writes the take into. Falls back to the
  // legacy backing only when the track has no clips.
  function _clearLoopClip(t) {
    if (!t) return;
    const clip = (t.clips || []).find(c => c.start === 0);
    if (clip) {
      engine.setClipEvents(t.id, clip.id, []);
      return;
    }
    t.grid = t.grid.map(() => null);
    t.rt = [];
    syncLoopClip(t);
  }

  // Snap a recorded note (in PPQ ticks) to the grid; mirrors quantizeStart from
  // src/arranger/quantize.js but kept in the engine layer to avoid a downward
  // import. Used by record quantization (#41) before the note lands on the clip.
  function quantizeTick(start, ppq, grid, strength, swing) {
    grid = grid > 0 ? grid : 1;
    const step = Math.max(1, (ppq / 4) * grid);
    let col = Math.round(start / step);
    if (swing && col % 2 === 1) col += Math.max(0, Math.min(100, swing)) / 100;
    const k = Math.max(0, Math.min(1, strength / 100));
    const target = col * step;
    return Math.max(0, start + (target - start) * k);
  }

  // ---- scheduler ------------------------------------------------------
  function _tick() {
    const elapsed = (engine._nowMs() - engine._startMs) / 1000;
    const loop = Math.floor(elapsed / engine.loopDur);
    const pos = elapsed - loop * engine.loopDur;
    if (loop > engine._loopCount) {
      engine._loopCount = loop;
      if (engine._recording) _commitBuffer(false);
      if (engine.onLoopWrap) engine.onLoopWrap(engine._loopCount);
    }
    engine._loopPos = pos;
    _scheduleAhead(elapsed);
    if (engine.onTick) {
      engine.onTick({
        loopPos: pos,
        step: Math.floor((pos / engine.stepDur) % STEPS_PER_LOOP),
        loopCount: loop,
        playing: true,
      });
    }
  }

  function _scheduleAhead(elapsed) {
    const nowAbs = engine._playStartCtx + elapsed;
    const endAbs = nowAbs + 0.12;

    const scheduleNoteOn = (t, note, timeAbs, durAbs, vel) => {
      if (engine.byId[t.id].enabled === false) return;
      t.voice.noteOn(note, timeAbs, durAbs, vel);
    };

    // --- grid (cursor keeps monotonic advance across loops) ---
    // Reads loop-clip events only: without a start-0 clip there is nothing
    // step-scheduled (legacy grid/rt backing folds into a clip on load).
    let gridLoopAbs = engine._cursorLoopAbs + Math.floor(engine._cursor / STEPS_PER_LOOP) * engine.loopDur;
    // cursor is always < STEPS_PER_LOOP, so gridLoopAbs === _cursorLoopAbs;
    while (gridLoopAbs + engine._cursor * engine.stepDur < endAbs) {
      const timeAbs = gridLoopAbs + engine._cursor * engine.stepDur;
      engine.tracks.forEach(t => {
        if (engine.playbackMode === 'song') return;
        const loopClip = t.clips.find(c => c.start === 0);
        if (!loopClip) return;
        const step = engine.ppq / 4;
        const tps = ticksPerSecond(engine.bpm, engine.ppq);
        loopClip.events.forEach(ev => {
          if (ev.start >= engine._cursor * step && ev.start < (engine._cursor + 1) * step && ev.start < loopClip.length) {
            const duration = Math.min(ev.dur, loopClip.length - ev.start) / tps;
            if (duration > 0) scheduleNoteOn(t, ev.note, gridLoopAbs + ev.start / tps, duration, ev.velocity);
          }
        });
      });
      if (engine.onGridStep) engine.onGridStep(engine._cursor, timeAbs);
      engine._cursor++;
      if (engine._cursor >= STEPS_PER_LOOP) {
        engine._cursor = 0;
        engine._cursorLoopAbs += engine.loopDur;
        gridLoopAbs = engine._cursorLoopAbs;
      }
    }

    // --- arranged clips (backlog #24): linear full-song playback ---------
    // Every clip except the loop mirror (the one the grid/rt loop scheduler
    // plays) sounds its events once, positioned at clip.start + ev.start ticks
    // (constant tempo). Events are only scheduled once per play via the
    // per-event _scheduledLin flag; late passes (timer jitter) catch up by
    // scheduling into the past, which the Web Audio clock plays immediately.
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    engine.tracks.forEach(t => {
      const loopClip = engine.playbackMode === 'pattern' ? (t.clips || []).find(c => c.start === 0) : null;
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        (clip.events || []).forEach(ev => {
          if (ev._scheduledLin) return;
          const absTicks = clip.start + (typeof ev.start === 'number' ? ev.start : 0);
          const absSec = absTicks / tps;
          if (absSec > elapsed + 0.12) return;
          const timeAbs = engine._playStartCtx + absSec;
          const durTicks = Math.min(typeof ev.dur === 'number' ? ev.dur : 0, clip.length - ev.start);
          if (ev.start >= clip.length || (engine.playbackMode === 'song' && (durTicks <= 0 || absSec + durTicks / tps <= elapsed))) {
            ev._scheduledLin = true;
            return;
          }
          if (durTicks > 0) scheduleNoteOn(t, ev.note, timeAbs, durTicks / tps, ev.velocity);
          else scheduleNoteOn(t, ev.note, timeAbs, undefined, ev.velocity);
          ev._scheduledLin = true;
        });
      });
    });

    // --- audio clips (M4): sample-accurate one-shots at clip.start --------
    // A clip with an audio reference plays its asset once per pass, bounded
    // by the clip length. The flag is claimed synchronously so the clip can
    // never double-fire; async decode catch-up inside playClip trims late
    // arrivals to the remainder instead of replaying the past.
    engine.tracks.forEach(t => {
      (t.clips || []).forEach(clip => {
        const ref = clip.audio;
        if (!ref || typeof ref.hash !== 'string' || !ref.hash) return;
        if (clip._scheduledAudio) return;
        const absSec = clip.start / tps;
        const clipLenSec = clip.length / tps;
        if (absSec > elapsed + 0.12) return;
        if (absSec + clipLenSec < elapsed) {
          clip._scheduledAudio = true;
          return;
        }
        clip._scheduledAudio = true;
        if (engine.byId[t.id].enabled === false) return;
        if (!engine.audio || typeof engine.audio.playClip !== 'function') return;
        engine.audio.playClip({
          hash: ref.hash,
          when: engine._playStartCtx + absSec,
          offset: Math.max(0, ref.offset || 0),
          duration: clipLenSec,
          gain: ref.gain === undefined ? 1 : ref.gain,
          fadeIn: ref.fadeIn || 0,
          fadeOut: ref.fadeOut || 0,
          destination: t.voice.insertIn,
        });
      });
    });
  }

  // Test-only: overwrite the clock source with a controllable one.
  engine._setClock = (nowMs) => { engine._nowMs = nowMs; };
  // Test-only: drive the lookahead scheduler manually (no interval).
  engine._tick = _tick;
  // Exposed for the transport adapter to finalize realtime buffers on stop.
  engine._commitBuffer = _commitBuffer;

  engine.dispose = () => {
    engine.stopTimer();
    engine._stopAudio();
    liveInput.clear();
    engine._recording = false;
    engine._playing = false;
    engine.tracks.forEach(t => { try { t.voice.dispose(); } catch (e) {} });
    engine.tracks.length = 0;
    engine.byId = {};
  };

  return engine;
}
