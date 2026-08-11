export function createMockAudioParam(initialValue = 0) {
  return {
    _isParam: true,
    value: initialValue,
    _connections: new Set(),
    connect(dest) {
      if (dest) this._connections.add(dest);
    },
    disconnect(dest) {
      if (dest === undefined) this._connections.clear();
      else this._connections.delete(dest);
    },
    setValueAtTime(v) {
      this.value = v;
    },
    setTargetAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
  };
}

function createMockNode(type) {
  return {
    type: type === 'oscillator' ? 'sine' : 'lowpass',
    gain: createMockAudioParam(0),
    frequency: createMockAudioParam(440),
    Q: createMockAudioParam(1),
    detune: createMockAudioParam(0),
    delayTime: createMockAudioParam(0),
    buffer: null,
    loop: false,
    curve: null,
    oversample: 'none',
    _started: false,
    _connections: new Set(),
    connect(dest) {
      if (dest) {
        this._connections.add(dest);
        if (dest._isParam) dest._connections.add(this);
      }
    },
    disconnect(dest) {
      if (dest === undefined) this._connections.clear();
      else this._connections.delete(dest);
    },
    start() {
      this._started = true;
    },
    stop() {
      this._started = false;
    },
  };
}

export function createMockAudioContext() {
  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    destination: createMockNode('destination'),
    createGain() {
      return createMockNode('gain');
    },
    createOscillator() {
      return createMockNode('oscillator');
    },
    createBiquadFilter() {
      return createMockNode('biquad');
    },
    createWaveShaper() {
      return createMockNode('waveshaper');
    },
    createDelay() {
      return createMockNode('delay');
    },
    createConvolver() {
      return createMockNode('convolver');
    },
    createChannelSplitter() {
      return createMockNode('channelSplitter');
    },
    createBufferSource() {
      return createMockNode('bufferSource');
    },
    createBuffer(channels, length, sampleRate) {
      return {
        length,
        sampleRate,
        numberOfChannels: channels,
        _data: [],
        getChannelData(ch) {
          if (!this._data[ch]) this._data[ch] = new Float32Array(length);
          return this._data[ch];
        },
      };
    },
  };
  return ctx;
}
