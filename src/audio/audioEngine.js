import { decodeAudioBuffer } from './audioImport.js';

// Clip audio reference attached to timeline clips: which asset, from what
// source offset, at what clip gain, with edge fades. Null clears it.
export function normalizeAudioRef(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.hash !== 'string' || !a.hash) return null;
  return {
    hash: a.hash,
    offset: typeof a.offset === 'number' && a.offset >= 0 ? a.offset : 0,
    gain: typeof a.gain === 'number' && a.gain >= 0 ? a.gain : 1,
    fadeIn: typeof a.fadeIn === 'number' && a.fadeIn >= 0 ? a.fadeIn : 0,
    fadeOut: typeof a.fadeOut === 'number' && a.fadeOut >= 0 ? a.fadeOut : 0,
  };
}

// Sample-accurate audio clip playback (M4): decoded buffers are cached by
// asset hash, each start gets its own BufferSource + gain (clip gain and
// edge fades), and every handle is tracked so stop/seek can silence the
// mix immediately. playClip never rejects — missing or undecodable blobs
// resolve to null so the scheduler stays fire-and-forget.
export function createAudioEngine({ ctx, store } = {}) {
  const buffers = new Map();
  const active = new Set();
  let generation = 0;

  async function ensureBuffer(hash) {
    if (buffers.has(hash)) return buffers.get(hash);
    if (!store || typeof store.get !== 'function') throw new Error('audioEngine: no asset store');
    const rec = await store.get(hash);
    if (!rec || !rec.blob) throw new Error('audioEngine: asset missing in store');
    if (!ctx || typeof ctx.decodeAudioData !== 'function') throw new Error('audioEngine: no audio context');
    const buf = await rec.blob.arrayBuffer();
    const decoded = await decodeAudioBuffer(buf, ctx);
    buffers.set(hash, decoded);
    return decoded;
  }

  function cached(hash) {
    return buffers.get(hash);
  }

  function track(handle) {
    active.add(handle);
    return handle;
  }

  function untrack(handle) {
    active.delete(handle);
  }

  function stopAll() {
    generation++;
    active.forEach(h => {
      try { if (h.source) h.source.onended = null; } catch (e) {}
      try { if (h.source) h.source.stop(); } catch (e) {}
      try { if (h.source) h.source.disconnect(); } catch (e) {}
      try { if (h.gain) h.gain.disconnect(); } catch (e) {}
    });
    active.clear();
  }

  // Schedule one clip voice. `when` is absolute ctx time; when decode lands
  // late, the start slides to now with the offset trimmed by the lateness,
  // so slow storage plays the remainder instead of replaying the past.
  async function playClip({ hash, when, offset = 0, duration, gain = 1, fadeIn = 0, fadeOut = 0, destination } = {}) {
    const gen = generation;
    if (typeof hash !== 'string' || !hash) return null;
    let buf;
    try {
      buf = await ensureBuffer(hash);
    } catch (e) {
      return null;
    }
    if (gen !== generation) return null;
    if (!buf || !(buf.duration > 0)) return null;
    if (!ctx || typeof ctx.createBufferSource !== 'function' || typeof ctx.createGain !== 'function') return null;
    const now = ctx.currentTime;
    let w = typeof when === 'number' ? when : now;
    let off = Math.max(0, offset || 0);
    let dur = typeof duration === 'number' ? duration : buf.duration - off;
    if (w < now) {
      const late = now - w;
      off += late;
      dur -= late;
      w = now;
    }
    if (typeof dur === 'number') dur = Math.min(dur, buf.duration - off);
    else dur = buf.duration - off;
    if (!(dur > 0.01) || !(off >= 0) || !(off < buf.duration)) return null;
    const g = Math.max(0, gain === undefined ? 1 : gain);
    const fi = Math.max(0, fadeIn || 0);
    const fo = Math.max(0, fadeOut || 0);
    let source;
    let gainNode;
    try {
      source = ctx.createBufferSource();
      source.buffer = buf;
      gainNode = ctx.createGain();
      source.connect(gainNode);
      gainNode.connect(destination || ctx.destination);
    } catch (e) {
      return null;
    }
    try {
      const p = gainNode.gain;
      p.cancelScheduledValues(w);
      if (fi > 0) {
        p.setValueAtTime(0, w);
        p.linearRampToValueAtTime(g, w + fi);
      } else {
        p.setValueAtTime(g, w);
      }
      const endT = w + dur;
      if (fo > 0) {
        p.setValueAtTime(g, Math.max(w, endT - fo));
        p.linearRampToValueAtTime(0, endT);
      }
    } catch (e) { /* automation is best-effort; the voice still sounds */ }
    const handle = { hash, source, gain: gainNode, stop: () => {
      try { source.onended = null; } catch (e) {}
      try { source.stop(); } catch (e) {}
      untrack(handle);
    } };
    source.onended = () => untrack(handle);
    track(handle);
    try {
      source.start(w, off, dur);
      source.stop(w + dur + 0.05);
    } catch (e) {
      untrack(handle);
      return null;
    }
    return handle;
  }

  return {
    ensureBuffer,
    cached,
    playClip,
    stopAll,
    activeCount: () => active.size,
    clearCache: () => buffers.clear(),
  };
}
