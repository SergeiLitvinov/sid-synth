// Owns note routing and remembers recipients until key-up, even if selection
// or arming changes during a held note. The UI never touches voice instances.
export function createLiveInput(engine, { stampOn, stampOff, emitNote }) {
  const held = new Map();
  const key = (note, channel) => `${channel ?? 'keyboard'}:${note}`;

  function targets(channel) {
    const ids = engine._armed.size ? [...engine._armed]
      : [engine.activeTrackId || engine.tracks[0]?.id];
    return ids.map(id => engine.byId[id]).filter(t => t && t.enabled !== false
      && (channel == null || t.midiChannel == null || t.midiChannel === channel));
  }

  function noteOn(note, { channel = null, velocity = 100 } = {}) {
    if (engine.ctx.state === 'suspended') engine.ctx.resume();
    const name = String(note).toUpperCase();
    const recipients = targets(channel);
    const id = key(name, channel);
    const queue = held.get(id) || [];
    queue.push(recipients.map(t => t.id));
    held.set(id, queue);
    recipients.forEach(t => {
      if (t.monitor) t.voice.noteOn(name, engine.ctx.currentTime, undefined, velocity);
      if (engine._recording && engine._armed.has(t.id)) stampOn(t, name, velocity);
    });
    emitNote(name);
  }

  function noteOff(note, { channel = null } = {}) {
    const name = String(note).toUpperCase();
    const id = key(name, channel);
    const queue = held.get(id);
    const ids = queue?.shift() || targets(channel).map(t => t.id);
    if (!queue?.length) held.delete(id);
    ids.forEach(trackId => {
      const t = engine.byId[trackId];
      if (!t) return;
      t.voice.noteOff(name, engine.ctx.currentTime);
      if (engine._recording) stampOff(t, name);
    });
  }

  return { noteOn, noteOff, clear: () => held.clear() };
}
