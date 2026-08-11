export const PRESETS = {
  bass: { osc1: { on: true, wave: 'sawtooth', freq: 110 }, filter: { type: 'lowpass', freq: 800, q: 5 }, adsr: { a: 0.01, d: 0.2, s: 0.4, r: 0.1 } },
  lead: { osc1: { on: true, wave: 'square', freq: 440 }, filter: { type: 'lowpass', freq: 3000, q: 2 }, adsr: { a: 0.05, d: 0.1, s: 0.7, r: 0.2 } },
  pad: { osc1: { on: true, wave: 'triangle', freq: 220 }, filter: { type: 'lowpass', freq: 1500, q: 0 }, adsr: { a: 0.5, d: 0.5, s: 0.8, r: 1.0 } },
  drum: { osc1: { on: true, wave: 'square', freq: 100 }, filter: { type: 'lowpass', freq: 500, q: 8 }, adsr: { a: 0.01, d: 0.3, s: 0.1, r: 0.1 } },
  arp: { osc1: { on: true, wave: 'sawtooth', freq: 440 }, filter: { type: 'bandpass', freq: 1200, q: 3 }, adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.15 } },
  bass2: { osc1: { on: true, wave: 'triangle', freq: 55 }, filter: { type: 'lowpass', freq: 400, q: 6 }, adsr: { a: 0.05, d: 0.3, s: 0.6, r: 0.2 } },
  fx: { osc1: { on: true, wave: 'noise', freq: 800 }, filter: { type: 'highpass', freq: 2000, q: 1 }, adsr: { a: 0.01, d: 0.05, s: 0.3, r: 0.1 } }
};
