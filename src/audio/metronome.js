// Count-in metronome (M4 recording): schedules accent/plain blips over N
// bars at the song tempo, then resolves. Works on any BaseAudioContext
// (realtime for takes, offline for tests). 4/4 only in v1.
export const COUNT_IN_DOWNBEAT_HZ = 2400;
export const COUNT_IN_BEAT_HZ = 1600;

export function playCountIn({ ctx, destination, bpm = 120, bars = 1, beatsPerBar = 4 } = {}) {
  if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') {
    throw new Error('metronome: unsuitable audio context');
  }
  const safeBpm = typeof bpm === 'number' && bpm > 0 ? bpm : 120;
  const safeBars = Math.max(1, Math.floor(bars) || 1);
  const beatSec = 60 / safeBpm;
  const total = safeBars * beatsPerBar;
  const nodes = [];
  let timer = 0;
  let settled = false;
  let resolveDone;
  const promise = new Promise(res => { resolveDone = res; });
  const finish = (completed) => {
    if (settled) return;
    settled = true;
    if (timer) {
      try { clearTimeout(timer); } catch (e) {}
      timer = 0;
    }
    resolveDone(completed);
  };
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < total; i++) {
    const at = t0 + i * beatSec;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = i % beatsPerBar === 0 ? COUNT_IN_DOWNBEAT_HZ : COUNT_IN_BEAT_HZ;
    const g = ctx.createGain();
    try {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.5, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
    } catch (e) {}
    try {
      osc.connect(g);
      g.connect(destination || ctx.destination);
    } catch (e) {}
    try {
      osc.start(at);
      osc.stop(at + 0.1);
    } catch (e) {}
    nodes.push({ osc, at });
  }
  timer = setTimeout(() => finish(true), total * beatSec * 1000 + 150);
  return {
    promise,
    beats: total,
    beatSec,
    cancel() {
      nodes.forEach(({ osc }) => {
        try { osc.stop(); } catch (e) {}
        try { osc.disconnect(); } catch (e) {}
      });
      finish(false);
    },
  };
}
