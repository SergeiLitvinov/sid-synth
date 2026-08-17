import {
  stepTicks, ticksPerSecond,
  gridToClipEvents, rtToClipEvents, mergeClipEvents,
  clipEventsToGrid, clipEventsToRt,
} from '../src/project/clipEvents.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
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

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

check('stepTicks: a sixteenth note is ppq/4', () => {
  return stepTicks(480) === 120 && stepTicks(96) === 24 && stepTicks() === 120;
});

check('ticksPerSecond scales with bpm and ppq', () => {
  return near(ticksPerSecond(120, 480), 960) && near(ticksPerSecond(60, 480), 480);
});

// ---- grid -> clip events ------------------------------------------------
check('gridToClipEvents: empty grid produces no events', () => {
  return gridToClipEvents([null, null]).length === 0;
});

check('gridToClipEvents: cell at step 0 starts at tick 0, dur = steps * sixteenth', () => {
  const events = gridToClipEvents([{ note: 'C4', dur: 1 }]);
  return events.length === 1 && events[0].note === 'C4' && events[0].start === 0 && events[0].dur === 120;
});

check('gridToClipEvents: step 8 starts halfway through the bar', () => {
  const grid = Array(16).fill(null);
  grid[8] = { note: 'E4', dur: 1 };
  const events = gridToClipEvents(grid);
  return events[0].start === 8 * 120 && events[0].note === 'E4';
});

check('gridToClipEvents: legacy string cells normalize to dur 1', () => {
  const events = gridToClipEvents(['A3']);
  return events[0].note === 'A3' && events[0].dur === 120;
});

check('gridToClipEvents: multi-step dur scales', () => {
  const events = gridToClipEvents([{ note: 'G3', dur: 4 }]);
  return events[0].dur === 480;
});

check('gridToClipEvents: honors custom ppq', () => {
  const events = gridToClipEvents([{ note: 'C4', dur: 2 }], { ppq: 96 });
  return events[0].start === 0 && events[0].dur === 48;
});

// ---- realtime notes -> clip events --------------------------------------
check('rtToClipEvents: seconds convert via tempo map', () => {
  const events = rtToClipEvents([{ note: 'C4', start: 0.5, dur: 0.25 }], { bpm: 120, ppq: 480 });
  return near(events[0].start, 480) && near(events[0].dur, 240);
});

check('rtToClipEvents: empty rt produces no events', () => {
  return rtToClipEvents([]).length === 0;
});

// ---- merge ---------------------------------------------------------------
check('mergeClipEvents: sorts by start tick', () => {
  const g = gridToClipEvents([{ note: 'C4', dur: 1 }, null, { note: 'E4', dur: 1 }]);
  const r = rtToClipEvents([{ note: 'D4', start: 0.25, dur: 0.1 }], { bpm: 120 });
  const merged = mergeClipEvents(g, r);
  const starts = merged.map(e => e.start);
  return starts.every((s, i) => i === 0 || s >= starts[i - 1]);
});

check('mergeClipEvents: keeps both grid and realtime notes', () => {
  const g = gridToClipEvents([{ note: 'C4', dur: 1 }]);
  const r = rtToClipEvents([{ note: 'D4', start: 0.5, dur: 0.1 }], { bpm: 120 });
  const merged = mergeClipEvents(g, r);
  return merged.length === 2 && merged.some(e => e.note === 'D4');
});

// ---- clip events -> grid -------------------------------------------------
check('clipEventsToGrid: quantizes events back to step cells', () => {
  const events = [{ note: 'C4', start: 0, dur: 120 }, { note: 'E4', start: 480, dur: 240 }];
  const grid = clipEventsToGrid(events);
  return grid[0] && grid[0].note === 'C4' && grid[0].dur === 1
    && grid[4] && grid[4].note === 'E4' && grid[4].dur === 2;
});

check('clipEventsToGrid: events past the 16-step loop are dropped', () => {
  const events = [{ note: 'C4', start: 16 * 120, dur: 120 }];
  return clipEventsToGrid(events).every(c => c === null);
});

check('clipEventsToGrid: negative starts clamp to step 0', () => {
  const grid = clipEventsToGrid([{ note: 'C4', start: -60, dur: 120 }]);
  return grid[0] && grid[0].note === 'C4';
});

// ---- clip events -> realtime --------------------------------------------
check('clipEventsToRt is the inverse of rtToClipEvents', () => {
  const rt = [{ note: 'C4', start: 0.5, dur: 0.25 }];
  const events = rtToClipEvents(rt, { bpm: 120 });
  const back = clipEventsToRt(events, { bpm: 120 });
  return near(back[0].start, 0.5) && near(back[0].dur, 0.25);
});

check('clipEventsToRt: different bpm rescales', () => {
  const events = [{ note: 'C4', start: 960, dur: 480 }];
  const rt = clipEventsToRt(events, { bpm: 120 });
  return near(rt[0].start, 1) && near(rt[0].dur, 0.5);
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };