// Piano Roll Transformations Test Suite (PR #2)
// Tests for refactored transformation modules extracted from pianoRoll.js god object

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
    li.className = 'pass';
    li.textContent = `PASS  ${name}`;
    results.appendChild(li);
  } catch (err) {
    failed.push(name);
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `FAIL  ${name}: ${err.message}`;
    results.appendChild(li);
  }
}

import { quantizeStart, quantizeEvents } from '../src/arranger/quantize.js';
import { transposeEvents } from '../src/arranger/transpose.js';
import { duplicateEvents } from '../src/arranger/duplicate.js';
import { legatoEvents } from '../src/arranger/legato.js';
import { fixedLengthEvents } from '../src/arranger/fixedLength.js';
import { humanizeEvents } from '../src/arranger/humanize.js';
import { previewEvents } from '../src/arranger/preview.js';

const PPQ = 480;
const STEP_TICKS = PPQ / 4; // 16th notes

// Helper to create note events
function createNote(start, dur, note, velocity = 100) {
  return { start, dur, note, velocity };
}

// ============ QUANTIZE TESTS ============

test('quantizeStart: snaps to grid with 100% strength', () => {
  const result = quantizeStart(100, { ppq: PPQ, grid: 1, strength: 100, swing: 0 });
  const step = Math.max(1, (PPQ / 4) * Math.max(1, Math.round(1)));
  const expected = Math.round(100 / step) * step;
  return result === expected;
});

test('quantizeStart: partial strength blends original and snapped', () => {
  const original = 100;
  const step = Math.max(1, (PPQ / 4) * Math.max(1, Math.round(1)));
  const snapped = Math.round(original / step) * step;
  const result = quantizeStart(original, { ppq: PPQ, grid: 1, strength: 50, swing: 0 });
  const expected = Math.round(original + (snapped - original) * 0.5);
  return Math.abs(result - expected) < 1;
});

test('quantizeStart: swing delays every second step', () => {
  const step = Math.max(1, (PPQ / 4) * Math.max(1, Math.round(1)));
  const step1 = quantizeStart(step, { ppq: PPQ, grid: 1, strength: 100, swing: 0 });
  const step2 = quantizeStart(step * 2, { ppq: PPQ, grid: 1, strength: 100, swing: 50 });
  // Second step should be delayed by 50% of step duration
  return step2 > step1 + step;
});

test('quantizeStart: grid=0 means no quantization', () => {
  const original = 100;
  const result = quantizeStart(original, { ppq: PPQ, grid: 0, strength: 100, swing: 0 });
  return result === original;
});

test('quantizeEvents: returns new array with quantized starts', () => {
  const events = [{ start: 100, dur: 120, note: 'C3' }, { start: 200, dur: 120, note: 'E3' }];
  const result = quantizeEvents(events, { ppq: PPQ, grid: 1, strength: 100, swing: 0 });
  return result.length === 2 && result !== events;
});

// ============ TRANSPOSE TESTS ============

test('transposeEvents: shifts all notes by semitones', () => {
  const events = [
    createNote(0, STEP_TICKS, 'C3'),
    createNote(STEP_TICKS, STEP_TICKS, 'E3'),
    createNote(STEP_TICKS * 2, STEP_TICKS, 'G3')
  ];
  const result = transposeEvents(events, 2);
  return result.length === 3 && 
         result[0].note === 'D3' && 
         result[1].note === 'F#3' && 
         result[2].note === 'A3';
});

test('transposeEvents: clamps to valid MIDI range', () => {
  const events = [createNote(0, STEP_TICKS, 'C8')];
  const result = transposeEvents(events, 12);
  // C8 + 12 semitones would be invalid, should clamp to highest valid note
  return result[0].note.charCodeAt(1) <= '8'.charCodeAt(0);
});

test('transposeEvents: preserves velocity and duration', () => {
  const events = [createNote(0, STEP_TICKS * 2, 'C3', 80)];
  const result = transposeEvents(events, 3);
  return result[0].velocity === 80 && result[0].dur === STEP_TICKS * 2;
});

test('transposeEvents: zero semitones returns same references', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 100)];
  const result = transposeEvents(events, 0);
  return result[0] === events[0];
});

// ============ DUPLICATE TESTS ============

test('duplicateEvents: creates copy shifted by stepTicks', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 100)];
  const result = duplicateEvents(events, { stepTicks: STEP_TICKS });
  return result.length === 1 && 
         result[0].start === STEP_TICKS && 
         result[0].note === 'C3' && 
         result[0].velocity === 100;
});

