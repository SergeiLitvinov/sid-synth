import { noteForMidi } from './notes.js';

// MIDI input service with device selection and per-track channel routing.
//
// Returns an API object with:
//   selectDevice(id) — connect to a specific MIDI input (null = all)
//   refreshInputs()   — re-enumerate available MIDI devices
//   setTrackChannels(fn) — fn(trackId) => channel (1-16) | null (omni)
//   destroy()         — disconnect all handlers
//
// Calls `onNoteOn(noteName)` and `onNoteOff(noteName)` for incoming notes
// that pass the channel filter.
export function initMidi({ button, statusEl, ctx, onNoteOn, onNoteOff }) {
  let midiAccess = null;
  let selectedDeviceId = null;
  let getTrackChannels = null; // fn(trackId) => channel | null
  let onNoteOnCb = onNoteOn || (() => {});
  let onNoteOffCb = onNoteOff || (() => {});

  function handleMessage(msg) {
    const [cmd, note, vel] = msg.data;
    const channel = (msg.data[0] & 0x0F) + 1; // 1-based
    const isNoteOn = (cmd & 0xF0) === 0x90 && vel > 0;
    const isNoteOff = (cmd & 0xF0) === 0x80 || ((cmd & 0xF0) === 0x90 && vel === 0);
    if (!isNoteOn && !isNoteOff) return;

    const noteName = noteForMidi(note);
    if (!noteName) return;

    if (ctx.state === 'suspended') ctx.resume();

    if (isNoteOn) onNoteOnCb(noteName, channel);
    else onNoteOffCb(noteName, channel);
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
    setTrackChannels(fn) { getTrackChannels = fn; },
    setCallbacks(on, off) { if (on) onNoteOnCb = on; if (off) onNoteOffCb = off; },
    destroy() {
      if (midiAccess) midiAccess.inputs.forEach(disconnectInput);
    },
  };

  if (button) {
    button.addEventListener('click', () => init());
  }

  return api;
}
