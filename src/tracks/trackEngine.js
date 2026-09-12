import { createClipSelection } from './clipSelection.js';
import { createLiveInput } from './liveInput.js';
import { editStepEvent } from '../project/stepEditing.js';
import { TrackVoices } from './voiceEngine.js';
import { defaultInsertParams } from './inserts.js';
import {
  gridToClipEvents, rtToClipEvents, mergeClipEvents,
  stepTicks, ticksPerSecond,
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
    // Source offset (ticks): the clip windows its events to
    // [offset, offset + length). Trim/split adjust bounds + offset and
    // never rewrite events; notes starting left of the window stay silent.
    offset: typeof cfg.offset === 'number' && cfg.offset >= 0 ? cfg.offset : 0,
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
    clips: Array.isArray(cfg.clips) ? cfg.clips.map(defaultClip) : [],
    inserts: Array.isArray(cfg.inserts)
      ? cfg.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
      : [],
  };
}

// Multi-track recorder built on TrackVoices. The loop clip (start 0) is the
// canonical note store: recording, step edits and the scheduler read and
// write its `events` (PPQ ticks), scheduled with a lookahead timer against
// the Web Audio clock for sample accuracy. The 16-step grid is a pure
// projection (clipSelection.getGrid); gridNote/gridDur are only defaults
// for new steps. Legacy string cells ("C4") normalize on clip import, so
// old saved tracks keep working through the load-time fold.
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
    _emitState();
  };

  // ---- MIDI clips -----------------------------------------------------
  // The loop clip (start 0) is the canonical note store: recording, step
  // edits and the scheduler all read and write its `events` (PPQ ticks).
  // Tracks carry no grid/rt fields; legacy documents fold them into a loop
  // clip once, at the parse boundary (serialize) or addTrack (raw configs).

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
    // Legacy backing folds once into a start-0 loop clip (read from cfg:
    // the model no longer carries grid/rt fields).
    if (!t.clips.length) {
      const legacyGrid = Array.isArray(cfg.grid) ? cfg.grid : [];
      const legacyRt = Array.isArray(cfg.rt) ? cfg.rt : [];
      if (legacyGrid.some(Boolean) || legacyRt.length) {
        t.clips.push(defaultClip({ start: 0, events: mergeClipEvents(gridToClipEvents(legacyGrid, { ppq: engine.ppq }), rtToClipEvents(legacyRt, { bpm: engine.bpm, ppq: engine.ppq })) }));
      }
    }
    t.voice = new TrackVoices(engine.ctx, t, dest);
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
      else if (k === 'grid' || k === 'rt') { /* legacy backing removed: clips carry the notes */ }
      else if (k === 'clips') t.clips = Array.isArray(patch.clips) ? patch.clips.map(defaultClip) : t.clips;
      else if (k === 'inserts') t.inserts = Array.isArray(patch.inserts)
        ? patch.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
        : (t.inserts || []);
      else t[k] = patch[k];
    });
    _applyAudibility();
    if ('inserts' in patch && t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
    if ('clips' in patch) engine._rescheduleTrack(id);
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
    _emitState();
    engine._rescheduleTrack(id);
    return clip;
  };

  engine.removeClip = (id, clipId) => {
    const t = engine.byId[id];
    if (!t) return false;
    const i = t.clips.findIndex(c => c.id === clipId);
    if (i < 0) return false;
    t.clips.splice(i, 1);
    _emitState();
    engine._rescheduleTrack(id);
    return true;
  };

  // Reposition/resize a clip on the timeline (start/length in PPQ ticks).
  // `offset` is only honored when explicitly patched (trim gestures pass it
  // to keep content pinned while the left edge moves; plain moves and undo
  // leave it untouched unless included).
  engine.moveClip = (id, clipId, patch = {}) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    if (typeof patch.start === 'number') clip.start = Math.max(0, Math.round(patch.start));
    if (typeof patch.length === 'number') clip.length = Math.max(1, Math.round(patch.length));
    if (typeof patch.offset === 'number') clip.offset = Math.max(0, Math.round(patch.offset));
    _emitState();
    engine._rescheduleTrack(id);
    return true;
  };

  // Clip events retain full timing/polyphony. The legacy zero-clip grid is
  // only a compatibility projection; editor selection has its own projection.
  engine.setClipEvents = (id, clipId, events) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    clip.events = (events || []).map(ev => ({ ...ev })).sort((a, b) => (a.start || 0) - (b.start || 0));
    _emitState();
    engine._rescheduleTrack(id);
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

  // Split a clip at an absolute timeline tick `atTicks` (must be strictly
  // inside). Nondestructive: both halves keep the full event list — the left
  // half shortens its window, the right half advances its offset past the
  // cut. Playback windows events by [offset, offset + length), so a note
  // crossing the cut sounds truncated in the left half and stays silent in
  // the right (explicit cut policy: notes never span clips).
  // Returns the new (right) clip, or null when the split point is outside.
  engine.splitClip = (id, clipId, atTicks) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return null;
    const cut = Math.max(clip.start, Math.min(Math.round(atTicks), clip.start + clip.length));
    if (cut <= clip.start || cut >= clip.start + clip.length) return null;
    const splitOffset = cut - clip.start;
    const baseOffset = clip.offset || 0;
    const right = defaultClip({
      name: clip.name,
      color: clip.color,
      start: cut,
      length: clip.start + clip.length - cut,
      offset: baseOffset + splitOffset,
      events: (clip.events || []).map(ev => ({ ...ev })),
      audio: clip.audio ? { ...clip.audio, offset: (clip.audio.offset || 0) + splitOffset / ticksPerSecond(engine.bpm, engine.ppq) } : null,
    });
    clip.length = splitOffset;
    t.clips.push(right);
    _emitState();
    engine._rescheduleTrack(id);
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
    _emitState();
    engine._rescheduleTrack(id);
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
    _emitState();
    engine._rescheduleTrack(id);
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
// The 16-step grid is a projection of the step clip's events
// (clipSelection.getGrid); edits below always land on clip events.

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
    }, { ppq: engine.ppq, offset: clip.offset || 0, remove: was }));
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
    engine.setClipEvents(id, clip.id, editStepEvent(clip.events, step, values, { ppq: engine.ppq, offset: clip.offset || 0 }));
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
    if (!t) return;
    const clip = engine.getStepClip(id);
    if (clip) engine.setClipEvents(id, clip.id, []);
    _emitState();
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

  // Reschedule one track after an edit during playback (P0 edit-chase):
  // silence stale voices, drop scheduling flags so the new state schedules
  // from now, retire finished events, and chase sustained ones. Other tracks
  // keep flowing untouched. No-op while stopped.
  engine._rescheduleTrack = (id) => {
    if (!engine._playing) return;
    const t = engine.byId[id];
    if (!t) return;
    t.voice.allOff(engine.ctx.currentTime);
    (t.clips || []).forEach(c => (c.events || []).forEach(ev => delete ev._scheduledLin));
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    const posTicks = ((engine._nowMs() - engine._startMs) / 1000) * tps;
    const loopClip = engine.playbackMode === 'pattern' ? (t.clips || []).find(c => c.start === 0) : null;
    const stepClip = engine.playbackMode === 'pattern' ? engine.getStepClip(t.id) : null;
    (t.clips || []).forEach(clip => {
      if (clip === loopClip || clip === stepClip) return;
      const offset = clip.offset || 0;
      (clip.events || []).forEach(ev => {
        const evStart = (typeof ev.start === 'number' ? ev.start : 0) - offset;
        const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
        if (evStart < 0 || evStart >= clip.length) return;
        if (evDur > 0 && clip.start + evStart + evDur <= posTicks) ev._scheduledLin = true;
      });
    });
    engine.chaseToTick(posTicks, [id]);
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
      const stepClip = engine.playbackMode === 'pattern' ? engine.getStepClip(t.id) : null;
      (t.clips || []).forEach(clip => {
        if (clip === loopClip || clip === stepClip) return;
        const offset = clip.offset || 0;
        (clip.events || []).forEach(ev => {
          const evStart = (typeof ev.start === 'number' ? ev.start : 0) - offset;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evStart < 0 || evStart >= clip.length) return;
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
  // ended yet are re-triggered with a truncated duration. `trackIds` limits
  // the chase to edited tracks (edit-during-playback rescheduling).
  engine.chaseToTick = (absTick, trackIds) => {
    if (!engine._playing) return;
    const only = Array.isArray(trackIds) ? new Set(trackIds) : null;
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    const nowAbs = engine._playStartCtx + ((engine._nowMs() - engine._startMs) / 1000);
    const loopLenTicks = STEPS_PER_LOOP * (engine.ppq / 4);
    engine.tracks.forEach(t => {
      if (only && !only.has(t.id)) return;
      if (engine.byId[t.id].enabled === false) return;
      // Step clip loop region: check events against loop-relative position.
      const loopClip = engine.playbackMode === 'pattern' ? engine.getStepClip(t.id) : null;
      if (loopClip) {
        const loopPosTicks = absTick % loopLenTicks;
        const offset = loopClip.offset || 0;
        (loopClip.events || []).forEach(ev => {
          const evStart = (typeof ev.start === 'number' ? ev.start : 0) - offset;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evStart < 0 || evStart >= loopClip.length) return;
          if (evStart <= loopPosTicks && evStart + Math.min(evDur, loopClip.length - evStart) > loopPosTicks) {
            const remainingTicks = evStart + Math.min(evDur, loopClip.length - evStart) - loopPosTicks;
            const durSec = remainingTicks / tps;
            t.voice.noteOn(ev.note, nowAbs, durSec, ev.velocity);
          }
        });
      }
      // Arranged clips: check events against absolute position (ticks).
      // The step clip is chased loop-relative above; the start-0 clip never
      // sounds in pattern mode, so chasing it would conjure phantom notes.
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        if (engine.playbackMode === 'pattern' && clip.start === 0) return;
        const offset = clip.offset || 0;
        (clip.events || []).forEach(ev => {
          const evStart = (typeof ev.start === 'number' ? ev.start : 0) - offset;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evStart < 0 || evStart >= clip.length) return;
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
        let clip = engine.getStepClip(trackId);
        if (!clip) clip = engine.addClip(t.id, { start: 0 });
        if (clip) {
          clip.events = mergeClipEvents(clip.events, rtToClipEvents(out, { bpm: engine.bpm, ppq: engine.ppq }));
        }
      }
    });
    engine._recBuffer.clear();
  }

  // Clear the selected step clip so a REPLACE-mode record starts empty —
  // the same clip _commitBuffer writes the take into.
  function _clearLoopClip(t) {
    if (!t) return;
    const clip = engine.getStepClip(t.id);
    if (clip) engine.setClipEvents(t.id, clip.id, []);
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
    // Plays the selected step clip by stable ID (P0 pattern model): the
    // selection falls back to the start-0 clip, then the first available.
    let gridLoopAbs = engine._cursorLoopAbs + Math.floor(engine._cursor / STEPS_PER_LOOP) * engine.loopDur;
    // cursor is always < STEPS_PER_LOOP, so gridLoopAbs === _cursorLoopAbs;
    while (gridLoopAbs + engine._cursor * engine.stepDur < endAbs) {
      const timeAbs = gridLoopAbs + engine._cursor * engine.stepDur;
      engine.tracks.forEach(t => {
        if (engine.playbackMode === 'song') return;
        const stepClip = engine.getStepClip(t.id);
        if (!stepClip) return;
        const step = engine.ppq / 4;
        const tps = ticksPerSecond(engine.bpm, engine.ppq);
        const offset = stepClip.offset || 0;
        stepClip.events.forEach(ev => {
          // Windowed position: events sound only inside [offset, offset+length).
          const pos = (typeof ev.start === 'number' ? ev.start : 0) - offset;
          if (pos < 0 || pos >= stepClip.length) return;
          if (pos >= engine._cursor * step && pos < (engine._cursor + 1) * step) {
            const duration = Math.min(ev.dur, stepClip.length - pos) / tps;
            if (duration > 0) scheduleNoteOn(t, ev.note, gridLoopAbs + pos / tps, duration, ev.velocity);
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
    // Every clip except the loop mirror and the selected step clip (both
    // played by the step loop in pattern mode) sounds its events once,
    // positioned at clip.start + (ev.start - offset) ticks (constant
    // tempo); events outside the [offset, offset + length) window never
    // sound. Events are only scheduled once per play via the per-event
    // _scheduledLin flag; late passes (timer jitter) catch up by scheduling
    // into the past, which the Web Audio clock plays immediately.
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    engine.tracks.forEach(t => {
      const loopClip = engine.playbackMode === 'pattern' ? (t.clips || []).find(c => c.start === 0) : null;
      const stepClip = engine.playbackMode === 'pattern' ? engine.getStepClip(t.id) : null;
      (t.clips || []).forEach(clip => {
        if (clip === loopClip || clip === stepClip) return;
        (clip.events || []).forEach(ev => {
          if (ev._scheduledLin) return;
          const offset = clip.offset || 0;
          const relStart = (typeof ev.start === 'number' ? ev.start : 0) - offset;
          if (relStart < 0 || relStart >= clip.length) {
            ev._scheduledLin = true;
            return;
          }
          const absTicks = clip.start + relStart;
          const absSec = absTicks / tps;
          if (absSec > elapsed + 0.12) return;
          const timeAbs = engine._playStartCtx + absSec;
          const durTicks = Math.min(typeof ev.dur === 'number' ? ev.dur : 0, clip.length - relStart);
          if (engine.playbackMode === 'song' && (durTicks <= 0 || absSec + durTicks / tps <= elapsed)) {
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