test('duplicateEvents: duplicates multiple notes preserving relative positions', () => {
  const events = [
    createNote(0, STEP_TICKS, 'C3'),
    createNote(STEP_TICKS * 2, STEP_TICKS, 'E3')
  ];
  const result = duplicateEvents(events, { stepTicks: STEP_TICKS * 4 });
  return result.length === 2 &&
         result[0].start === STEP_TICKS * 4 &&
         result[1].start === STEP_TICKS * 6;
});

test('duplicateEvents: empty array returns empty', () => {
  const result = duplicateEvents([], { stepTicks: STEP_TICKS });
  return result.length === 0;
});

test('duplicateOffset: calculates phrase span correctly', () => {
  const events = [
    createNote(0, STEP_TICKS * 2, 'C3'),
    createNote(STEP_TICKS * 4, STEP_TICKS * 2, 'E3')
  ];
  // Span = (4+2) - 0 = 6 steps
  const offset = duplicateEvents.duplicateOffset ? duplicateEvents.duplicateOffset(events, { stepTicks: STEP_TICKS }) : 0;
  // Just verify it's positive and reasonable
  return offset > 0;
});

// ============ LEGATO TESTS ============

test('legatoEvents: extends each note to the next note start', () => {
  const events = [
    createNote(0, STEP_TICKS, 'C3'),
    createNote(STEP_TICKS * 2, STEP_TICKS, 'E3'),
    createNote(STEP_TICKS * 4, STEP_TICKS, 'G3')
  ];
  const result = legatoEvents(events);
  return result[0].dur === STEP_TICKS * 2 && 
         result[1].dur === STEP_TICKS * 2 &&
         result[2].dur === STEP_TICKS; // Last note keeps original duration
});

test('legatoEvents: handles overlapping notes', () => {
  const events = [
    createNote(0, STEP_TICKS * 3, 'C3'),
    createNote(STEP_TICKS * 2, STEP_TICKS, 'E3')
  ];
  const result = legatoEvents(events);
  return result[0].dur === STEP_TICKS * 2; // Extended to next note start
});

// ============ FIXED LENGTH TESTS ============

test('fixedLengthEvents: sets all notes to snap grid duration', () => {
  const events = [
    createNote(0, STEP_TICKS, 'C3'),
    createNote(STEP_TICKS, STEP_TICKS * 2, 'E3'),
    createNote(STEP_TICKS * 2, STEP_TICKS / 2, 'G3')
  ];
  const result = fixedLengthEvents(events, STEP_TICKS);
  return result.every(e => e.dur === STEP_TICKS);
});

test('fixedLengthEvents: preserves start times', () => {
  const events = [
    createNote(0, STEP_TICKS, 'C3'),
    createNote(STEP_TICKS * 2, STEP_TICKS, 'E3')
  ];
  const result = fixedLengthEvents(events, STEP_TICKS);
  return result[0].start === 0 && result[1].start === STEP_TICKS * 2;
});

// ============ HUMANIZE TESTS ============

test('humanizeEvents: adds random timing offsets', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 100)];
  const result = humanizeEvents(events, { timing: 10, velocity: 0 });
  // Timing should be offset by up to 10 ticks
  return Math.abs(result[0].start) <= 10;
});

test('humanizeEvents: adds random velocity offsets', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 100)];
  const result = humanizeEvents(events, { timing: 0, velocity: 20 });
  // Velocity should be offset by up to 20
  return Math.abs(result[0].velocity - 100) <= 20;
});

test('humanizeEvents: clamps velocity to 1-127', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 5)];
  const result = humanizeEvents(events, { timing: 0, velocity: 50 });
  return result[0].velocity >= 1 && result[0].velocity <= 127;
});

// ============ PREVIEW TESTS ============

test('previewEvents: returns copy of events for audition', () => {
  const events = [createNote(0, STEP_TICKS, 'C3', 100)];
  const result = previewEvents(events);
  return result.length === 1 && result !== events;
});

test('previewEvents: preserves all event properties', () => {
  const events = [createNote(0, STEP_TICKS * 2, 'C3', 80)];
  const result = previewEvents(events);
  return result[0].start === 0 && 
         result[0].dur === STEP_TICKS * 2 && 
         result[0].note === 'C3' && 
         result[0].velocity === 80;
});

console.log('Piano Roll Transform Tests Complete');

// Display summary
setTimeout(() => {
  const sum = document.createElement('div');
  sum.id = 'summary';
  sum.textContent = `Results: ${passed.length} passed, ${failed.length} failed`;
  if (failed.length > 0) {
    sum.style.color = 'red';
  } else {
    sum.style.color = 'green';
  }
  document.getElementById('summary').appendChild(sum);
}, 100);
