import { SCHEMA_VERSION } from './defaultProject.js';

const waves = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const filters = ['none', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'lowshelf', 'highshelf', 'peaking'];
const rackTypes = ['oscillator', 'filter', 'adsr', 'effects', 'lfo', 'mixer', 'splitter', 'sequencer'];
const fail = (path, message) => { throw new Error(path + ': ' + message); };
const object = (v, p) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p, 'expected object'); };
const id = (v, p) => { if (typeof v !== 'string' || !v.trim() || ['__proto__', 'constructor', 'prototype', 'master'].includes(v)) fail(p, 'invalid ID'); };
const number = (v, p, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(p, 'number out of range');
};
function fields(o, p, spec) {
  for (const [k, rule] of Object.entries(spec)) if (o[k] !== undefined) {
    const v = o[k], path = p + '.' + k;
    if (Array.isArray(rule)) number(v, path, ...rule);
    else if (typeof v !== rule) fail(path, 'expected ' + rule);
  }
}
function choice(o, k, values, p) { if (o[k] !== undefined && !values.includes(o[k])) fail(p + '.' + k, 'unsupported value'); }
function list(o, k, p, fn) {
  if (o[k] === undefined) return;
  if (!Array.isArray(o[k])) fail(p + '.' + k, 'expected array');
  o[k].forEach((v, i) => { object(v, `${p}.${k}[${i}]`); fn(v, `${p}.${k}[${i}]`); });
}
function unique(set, value, p) { id(value, p); if (set.has(value)) fail(p, 'duplicate ID'); set.add(value); }
function note(v, p) {
  if (typeof v !== 'string' || !/^[A-G]#?-?\d+$/.test(v)) fail(p, 'invalid note');
  const m = /^([A-G])(#?)(-?\d+)$/.exec(v);
  number((+m[3] + 1) * 12 + { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[m[1]] + m[2].length, p, 0, 127, true);
}
// Check before normalization: an explicit invalid value must never become a default.
// Walk even extension data so NaN/Infinity cannot disappear during JSON cloning.
export function validateInput(p, { references = true } = {}) {
  object(p, 'project');
  const seen = new Set();
  function walk(v, path) {
    if (typeof v === 'number' && !Number.isFinite(v)) fail(path, 'expected finite number');
    if (v && typeof v === 'object') {
      if (seen.has(v)) fail(path, 'cyclic data');
      seen.add(v);
      for (const [k, value] of Object.entries(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) fail(path, 'unsafe property');
        walk(value, path + '.' + k);
      }
      seen.delete(v);
    }
  }
  walk(p, 'project');
  if (p.schemaVersion !== undefined) number(p.schemaVersion, 'schemaVersion', 1, SCHEMA_VERSION, true);
  if (p.id !== undefined) id(p.id, 'project.id');
  fields(p, 'project', { name:'string', tempo:[1,1000], loopEnabled:'boolean', loopStartTicks:[0], loopEndTicks:[Number.MIN_VALUE] });
  if (p.projectEndTicks !== undefined && p.projectEndTicks !== null) number(p.projectEndTicks, 'projectEndTicks', Number.MIN_VALUE);
  if ((p.loopEndTicks ?? 1920) <= (p.loopStartTicks ?? 0)) fail('loopEndTicks', 'must exceed loopStartTicks');
  choice(p, 'playbackMode', ['song', 'pattern'], 'project');
  const tracks = new Set(), clips = new Set(), devices = new Set(), events = new Set(), assets = new Set(), markers = new Set(), routes = new Set();
  if (p.rack !== undefined) {
    object(p.rack, 'rack');
    list(p.rack, 'components', 'rack', (c, path) => {
      unique(devices, c.id, path + '.id');
      if (!rackTypes.includes(c.type)) fail(path + '.type', 'unsupported device');
      fields(c, path, { x:[0], y:[0] });
      if (c.params !== undefined) {
        object(c.params, path + '.params');
        const q = c.params;
        fields(q, path + '.params', { freq:[Number.MIN_VALUE], q:[0], a:[0], d:[0], s:[0,1], r:[0], n:[0,Number.MAX_SAFE_INTEGER,true], rate:[0], depth:[0], delayTime:[0,2], delayFeedback:[0,1], reverbDuration:[0,5], reverbDecay:[0], on:'boolean', delayOn:'boolean', reverbOn:'boolean' });
        choice(q, 'wave', c.type === 'lfo' ? waves.filter(w => w !== 'noise') : waves, path + '.params');
        choice(q, 'type', c.type === 'filter' ? ['lowpass','highpass','bandpass'] : filters, path + '.params');
        // These rack controls clamp on apply; reject instead of silently
        // changing a document during load. Track envelopes have wider ranges.
        const ranges = {
          oscillator: { freq:[Number.MIN_VALUE,20000] }, filter: { freq:[20,20000], q:[0.1,20] },
          adsr: { a:[0.01,2], d:[0.01,2], s:[0,1], r:[0.01,2] },
          lfo: { rate:[0.1,20], depth:[1,100] },
          effects: { delayTime:[0.1,2], reverbDuration:[0.1,5] },
        };
        fields(q, path+'.params', ranges[c.type] || {});
        if (q.levels !== undefined) {
          if (!Array.isArray(q.levels) || q.levels.length > 4) fail(path + '.params.levels', 'invalid mixer levels');
          q.levels.forEach((v,i) => number(v, path + '.params.levels.' + i, 0, 1));
        }
      }
    });
    list(p.rack, 'connections', 'rack', (c,path) => {
      if (c.id !== undefined) unique(routes,c.id,path + '.id');
      if (!devices.has(c.from) || (c.to !== 'master' && !devices.has(c.to)) || c.from === c.to) fail(path, 'invalid device reference');
      const from = p.rack.components.find(d => d.id === c.from);
      const to = p.rack.components.find(d => d.id === c.to);
      if (c.outChannel > (from.type === 'splitter' ? 1 : 0)) fail(path + '.outChannel', 'invalid output port');
      const isMod = from.type === 'lfo' && (to?.type === 'filter' || (to?.type === 'oscillator' && to.params?.wave !== 'noise'));
      if (c.mod !== undefined && c.mod !== isMod) fail(path + '.mod', 'incorrect modulation route');
      if (!isMod && to && to.type === 'lfo') fail(path + '.to', 'device has no audio input');
      if (c.toChannel != null && to?.type !== 'mixer') fail(path + '.toChannel', 'device has no channel input');
      const key = JSON.stringify([c.from,c.to,c.toChannel ?? null,c.outChannel ?? 0]);
      if (routes.has(key)) fail(path, 'duplicate connection');
      routes.add(key);
      fields(c,path,{ outChannel:[0,1,true], mod:'boolean' });
      if (c.toChannel !== undefined && c.toChannel !== null) number(c.toChannel,path + '.toChannel',0,3,true);
    });
  }
  list(p,'assets','project',(a,path) => {
    unique(assets,a.hash,path + '.hash');
    fields(a,path,{name:'string',mime:'string',size:[0,Number.MAX_SAFE_INTEGER,true],sampleRate:[0],channels:[0,32,true],duration:[0]});
  });
  list(p,'tracks','project',(t,path) => {
    if (t.id !== undefined) unique(tracks,t.id,path + '.id');
    fields(t,path,{name:'string',color:'string',enabled:'boolean',monitor:'boolean',muted:'boolean',solo:'boolean',collapsed:'boolean',volume:[0,1],filterFreq:[Number.MIN_VALUE],filterQ:[0],gridDur:[Number.MIN_VALUE]});
    if (t.height !== undefined && t.height !== null) number(t.height,path+'.height',Number.MIN_VALUE);
    if (t.midiChannel !== undefined && t.midiChannel !== null) number(t.midiChannel,path+'.midiChannel',0,15,true);
    choice(t,'wave',waves,path); choice(t,'filterType',filters,path);
    if (t.gridNote !== undefined) note(t.gridNote,path+'.gridNote');
    if (t.adsr !== undefined) { object(t.adsr,path+'.adsr'); fields(t.adsr,path+'.adsr',{a:[0],d:[0],s:[0,1],r:[0]}); }
    if (t.grid !== undefined) {
      if (!Array.isArray(t.grid)) fail(path+'.grid','expected array');
      t.grid.forEach((cell,i) => {
        if (cell === null) return;
        if (typeof cell === 'string') note(cell,path+'.grid.'+i);
        else { object(cell,path+'.grid.'+i); note(cell.note,path+'.grid.'+i); fields(cell,path+'.grid.'+i,{dur:[Number.MIN_VALUE],vel:[0,127]}); }
      });
    }
    list(t,'rt',path,(e,ep) => {
      note(e.note,ep+'.note'); number(e.start,ep+'.start'); number(e.dur,ep+'.dur',Number.MIN_VALUE);
      fields(e,ep,{velocity:[0,127],bend:[-1,1],mod:[0,1],pressure:[0,1]});
      if (e.channel != null) number(e.channel,ep+'.channel',0,15,true);
    });
    list(t,'inserts',path,(d,dp) => {
      if (d.id !== undefined) unique(devices,d.id,dp+'.id');
      if (!['delay','reverb'].includes(d.type)) fail(dp+'.type','unsupported device');
      if (d.params !== undefined) { object(d.params,dp+'.params'); fields(d.params,dp+'.params',{time:[0,2],feedback:[0,1],mix:[0,1]}); }
    });
    list(t,'clips',path,(c,cp) => {
      if (c.id !== undefined) unique(clips,c.id,cp+'.id');
      fields(c,cp,{name:'string',start:[0],length:[Number.MIN_VALUE],offset:[0]});
      list(c,'events',cp,(e,ep) => {
        if (e.id !== undefined) unique(events,e.id,ep+'.id');
        note(e.note,ep+'.note'); number(e.start,ep+'.start'); number(e.dur,ep+'.dur',Number.MIN_VALUE);
        fields(e,ep,{velocity:[0,127],rawStart:[0],bend:[-1,1],mod:[0,1],pressure:[0,1],device:'string'});
        if (e.channel !== undefined && e.channel !== null) number(e.channel,ep+'.channel',0,15,true);
        choice(e,'pgm',waves,ep);
      });
      if (c.audio !== undefined && c.audio !== null) {
        object(c.audio,cp+'.audio');
        id(c.audio.hash,cp+'.audio.hash');
        if (references && !assets.has(c.audio.hash)) fail(cp+'.audio.hash','missing asset reference');
        fields(c.audio,cp+'.audio',{offset:[0],gain:[0],fadeIn:[0],fadeOut:[0]});
      }
    });
  });
  if (p.activeTrackId !== undefined && p.activeTrackId !== null && !tracks.has(p.activeTrackId)) fail('activeTrackId','missing track reference');
  const parents = new Map((p.tracks || []).map(t => [t.id,t.folder]));
  for (const t of references ? (p.tracks || []) : []) {
    const visited = new Set([t.id]); let f = t.folder;
    while (f !== undefined && f !== null) {
      if (!tracks.has(f) || visited.has(f)) fail('track.'+t.id+'.folder','missing or cyclic track reference');
      visited.add(f); f = parents.get(f);
    }
  }
  list(p,'markers','project',(m,path) => { if (m.id !== undefined) unique(markers,m.id,path+'.id'); fields(m,path,{name:'string',tick:[0]}); });
  return true;
}
