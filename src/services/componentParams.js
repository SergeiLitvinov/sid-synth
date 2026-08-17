export function captureParams(comp) {
  switch (comp.type) {
    case 'oscillator':
      return { wave: comp.waveform, freq: comp.frequency, on: comp.isOn, n: comp.id };
    case 'filter':
      return { type: comp.filterType, freq: comp.frequency, q: comp.Q };
    case 'adsr':
      return { a: comp.attack, d: comp.decay, s: comp.sustain, r: comp.release };
    case 'effects':
      return {
        delayOn: comp.delayOn, delayTime: comp.delayTime, delayFeedback: comp.delayFeedback,
        reverbOn: comp.reverbOn, reverbDuration: comp.reverbDuration, reverbDecay: comp.reverbDecay
      };
    case 'lfo':
      return { rate: comp.rate, depth: comp.depth, wave: comp.waveType };
    case 'mixer':
      return { levels: comp.channelGains.map(g => g.gain.value) };
    default:
      return {};
  }
}

export function applyParams(comp, params) {
  if (!comp || !params) return;
  switch (comp.type) {
    case 'oscillator':
      if (params.wave) {
        comp.waveform = params.wave;
        const sel = comp.element.querySelector('.param-row select');
        if (sel) sel.value = params.wave;
      }
      if (params.freq !== undefined) {
        comp.frequency = params.freq;
        if (comp.freqKnob) comp.freqKnob.setValue(params.freq);
      }
      if (params.on !== undefined) {
        comp.isOn = params.on;
        const chk = comp.element.querySelector('.param-row input[type="checkbox"]');
        if (chk) chk.checked = params.on;
      }
      comp.update();
      break;
    case 'filter':
      if (params.type) {
        comp.filterType = params.type;
        const sel = comp.element.querySelector('.param-row select');
        if (sel) sel.value = params.type;
      }
      if (params.freq !== undefined) {
        comp.frequency = params.freq;
        if (comp.freqKnob) comp.freqKnob.setValue(params.freq);
      }
      if (params.q !== undefined) {
        comp.Q = params.q;
        if (comp.qKnob) comp.qKnob.setValue(params.q);
      }
      comp.update();
      break;
    case 'adsr':
      {
        const keys = { a: 'attack', d: 'decay', s: 'sustain', r: 'release' };
        Object.keys(keys).forEach(k => {
          if (params[k] !== undefined && comp.knobs[keys[k]]) comp.knobs[keys[k]].setValue(params[k]);
        });
      }
      break;
    case 'effects':
      if (params.delayOn !== undefined) comp.delayOn = params.delayOn;
      if (params.reverbOn !== undefined) comp.reverbOn = params.reverbOn;
      if (params.delayTime !== undefined && comp.delayKnob) comp.delayKnob.setValue(params.delayTime);
      if (params.delayFeedback !== undefined) comp.delayFeedback = params.delayFeedback;
      if (params.reverbDuration !== undefined && comp.reverbKnob) comp.reverbKnob.setValue(params.reverbDuration);
      if (params.reverbDecay !== undefined) comp.reverbDecay = params.reverbDecay;
      comp.update();
      {
        const boxes = comp.element.querySelectorAll('.param-row input[type="checkbox"]');
        if (boxes.length >= 2) { boxes[0].checked = comp.delayOn; boxes[1].checked = comp.reverbOn; }
      }
      break;
    case 'lfo':
      if (params.wave) {
        const sel = comp.element.querySelector('.param-row select');
        if (sel) sel.value = params.wave;
      }
      if (params.rate !== undefined && comp.rateKnob) comp.rateKnob.setValue(params.rate);
      if (params.depth !== undefined && comp.depthKnob) comp.depthKnob.setValue(params.depth);
      break;
    case 'mixer':
      if (params.levels && comp.knobs) {
        params.levels.forEach((lv, i) => { if (comp.knobs[i]) comp.knobs[i].setValue(lv); });
      }
      break;
    default:
      break;
  }
}
