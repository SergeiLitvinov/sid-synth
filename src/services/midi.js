import { noteForMidi } from './notes.js';

// MIDI input service with device selection, per-track channel routing,
// and CC/pitch bend/modulation/sustain support (backlog #174).
//
// Returns an API object with:
//   selectDevice(id)  — connect to a specific MIDI input (null = all)
//   refreshInputs()   — re-enumerate available MIDI devices
//   getInputs()       — list available devices
//   setCallbacks(obj) — { onNoteOn, onNoteOff, onCC, onPitchBend }
//   destroy()         — disconnect all handlers
//
// CC callback: onCC(channel, cc, value) — cc is 0-127, value 0-127
// Pitch bend: onPitchBend(channel, value) — value is -1.0..1.0
export function initMidi({ button, statusEl, ctx, onNoteOn, onNoteOff, onCC, onPitchBend }) {
  let midiAccess = null;
  let selectedDeviceId = null;
  let onNoteOnCb = onNoteOn || (() => {});
  let onNoteOffCb = onNoteOff || (() => {});
  let onCCCb = onCC || (() => {});
  let onPitchBendCb = onPitchBend || (() => {});

  function handleMessage(msg) {
    const [cmd, data1, data2] = msg.data;
    const channel = (cmd & 0x0F) + 1; // 1-based
    const status = cmd & 0xF0;

    if (ctx.state === 'suspended') ctx.resume();

    // Note on
    if (status === 0x90 && data2 > 0) {
      const noteName = noteForMidi(data1);
      if (noteName) onNoteOnCb(noteName, channel, data2);
      return;
    }
    // Note off (0x80, or 0x90 with vel 0)
    if (status === 0x80 || (status === 0x90 && data2 === 0)) {
      const noteName = noteForMidi(data1);
      if (noteName) onNoteOffCb(noteName, channel);
      return;
    }
    // Control Change (CC)
    if (status === 0xB0) {
      onCCCb(channel, data1, data2);
      return;
    }
    // Pitch bend (14-bit: LSB = data1, MSB = data2)
    if (status === 0xE0) {
      const raw = (data2 << 7) | data1; // 0..16383
      const value = (raw - 8192) / 8192; // -1.0..1.0
      onPitchBendCb(channel, value);
      return;
    }
    // Channel pressure (aftertouch)
    if (status === 0xD0) {
      // Treat as modulation-like expression; CC 1 equivalent
      onCCCb(channel, 1, data1);
      return;
    }
  }

  function connectInput(input) {
    if (input._sidBound) return;
    input._sidBound = true;
    input.onmidimessage = handleMessage;
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
      midiAccess.onstatechange = () => updateStatus();
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'MIDI ERR'; statusEl.style.color = '#ff4444'; }
    }
    return api;
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
    setCallbacks(cbs) {
      if (cbs.onNoteOn) onNoteOnCb = cbs.onNoteOn;
      if (cbs.onNoteOff) onNoteOffCb = cbs.onNoteOff;
      if (cbs.onCC) onCCCb = cbs.onCC;
      if (cbs.onPitchBend) onPitchBendCb = cbs.onPitchBend;
    },
    destroy() {
      if (midiAccess) midiAccess.inputs.forEach(disconnectInput);
    },
  };

  if (button) {
    button.addEventListener('click', () => init());
  }

  return api;
}
