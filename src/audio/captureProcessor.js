// Take capture processor (M4 recording): forwards up to two input channels
// to the main thread as transferable copies. The node is only connected
// while a take runs, so chunks flow exactly for the recorded span. Classic
// worklet (no imports) so it loads anywhere the app is served from.
class TakeCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs && inputs[0];
    if (input && input.length) {
      const count = Math.min(2, input.length);
      const channels = [];
      for (let c = 0; c < count; c++) channels.push(input[c].slice(0));
      this.port.postMessage(
        { type: 'data', channels },
        channels.map(c => c.buffer)
      );
    }
    return true;
  }
}

registerProcessor('take-capture', TakeCaptureProcessor);
