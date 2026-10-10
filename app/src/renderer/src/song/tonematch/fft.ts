// In-place radix-2 complex FFT, with cached twiddles and bit-reversal tables per size.

interface Plan {
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, Plan>();

function planFor(n: number): Plan {
  let plan = plans.get(n);
  if (plan) return plan;
  if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  plan = { rev, cos, sin };
  plans.set(n, plan);
  return plan;
}

/** Forward (e^-jωn) or inverse (e^+jωn, scaled by 1/n) transform of `re` + j`im`, in place. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n) throw new RangeError("FFT real and imaginary parts differ in length");
  const { rev, cos, sin } = planFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Periodic Hann window of length n. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Power spectrum |X[k]|² (k = 0..n/2) of `frame` (length n) under `window`. `re`/`im` are scratch buffers of
 * length n, reused across frames to avoid allocation.
 */
export function powerSpectrum(frame: ArrayLike<number>, window: Float64Array, re: Float64Array, im: Float64Array, out: Float64Array): void {
  const n = window.length;
  for (let i = 0; i < n; i++) {
    re[i] = (frame[i] ?? 0) * window[i];
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
}
