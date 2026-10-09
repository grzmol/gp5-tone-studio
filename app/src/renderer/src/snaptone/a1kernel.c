// Freestanding (no libc) NAM WaveNet A1 forward pass for wasm32 + SIMD128, matching NeuralAmpModelerCore
// with fast tanh (what Valeton Suite renders SnapTones with). Host and memory layout: wavenet.ts.
// Channel-major blocks, per-layer history; this file only does arithmetic.
//
// Build (committed as a1kernel.wasm): npm run build:wasm
#include <wasm_simd128.h>

#define EXPORT __attribute__((visibility("default")))

typedef struct
{
  int dilation;
  int look;
  const float* conv; // [out][in][3]
  const float* convBias;
  const float* mix; // [out]
  const float* l1; // [out][in]
  const float* l1Bias;
  float* history; // [C][look]
  float* buf; // [C][look + maxBlock]
} Layer;

typedef struct
{
  int inSize, channels, headSize, numLayers;
  const float* rechannel; // [C][inSize]
  const float* head; // [H][C]
  const float* headBias;
  Layer* layers;
} LayerArray;

typedef struct
{
  int numArrays;
  float headScale;
  LayerArray* arrays;
  float *hA, *hB, *arrayOut, *z, *headSum; // [maxC][maxBlock]
  float** headOut; // per array [H][maxBlock]
} Model;

static inline float fabsf_(float x) { return __builtin_fabsf(x); }

static void fast_tanh(float* b, int n)
{
  for (int i = 0; i < n; i++)
  {
    const float x = b[i];
    const float ax = fabsf_(x);
    const float x2 = x * x;
    b[i] = (x * (2.45550750702956f + 2.45550750702956f * ax + (0.893229853513558f + 0.821226666969744f * ax) * x2))
           / (2.44506634652299f + (2.44506634652299f + x2) * fabsf_(x + 0.814642734961073f * x * ax));
  }
}

static void matmul1x1(const float* W, const float* bias, const float* x, int cin, int cout, int n, float* y)
{
  for (int o = 0; o < cout; o++)
  {
    float* yo = y + o * n;
    const v128_t b = wasm_f32x4_splat(bias ? bias[o] : 0.0f);
    int t = 0;
    for (; t + 4 <= n; t += 4)
      wasm_v128_store(yo + t, b);
    for (; t < n; t++)
      yo[t] = bias ? bias[o] : 0.0f;
    for (int i = 0; i < cin; i++)
    {
      const v128_t w = wasm_f32x4_splat(W[o * cin + i]);
      const float* xi = x + i * n;
      for (t = 0; t + 4 <= n; t += 4)
        wasm_v128_store(yo + t, wasm_f32x4_add(wasm_v128_load(yo + t), wasm_f32x4_mul(w, wasm_v128_load(xi + t))));
      for (; t < n; t++)
        yo[t] += W[o * cin + i] * xi[t];
    }
  }
}

static void copyf(float* d, const float* s, int n)
{
  for (int i = 0; i < n; i++)
    d[i] = s[i];
}

EXPORT void a1_process(Model* m, const float* input, float* output, int n)
{
  const float* layerIn = input;
  const float* prevHead = 0;
  for (int ai = 0; ai < m->numArrays; ai++)
  {
    LayerArray* a = &m->arrays[ai];
    const int C = a->channels;
    float* h = m->hA;
    float* hNext = m->hB;
    matmul1x1(a->rechannel, 0, layerIn, a->inSize, C, n, h);
    if (prevHead)
      copyf(m->headSum, prevHead, C * n);
    else
      for (int j = 0; j < C * n; j++)
        m->headSum[j] = 0.0f;
    float* z = m->z;
    for (int li = 0; li < a->numLayers; li++)
    {
      Layer* L = &a->layers[li];
      const int look = L->look, d = L->dilation, stride = look + n;
      for (int c = 0; c < C; c++)
      {
        copyf(L->buf + c * stride, L->history + c * look, look);
        copyf(L->buf + c * stride + look, h + c * n, n);
      }
      for (int o = 0; o < C; o++)
      {
        float* zo = z + o * n;
        const float b = L->convBias[o], mx = L->mix[o];
        int t = 0;
        const v128_t vb = wasm_f32x4_splat(b), vm = wasm_f32x4_splat(mx);
        for (; t + 4 <= n; t += 4)
          wasm_v128_store(zo + t, wasm_f32x4_add(vb, wasm_f32x4_mul(vm, wasm_v128_load(input + t))));
        for (; t < n; t++)
          zo[t] = b + mx * input[t];
        for (int i = 0; i < C; i++)
        {
          const float* w = L->conv + (o * C + i) * 3;
          const v128_t w0 = wasm_f32x4_splat(w[0]), w1 = wasm_f32x4_splat(w[1]), w2 = wasm_f32x4_splat(w[2]);
          const float* s2 = L->buf + i * stride + look;
          const float* s1 = s2 - d;
          const float* s0 = s2 - 2 * d;
          for (t = 0; t + 4 <= n; t += 4)
          {
            v128_t acc = wasm_v128_load(zo + t);
            acc = wasm_f32x4_add(acc, wasm_f32x4_mul(w0, wasm_v128_load(s0 + t)));
            acc = wasm_f32x4_add(acc, wasm_f32x4_mul(w1, wasm_v128_load(s1 + t)));
            acc = wasm_f32x4_add(acc, wasm_f32x4_mul(w2, wasm_v128_load(s2 + t)));
            wasm_v128_store(zo + t, acc);
          }
          for (; t < n; t++)
            zo[t] += w[0] * s0[t] + w[1] * s1[t] + w[2] * s2[t];
        }
      }
      fast_tanh(z, C * n);
      for (int j = 0; j < C * n; j++)
        m->headSum[j] += z[j];
      matmul1x1(L->l1, L->l1Bias, z, C, C, n, hNext);
      for (int j = 0; j < C * n; j++)
        hNext[j] += h[j];
      for (int c = 0; c < C; c++)
        copyf(L->history + c * look, L->buf + c * stride + n, look);
      float* tmp = h;
      h = hNext;
      hNext = tmp;
    }
    float* ho = m->headOut[ai];
    matmul1x1(a->head, a->headBias, m->headSum, C, a->headSize, n, ho);
    prevHead = ho;
    if (ai + 1 < m->numArrays)
    {
      copyf(m->arrayOut, h, C * n);
      layerIn = m->arrayOut;
    }
  }
  for (int t = 0; t < n; t++)
    output[t] = m->headScale * prevHead[t];
}
