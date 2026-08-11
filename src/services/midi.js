import { noteForMidi } from './notes.js';

export function initMidi({ button, statusEl, ctx, playNote, stopAll }) {
  if (button && navigator.requestMIDIAccess) {
    button.addEventListener('click', async () => {
      try {
        const midi = await navigator.requestMIDIAccess();
        statusEl.textContent = 'MIDI OK';
        statusEl.style.color = '#4af74a';

        midi.inputs.forEach(input => {
          input.onmidimessage = (msg) => {
            const [cmd, note, vel] = msg.data;
            if (cmd === 144 && vel > 0) {
              if (ctx.state === 'suspended') ctx.resume();
              const noteName = noteForMidi(note);
              if (noteName) playNote(noteName);
            } else if (cmd === 128 || (cmd === 144 && vel === 0)) {
              stopAll();
            }
          };
        });
      } catch(e) {
        statusEl.textContent = 'MIDI ERR';
        statusEl.style.color = '#ff4444';
      }
    });
  } else if (button) {
    button.disabled = true;
    statusEl.textContent = 'NO MIDI';
  }
}
