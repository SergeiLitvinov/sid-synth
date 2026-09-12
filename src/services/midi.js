import { noteForMidi } from './notes.js';

// MIDI input service with device selection, per-track channel routing,
// and CC/pitch bend/modulation/sustain support (backlog #174).
//
// Device identity flows end to end: every callback carries the source
// deviceId, and notes held from a disconnected device are reported via
// onDeviceLost so the app can release those exact notes.
//
// Returns an API object with:
//   selectDevice(id)  — connect to a specific MIDI input (null = all)
//   refreshInputs()   — re-enumerate available MIDI devices
//   getInputs()       — list available devices
//   setCallbacks(obj) — { onNoteOn, onNoteOff, onCC, onPitchBend,
//                         onPressure, onProgram, onPanic, onDeviceLost }
//   destroy()         — disconnect all handlers
//
// CC callback: onCC(channel, cc, value, deviceId) — cc is 0-127, value 0-127
// Pitch bend: onPitchBend(channel, value, deviceId) — value is -1.0..1.0
// Channel pressure: onPressure(channel, value, deviceId) — value 0..1.
//   Without an onPressure callback it aliases to CC1 (legacy behavior).
// Program change: onProgram(channel, program, deviceId) — program 0-127.
// Panic: CC123 (all notes off) calls onPanic(channel, deviceId).
// Disconnect: onDeviceLost(deviceId, [{ channel, note }]) lists notes that
//   were held from the removed device and never got a note-off.
export function initMidi({ button, statusEl, ctx, onNoteOn, onNoteOff, onCC, onPitchBend, onPressure, onProgram, onPanic, onDeviceLost }) {
  let midiAccess = null;
  let selectedDeviceId = null;
  const subscribers = new Set();
  let onNoteOnCb = onNoteOn || (() => {});
  let onNoteOffCb = onNoteOff || (() => {});
  let onCCCb = onCC || (() => {});
  let onPitchBendCb = onPitchBend || (() => {});
  let onPressureCb = onPressure || null;
  let onProgramCb = onProgram || (() => {});
  let onPanicCb = onPanic || (() => {});
  let onDeviceLostCb = onDeviceLost || (() => {});
  // deviceId -> Map("channel:note" -> { channel, note }) of held notes.
  const activeNotes = new Map();

  function trackNote(deviceId, channel, note) {
    let dev = activeNotes.get(deviceId);
    if (!dev) { dev = new Map(); activeNotes.set(deviceId, dev); }
    dev.set(channel + ':' + note, { channel, note });
  }

  function untrackNote(deviceId, channel, note) {
    const dev = activeNotes.get(deviceId);
    if (!dev) return;
    dev.delete(channel + ':' + note);
    if (!dev.size) activeNotes.delete(deviceId);
  }

  function handleMessage(deviceId, msg) {
    const [cmd, data1, data2] = msg.data;
    const channel = (cmd & 0x0F) + 1; // 1-based
    const status = cmd & 0xF0;

    if (ctx.state === 'suspended') ctx.resume();

    // Note on
    if (status === 0x90 && data2 > 0) {
      const noteName = noteForMidi(data1);
      if (noteName) {
        trackNote(deviceId, channel, noteName);
        onNoteOnCb(noteName, channel, data2, deviceId);
      }
      return;
    }
    // Note off (0x80, or 0x90 with vel 0)
    if (status === 0x80 || (status === 0x90 && data2 === 0)) {
      const noteName = noteForMidi(data1);
      if (noteName) {
        untrackNote(deviceId, channel, noteName);
        onNoteOffCb(noteName, channel, deviceId);
      }
      return;
    }
    // Control Change (CC)
    if (status === 0xB0) {
      if (data1 === 123) {
        // All notes off: panic. Held notes from every device are
        // unreachable, so drop the tracking (fresh note-ons re-track).
        activeNotes.clear();
        onPanicCb(channel, deviceId);
        return;
      }
      onCCCb(channel, data1, data2, deviceId);
      return;
    }
    // Pitch bend (14-bit: LSB = data1, MSB = data2)
    if (status === 0xE0) {
      const raw = (data2 << 7) | data1; // 0..16383
      const value = (raw - 8192) / 8192; // -1.0..1.0
      onPitchBendCb(channel, value, deviceId);
      return;
    }
    // Channel pressure (aftertouch)
    if (status === 0xD0) {
      if (onPressureCb) onPressureCb(channel, data1 / 127, deviceId);
      else onCCCb(channel, 1, data1, deviceId); // legacy CC1 alias
      return;
    }
    // Program change: single data byte, 0-127.
    if (status === 0xC0) {
      onProgramCb(channel, data1, deviceId);
      return;
    }
  }

  function connectInput(input) {
    if (input._sidBound) return;
    input._sidBound = true;
    input.onmidimessage = (msg) => handleMessage(input.id, msg);
  }

  function disconnectInput(input) {
    if (!input._sidBound) return;
    input._sidBound = false;
    input.onmidimessage = null;
  }

  function connectAll() {
    if (!midiAccess) return;
    midiAccess.inputs.forEach(input => {
      if (!selectedDeviceId || input.id === selectedDeviceId) connectInput(input);
      else disconnectInput(input);
    });
  }

  async function init() {
    if (!navigator.requestMIDIAccess) {
      if (statusEl) { statusEl.textContent = 'NO MIDI'; statusEl.style.color = '#888'; }
      if (button) button.disabled = true;
      return api;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      connectAll();
      updateStatus();
      subscribers.forEach(fn => fn());
      midiAccess.onstatechange = handleStateChange;
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'MIDI ERR'; statusEl.style.color = '#ff4444'; }
    }
    return api;
  }

  // Device hot-plug: release notes held from removed devices (they will
  // never send note-off) and report them so the app releases those voices.
  function handleStateChange() {
    if (midiAccess) {
      const live = new Set();
      midiAccess.inputs.forEach(input => live.add(input.id));
      activeNotes.forEach((notes, deviceId) => {
        if (!live.has(deviceId)) {
          const held = [...notes.values()];
          activeNotes.delete(deviceId);
          if (held.length) {
            try { onDeviceLostCb(deviceId, held); } catch (e) {}
          }
        }
      });
    }
    connectAll();
    updateStatus();
    subscribers.forEach(fn => fn());
  }

  function updateStatus() {
    if (!statusEl || !midiAccess) return;
    const n = midiAccess.inputs.size;
    const sel = selectedDeviceId
      ? [...midiAccess.inputs.values()].find(i => i.id === selectedDeviceId)
      : null;
    if (sel) {
      statusEl.textContent = 'MIDI: ' + sel.name;
      statusEl.style.color = '#4af74a';
    } else if (n > 0) {
      statusEl.textContent = 'MIDI: ' + n + ' device' + (n > 1 ? 's' : '');
      statusEl.style.color = '#4af74a';
    } else {
      statusEl.textContent = 'NO MIDI';
      statusEl.style.color = '#888';
    }
  }

  function getInputs() {
    if (!midiAccess) return [];
    return [...midiAccess.inputs.values()].map(i => ({ id: i.id, name: i.name, manufacturer: i.manufacturer }));
  }

  const api = {
    selectDevice(id) {
      selectedDeviceId = id || null;
      connectAll();
      updateStatus();
    },
    getSelectedDeviceId() { return selectedDeviceId; },
    refreshInputs() {
      connectAll();
      updateStatus();
      return getInputs();
    },
    getInputs,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    setCallbacks(cbs) {
      if (cbs.onNoteOn) onNoteOnCb = cbs.onNoteOn;
      if (cbs.onNoteOff) onNoteOffCb = cbs.onNoteOff;
      if (cbs.onCC) onCCCb = cbs.onCC;
      if (cbs.onPitchBend) onPitchBendCb = cbs.onPitchBend;
      if (cbs.onPressure) onPressureCb = cbs.onPressure;
      if (cbs.onProgram) onProgramCb = cbs.onProgram;
      if (cbs.onPanic) onPanicCb = cbs.onPanic;
      if (cbs.onDeviceLost) onDeviceLostCb = cbs.onDeviceLost;
    },
    destroy() {
      if (midiAccess) midiAccess.inputs.forEach(disconnectInput);
      if (midiAccess) midiAccess.onstatechange = null;
      subscribers.clear();
      if (button) button.removeEventListener('click', init);
    },
  };

  if (button) {
    button.addEventListener('click', init);
  }

  return api;
}
