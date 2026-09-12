import { clipEventsToGrid } from '../project/clipEvents.js';

// Editor focus is session UI state, not musical data. Keep it separate from
// legacy playback grid/rt so selecting a clip can never rewrite another clip.
export function createClipSelection({ getTrack, ppq, onChange }) {
  const selected = new Map();
  function getClip(trackId) {
    const t = getTrack(trackId);
    if (!t) return null;
    return t.clips.find(c => c.id === selected.get(trackId))
      || t.clips.find(c => c.start === 0) || t.clips[0] || null;
  }
  return {
    getClip,
    select(trackId, clipId) {
      const t = getTrack(trackId);
      if (!t || !t.clips.some(c => c.id === clipId)) return false;
      if (selected.get(trackId) === clipId) return true;
      selected.set(trackId, clipId);
      onChange();
      return true;
    },
    getGrid(trackId) {
      const clip = getClip(trackId);
      if (clip) return clipEventsToGrid(clip.events || [], { ppq, offset: clip.offset || 0 });
      return Array(16).fill(null);
    },
    forget(trackId) { selected.delete(trackId); },
  };
}
