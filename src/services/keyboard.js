import { NOTES } from './notes.js';

export function createKeyboard({ container, ctx, playNote, stopAll, onNoteOn, onNoteOff }) {
  const activeNotes = new Set();

  function handleKeyDown(n) {
    if (activeNotes.has(n)) return;
    activeNotes.add(n);
    playNote(n);
    if (onNoteOn) onNoteOn(n);
  }

  function handleKeyUp(n) {
    if (!activeNotes.delete(n)) return;
    if (activeNotes.size === 0) stopAll();
    if (onNoteOff) onNoteOff(n);
  }

  if (container) {
    Object.keys(NOTES).forEach(n => {
      const k = document.createElement('div');
      k.className = 'key' + (n.includes('#') ? ' sharp' : '');
      k.textContent = n;
      k.addEventListener('mousedown', () => {
        if (ctx.state === 'suspended') ctx.resume();
        handleKeyDown(n);
      });
      k.addEventListener('mouseup', () => handleKeyUp(n));
      k.addEventListener('mouseleave', () => handleKeyUp(n));
      container.appendChild(k);
    });
  } else {
    console.error('Keyboard element not found!');
  }

  return { activeNotes, handleKeyDown, handleKeyUp };
}
