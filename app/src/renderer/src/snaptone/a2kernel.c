// Freestanding (no libc) NAM A2 WaveNet forward pass for wasm32 + SIMD128, bit-exact with the A2 fast path
// (NAM/wavenet/a2_fast.cpp at NeuralAmpModelerCore commit baf1bf8) that Valeton Suite 2.1.0 renders SnapTones
// with. Host and memory layout: wavenet.ts. Channel-major blocks ([C][n]); SIMD runs across 4 frames, so every
// sample sees exactly the scalar operation order of the reference:
//   conv  C=3: bias + taps (oldest first, input channel inner), C=8: taps from 0, then + bias
//   then + mix * x, LeakyReLU(0.01), head sum (layer order)
//   1x1   C=3: lin + (((b + w0 a0) + w1 a1) + w2 a2), C=8: (lin + (0 + w0 a0 + ... + w7 a7)) + b (Eigen GEMM)
//   head  ((b + taps oldest first, channel inner)) * head_scale
//
// Build (committed as a2kernel.wasm): npm run build:wasm
#include <wasm_simd128.h>

#define EXPORT __attribute__((visibility("default")))
#define HEAD_TAPS 16
#define LEAKY_SLOPE 0.01f

typedef struct
{
  int kernel;
  int dilation;
  int look; // (kernel - 1) * dilation
  const float* conv; // [kernel][out][in]
  const float* convBias;
  const float* mix; // [out]
  const float* l1; // [out][in]
  const float* l1Bias;
  float* history; // [C][look + maxBlock]: look frames of past input, then the current block
} Layer;

typedef struct
{
  int channels, numLayers, maxBlock;
  float headScale, headBias;
  const float* rechannel; // [C]
  const float* head; // [HEAD_TAPS][C]
  Layer* layers;
  float* layerIn; // [C][maxBlock]
  float* act; // [C][maxBlock]
  float* headSum; // [C][HEAD_TAPS - 1 + maxBlock]
} Model;

static void move(float* d, const float* s, int n)
{
  for (int i = 0; i < n; i++)
    d[i] = s[i];
}

static inline v128_t leaky(v128_t z)
{
  return wasm_v128_bitselect(wasm_f32x4_mul(z, wasm_f32x4_splat(LEAKY_SLOPE)), z, wasm_f32x4_lt(z, wasm_f32x4_splat(0.0f)));
}

static inline float leaky1(float z) { return z < 0.0f ? z * LEAKY_SLOPE : z; }

// Dilated conv + mixin + LeakyReLU for output channel o into act[o], frames [0, n).
static void conv(const Model* m, const Layer* L, int o, const float* x, int n)
{
  const int C = m->channels, K = L->kernel, D = L->dilation, stride = L->look + m->maxBlock;
  const float* cur = L->history + L->look; // frame t of input channel i: cur[i * stride + t]
  const float bias = L->convBias[o], mix = L->mix[o];
  const int seedBias = C == 3;
  float* out = m->act + o * m->maxBlock;
  int t = 0;
  for (; t + 4 <= n; t += 4)
  {
    v128_t acc = wasm_f32x4_splat(seedBias ? bias : 0.0f);
    for (int k = 0; k < K; k++)
    {
      const float* w = L->conv + (k * C + o) * C;
      const float* src = cur + t - (K - 1 - k) * D;
      for (int i = 0; i < C; i++)
        acc = wasm_f32x4_add(acc, wasm_f32x4_mul(wasm_f32x4_splat(w[i]), wasm_v128_load(src + i * stride)));
    }
    if (!seedBias)
      acc = wasm_f32x4_add(acc, wasm_f32x4_splat(bias));
    acc = wasm_f32x4_add(acc, wasm_f32x4_mul(wasm_f32x4_splat(mix), wasm_v128_load(x + t)));
    wasm_v128_store(out + t, leaky(acc));
  }
  for (; t < n; t++)
  {
    float acc = seedBias ? bias : 0.0f;
    for (int k = 0; k < K; k++)
    {
      const float* w = L->conv + (k * C + o) * C;
      const float* src = cur + t - (K - 1 - k) * D;
      for (int i = 0; i < C; i++)
        acc += w[i] * src[i * stride];
    }
    if (!seedBias)
      acc += bias;
    acc += mix * x[t];
    out[t] = leaky1(acc);
  }
}

// layer1x1 residual for output channel o: layerIn[o] += W[o] . act (+ bias), in the reference order.
static void residual(const Model* m, const Layer* L, int o, int n)
{
  const int C = m->channels, B = m->maxBlock;
  const float* w = L->l1 + o * C;
  const float bias = L->l1Bias[o];
  float* lin = m->layerIn + o * B;
  int t = 0;
  for (; t + 4 <= n; t += 4)
  {
    v128_t s = wasm_f32x4_splat(C == 3 ? bias : 0.0f);
    for (int i = 0; i < C; i++)
      s = wasm_f32x4_add(s, wasm_f32x4_mul(wasm_f32x4_splat(w[i]), wasm_v128_load(m->act + i * B + t)));
    v128_t r = wasm_f32x4_add(wasm_v128_load(lin + t), s);
    if (C != 3)
      r = wasm_f32x4_add(r, wasm_f32x4_splat(bias));
    wasm_v128_store(lin + t, r);
  }
  for (; t < n; t++)
  {
    float s = C == 3 ? bias : 0.0f;
    for (int i = 0; i < C; i++)
      s += w[i] * m->act[i * B + t];
    float r = lin[t] + s;
    if (C != 3)
      r += bias;
    lin[t] = r;
  }
}

EXPORT void a2_process(Model* m, const float* x, float* y, int n)
{
  const int C = m->channels, B = m->maxBlock, H = HEAD_TAPS - 1 + B;
  for (int c = 0; c < C; c++)
    for (int t = 0; t < n; t++)
      m->layerIn[c * B + t] = m->rechannel[c] * x[t];

  for (int li = 0; li < m->numLayers; li++)
  {
    Layer* L = &m->layers[li];
    const int stride = L->look + B;
    for (int c = 0; c < C; c++)
      move(L->history + c * stride + L->look, m->layerIn + c * B, n);
    for (int o = 0; o < C; o++)
    {
      conv(m, L, o, x, n);
      float* sum = m->headSum + o * H + HEAD_TAPS - 1;
      const float* a = m->act + o * B;
      if (li == 0)
        move(sum, a, n);
      else
        for (int t = 0; t < n; t++)
          sum[t] += a[t];
    }
    if (li + 1 < m->numLayers)
      for (int o = 0; o < C; o++)
        residual(m, L, o, n);
    for (int c = 0; c < C; c++)
      move(L->history + c * stride, L->history + c * stride + n, L->look);
  }

  for (int t = 0; t < n; t++)
  {
    float v = m->headBias;
    for (int k = 0; k < HEAD_TAPS; k++)
      for (int c = 0; c < C; c++)
        v += m->head[k * C + c] * m->headSum[c * H + t + k];
    y[t] = v * m->headScale;
  }
  for (int c = 0; c < C; c++)
    move(m->headSum + c * H, m->headSum + c * H + n, HEAD_TAPS - 1);
}
