import { drawWaveform } from './waveform.js';

// Microphone/line input (M4 recording): device enumeration, stream request,
// and a monitored audition path with peak metering. Monitoring is an
// explicit toggle (feedback guard): nothing reaches the speakers until the
// user arms MON. The meter taps the stream pre-gain, so input levels show
// whether or not monitoring is on.
export function mediaDevicesRef(media) {
  if (media) return media;
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) return navigator.mediaDevices;
  return null;
}

export async function listInputDevices(media) {
  const md = mediaDevicesRef(media);
  if (!md || typeof md.enumerateDevices !== 'function') return [];
  const devs = await md.enumerateDevices();
  return devs
    .filter(d => d && d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId || '',
      label: d.label || ('Input ' + (i + 1)),
      groupId: d.groupId || '',
    }));
}

export async function requestInputStream({ deviceId, echoCancellation = false, noiseSuppression = false, autoGainControl = false } = {}, media) {
  const md = mediaDevicesRef(media);
  if (!md || typeof md.getUserMedia !== 'function') throw new Error('audioInput: capture unavailable');
  const audio = { echoCancellation, noiseSuppression, autoGainControl };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return md.getUserMedia({ audio, video: false });
}

export function stopStream(stream) {
  const tracks = (stream && typeof stream.getTracks === 'function' && stream.getTracks()) || [];
  tracks.forEach(t => {
    try { t.stop(); } catch (e) {}
  });
}

export function createInputMonitor({ ctx, stream, destination } = {}) {
  if (!ctx || typeof ctx.createMediaStreamSource !== 'function' || typeof ctx.createAnalyser !== 'function') {
    throw new Error('audioInput: unsuitable audio context');
  }
  if (!stream) throw new Error('audioInput: no stream');
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const monitorGain = ctx.createGain();
  monitorGain.gain.value = 0;
  source.connect(analyser);
  analyser.connect(monitorGain);
  try { monitorGain.connect(destination || ctx.destination); } catch (e) {}
  const scratch = new Uint8Array(analyser.fftSize);
  let gain = 0.8;
  let monitoring = false;

  function applyGain() {
    const target = monitoring ? gain : 0;
    try {
      monitorGain.gain.cancelScheduledValues(ctx.currentTime);
      monitorGain.gain.setTargetAtTime(target, ctx.currentTime, 0.02);
    } catch (e) {
      monitorGain.gain.value = target;
    }
  }

  return {
    setGain(v) {
      gain = typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1.5, v)) : gain;
      applyGain();
      return gain;
    },
    getGain: () => gain,
    setMonitoring(on) {
      monitoring = !!on;
      applyGain();
      return monitoring;
    },
    isMonitoring: () => monitoring,
    getPeak() {
      try {
        analyser.getByteTimeDomainData(scratch);
      } catch (e) {
        return 0;
      }
      let peak = 0;
      for (let i = 0; i < scratch.length; i++) {
        const v = Math.abs(scratch[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      return peak;
    },
    getStream: () => stream,
    drawMeter(canvas) {
      drawWaveform(canvas, null);
      const g = canvas.getContext('2d');
      if (!g) return;
      const peak = this.getPeak();
      g.fillStyle = peak > 0.95 ? '#ff5555' : '#4af74a';
      g.fillRect(0, 0, Math.max(0, Math.min(1, peak)) * canvas.width, canvas.height);
    },
    dispose() {
      try { source.disconnect(); } catch (e) {}
      try { analyser.disconnect(); } catch (e) {}
      try { monitorGain.disconnect(); } catch (e) {}
    },
  };
}
