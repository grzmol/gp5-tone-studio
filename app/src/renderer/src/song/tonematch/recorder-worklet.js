// AudioWorklet: averages the input channels to mono and posts it to the main thread in 4096-sample batches, with
// the batch's RMS and peak for the level meter. Samples are only sent while `recording` is on.
// Plain JS on purpose: worklet modules load by URL (CSP script-src 'self'), not through the bundler's TS step.
const BATCH = 4096;

class ToneMatchRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffer = new Float32Array(BATCH);
    this.fill = 0;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.recording === "boolean") {
        this.recording = e.data.recording;
        this.fill = 0;
      }
    };
  }

  flush() {
    const block = this.buffer.subarray(0, this.fill);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      sum += block[i] * block[i];
      peak = Math.max(peak, Math.abs(block[i]));
    }
    const samples = this.recording ? block.slice() : null;
    this.port.postMessage({ rms: Math.sqrt(sum / Math.max(1, block.length)), peak, samples }, samples ? [samples.buffer] : []);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const ch of input) v += ch[i];
      this.buffer[this.fill++] = v / input.length;
      if (this.fill === BATCH) this.flush();
    }
    return true;
  }
}

registerProcessor("tone-match-recorder", ToneMatchRecorder);
