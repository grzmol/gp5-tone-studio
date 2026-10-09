/**
 * Faithful TypeScript port of Valeton Suite 2.1.0's native SnapTone clone
 * algorithm (5868USB library, class HTKPA): init(sr) + setInputSignalPath +
 * setOutputSignalPath + startClone(), which returns the 8840-byte "VTSI" blob,
 * plus the library's convertSampleRate() (r8brain CDSPResampler24).
 *
 * Reference: symbolized mac x86_64 dylib (Ghidra pseudo-C + disassembly),
 * verified against the Windows DLL under Wine: header, biquads and amp curve
 * bit-identical, IRs within 1.1e-5 relative (last-ulp libm differences, the
 * same spread the DLL shows between two C runtimes). Every float32 operation
 * is rounded like the SSE2 original and keeps the disassembly's operation
 * order. Blob layout: buildBlob below; overview: app/README.md "SnapTones".
 *
 * Sections: tables, float helpers, constants, CJJFFT + partitioned convolver,
 * Ooura FFT, biquads, 4x oversampled amp-curve shaper, spectral helpers
 * (smoothdata, interp1, downSampleSmoothFreq, minPhaseIR, tfestimate),
 * startClone stages, iterAmpCoeff, final IR2 correction, r8brain resampler,
 * blob assembly. Pure TypeScript, no imports, browser/worker-safe. Deliberately
 * one file: it mirrors one native library and is verified as a unit.
 */

// ---------------------------------------------------------------------------
// Constant tables copied verbatim from the mac dylib (file offset == vmaddr).
// Float tables are stored as IEEE-754 bit patterns so they survive exactly.
// ---------------------------------------------------------------------------

/** _HT_COEFFS_UP_IIR @0x1a32e0 (28 floats): allpass coefficients of the 2x upsamplers. */
const IIR_UP_COEFF_BITS = [
  0x3d3b4d70, 0x3eaa3d96, 0x3f29c79c, 0x3f6f112d, 0x3e2c1f24, 0x3f0125fa, 0x3f4dc495, 0x3d5e2118,
  0x3ecc2f1e, 0x3f5ce82f, 0x3e4c7e0c, 0x3f1f0034, 0x00000000, 0x00000000, 0x3da39102, 0x3f0b9a55,
  0x3e915214, 0x3f559c05, 0x00000000, 0x00000000, 0x00000000, 0x3da39102, 0x3f0b9a55, 0x3e915214,
  0x3f559c05, 0x00000000, 0x00000000, 0x00000000,
];
/** _HT_COEFFS_DOWN_IIR @0x1a3350 (24 floats): allpass coefficients of the 2x downsamplers. */
const IIR_DOWN_COEFF_BITS = [
  0x3d5e1332, 0x3ec42406, 0x3f3fac2d, 0x3e498568, 0x3f12b911, 0x3f6a0f27, 0x3d90edbd, 0x3f035ef3,
  0x3e840552, 0x3f513bb6, 0x00000000, 0x00000000, 0x3dea71d7, 0x3f451aff, 0x3ecbb140, 0x00000000,
  0x00000000, 0x00000000, 0x3dea71d7, 0x3f451aff, 0x3ecbb140, 0x00000000, 0x00000000, 0x00000000,
];
/** 50-tap FIR applied to the 23..28 s excitation segment, sample-rate specific (@0x1a0a40/0x1a0b10/0x1a0be0). */
const SEGMENT_FIR_44100_BITS = [
  0x401790c1, 0x4064c101, 0x4046201d, 0xbec8e886, 0xc049a92a, 0xc0752a5a, 0xc00dcd0c, 0xbf620bf6,
  0xbe5a0dfe, 0xbe45c67e, 0x3e65564b, 0x3ecedcc2, 0x3ec1b36c, 0x3db71ab4, 0x3e46338b, 0x3e912d13,
  0x3eb0198f, 0x3d58cdc2, 0xbd1b890d, 0xbd8a7928, 0x3d963ce0, 0xbcd8ff76, 0xbcbbbaf7, 0x3cc15e04,
  0x3dae9c45, 0xbc180a43, 0x3d337c64, 0x3cbf15c0, 0x3e0a21ea, 0x3bce01d6, 0xbcd445d2, 0xbca02cfc,
  0x3daeb895, 0xbc975ec1, 0xbd9cf689, 0xbda0e61c, 0x3d0940d7, 0x3cdf9bdc, 0xbdcb66a9, 0xbdc3458d,
  0x3d5a3ec0, 0x3d0c62e5, 0xbdbfc76e, 0xbd892b65, 0xbc3a025a, 0x3d2382f2, 0xbd9e19ef, 0xbdc8aa0e,
  0x3b052ea9, 0x3d305476,
];
const SEGMENT_FIR_48000_BITS = [
  0x4017aaf3, 0x40620f8e, 0x4058b454, 0x3f123712, 0xc01fa616, 0xc0766ca8, 0xc04a7c70, 0xbfc18125,
  0xbf14e9d7, 0xbe3464c1, 0xbe1d73d7, 0x3e88549f, 0x3ecf7165, 0x3ec772e7, 0x3de90702, 0x3e1d5c67,
  0x3e855c45, 0x3eb65fb7, 0x3e4f2346, 0xbc927b62, 0xbd72ba17, 0xbcfa11a9, 0x3d961409, 0xbd1ee675,
  0xbca887a9, 0x3cab9f20, 0x3db69ff8, 0xba2f9c3a, 0x3d071675, 0x3c9c46f3, 0x3dc2f7f5, 0x3dc074eb,
  0xbcdc83fa, 0xbce6e654, 0x3b6793f8, 0x3dae7727, 0xbce95091, 0xbd9cea29, 0xbda848f4, 0x3c549808,
  0x3d504b21, 0xbd7f1356, 0xbdfa8ecf, 0xbcb4e36c, 0x3da49477, 0xbca502ef, 0xbdc8f9e7, 0xbd6e334f,
  0xbb550d0d, 0x3d20d563,
];
const SEGMENT_FIR_96000_BITS = [
  0x4017aaf3, 0x404945c0, 0x40620f8e, 0x406bd3be, 0x4058b455, 0x40130453, 0x3f123712, 0xbf967ebc,
  0xc01fa616, 0xc057ac4b, 0xc0766ca9, 0xc072e30f, 0xc04a7c70, 0xc0114d7e, 0xbfc18126, 0xbf7cb8d0,
  0xbf14e9d8, 0xbe90a2cb, 0xbe3464c1, 0xbe4ecc31, 0xbe1d73d7, 0x3d446e74, 0x3e88549f, 0x3ebf7d52,
  0x3ecf7165, 0x3ed7bb41, 0x3ec772e7, 0x3e839318, 0x3de90702, 0x3da6defc, 0x3e1d5c67, 0x3e69a78c,
  0x3e855c45, 0x3e9b76f3, 0x3eb65fb7, 0x3eaa1e64, 0x3e4f2346, 0x3d5c367d, 0xbc927b62, 0xbd0f5573,
  0xbd72ba17, 0xbd9b2ce2, 0xbcfa11a9, 0x3d49a63c, 0x3d961409, 0x3c9f6ba0, 0xbd1ee675, 0xbd345283,
  0xbca887a9, 0xbb8d914e,
];
/** _g_nSinTable @0x1a2eb0, every 4th Q15 entry: twiddle table of the 128-point CJJFFT. */
const Q15_SINE_128 = [
  0, 1608, 3212, 4808, 6393, 7962, 9512, 11039, 12540, 14010, 15447, 16846, 18205, 19520, 20788, 22006,
  23170, 24279, 25330, 26320, 27246, 28106, 28899, 29622, 30274, 30853, 31357, 31786, 32138, 32413, 32610, 32729,
  32767, 32729, 32610, 32413, 32138, 31786, 31357, 30853, 30274, 29622, 28899, 28106, 27246, 26320, 25330, 24279,
  23170, 22006, 20788, 19520, 18205, 16846, 15447, 14010, 12540, 11039, 9512, 7962, 6393, 4808, 3212, 1608,
  0, -1608, -3212, -4808, -6393, -7962, -9512, -11039, -12540, -14010, -15447, -16846, -18205, -19520, -20788, -22006,
  -23170, -24279, -25330, -26320, -27246, -28106, -28899, -29622, -30274, -30853, -31357, -31786, -32138, -32413, -32610, -32729,
  -32768, -32729, -32610, -32413, -32138, -31786, -31357, -30853, -30274, -29622, -28899, -28106, -27246, -26320, -25330, -24279,
  -23170, -22006, -20788, -19520, -18205, -16846, -15447, -14010, -12540, -11039, -9512, -7962, -6393, -4808, -3212, -1608,
];
/** _mCRC16TableHi/_mCRC16TableLo @0x1a07f0/0x1a08f0 (Modbus CRC-16). */
const CRC16_TABLE_HI = [
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  1, 192, 128, 65, 0, 193, 129, 64, 0, 193, 129, 64, 1, 192, 128, 65,
  0, 193, 129, 64, 1, 192, 128, 65, 1, 192, 128, 65, 0, 193, 129, 64,
];
const CRC16_TABLE_LO = [
  0, 192, 193, 1, 195, 3, 2, 194, 198, 6, 7, 199, 5, 197, 196, 4,
  204, 12, 13, 205, 15, 207, 206, 14, 10, 202, 203, 11, 201, 9, 8, 200,
  216, 24, 25, 217, 27, 219, 218, 26, 30, 222, 223, 31, 221, 29, 28, 220,
  20, 212, 213, 21, 215, 23, 22, 214, 210, 18, 19, 211, 17, 209, 208, 16,
  240, 48, 49, 241, 51, 243, 242, 50, 54, 246, 247, 55, 245, 53, 52, 244,
  60, 252, 253, 61, 255, 63, 62, 254, 250, 58, 59, 251, 57, 249, 248, 56,
  40, 232, 233, 41, 235, 43, 42, 234, 238, 46, 47, 239, 45, 237, 236, 44,
  228, 36, 37, 229, 39, 231, 230, 38, 34, 226, 227, 35, 225, 33, 32, 224,
  160, 96, 97, 161, 99, 163, 162, 98, 102, 166, 167, 103, 165, 101, 100, 164,
  108, 172, 173, 109, 175, 111, 110, 174, 170, 106, 107, 171, 105, 169, 168, 104,
  120, 184, 185, 121, 187, 123, 122, 186, 190, 126, 127, 191, 125, 189, 188, 124,
  180, 116, 117, 181, 119, 183, 182, 118, 114, 178, 179, 115, 177, 113, 112, 176,
  80, 144, 145, 81, 147, 83, 82, 146, 150, 86, 87, 151, 85, 149, 148, 84,
  156, 92, 93, 157, 95, 159, 158, 94, 90, 154, 155, 91, 153, 89, 88, 152,
  136, 72, 73, 137, 75, 139, 138, 74, 78, 142, 143, 79, 141, 77, 76, 140,
  68, 132, 133, 69, 135, 71, 70, 134, 130, 66, 67, 131, 65, 129, 128, 64,
];

// ---------------------------------------------------------------------------
// float32 / libm helpers. The original is SSE2 code without FMA: every float
// operation rounds to binary32, which Math.fround after each double operation
// reproduces exactly for + - * / sqrt.
// ---------------------------------------------------------------------------

const f = Math.fround;
const expf = (x: number): number => f(Math.exp(x));
const logf = (x: number): number => f(Math.log(x));
const log10f = (x: number): number => f(Math.log10(x));
const exp10f = (x: number): number => f(Math.pow(10, x));
const cosf = (x: number): number => f(Math.cos(x));
const sinf = (x: number): number => f(Math.sin(x));
const powf = (x: number, y: number): number => f(Math.pow(x, y));
const sqrtf = (x: number): number => f(Math.sqrt(x));

function floatsFromBits(bits: readonly number[]): Float32Array {
  return new Float32Array(Uint32Array.from(bits).buffer);
}

// ---------------------------------------------------------------------------
// Algorithm constants (addresses are mac dylib data offsets).
// ---------------------------------------------------------------------------

/** Seconds of signal setInput/OutputSignalPath load (DAT_0019fc48). */
const LOAD_SECONDS = 70;
/** Zero samples appended to each loaded buffer (DAT_0019fc4c). */
const LOAD_PAD_SAMPLES = 600;
/** Rate the blob IRs are resampled to (DAT_0019fc24). */
const BLOB_SAMPLE_RATE = 44100;
/** Model rates with a dedicated 50-tap segment FIR in startClone. */
const SUPPORTED_RATES = [44100, 48000, 96000] as const;

/** Latency search window: starts 6 s in, 600 samples long, |y| > 0.01. */
const DELAY_SEARCH_START_S = 6;
const DELAY_SEARCH_LEN = 600;
const DELAY_THRESHOLD = 0.01;

/** HTKPA::init: IR lengths, tfestimate FFT size and bin count. */
const IR1_LEN = 128; // +0x20ed4
const IR2_LEN = 2048; // +0x20ed8
const TF_NFFT = 2048; // +0x20ed0
const TF_NFREQ = 1025; // +0x20ecc
/** tfestimate segment length = (int)(sr * 0.125 + 0.5) (+0x232cc). */
const TF_SEGMENT_S = 0.125;

/** Excitation segments of the 70 s test signal used by startClone (seconds). */
const AMP_FIT_SPAN_S = 5; // block peaks over [0, 5 s)
const AMP_FIT_BLOCK_S = 0.1;
const TF_MAIN_START_S = 6; // tfestimate #1 and iterAmpCoeff #2 over [6, 21 s)
const TF_MAIN_SPAN_S = 15;
const TF_FIR_START_S = 23; // FIR-filtered segment and iterAmpCoeff #1 over [23, 28 s)
const TF_FIR_SPAN_S = 5;
const ITER3_START_S = 30; // iterAmpCoeff #3 over [30, 50 s)
const ITER3_SPAN_S = 20;
const SYNC_AVG_START_S = 50; // synchronous average over [50, 70 s)
const SYNC_AVG_SPAN_S = 20;
const SYNC_FRAME_S = 0.1;

/** Iteration counts of the three iterAmpCoeff calls (startClone @0x28c57..0x28d0c). */
const ITER_COUNTS = [3, 2, 5] as const;

/** Biquads run in double with input x*1000 and output (float)y*0.001. */
const BIQUAD_IN_GAIN = 1000.0; // DAT_0019f950
const BIQUAD_OUT_GAIN = 0.001; // DAT_0019f528

/** Partitioned convolver block and FFT sizes. */
const CONV_BLOCK = 64;
const CONV_FFT = 128;
const CONV_BINS = CONV_BLOCK + 1;
const CONV_MAX_PARTITIONS = 32;

/** Common small constants. */
const TWO_PI_F = f(6.2831854820251465); // DAT_0019fc40
const FLT_EPSILON = 1.1920928955078125e-7; // DAT_0019fcc8 / DAT_0019f968
const FLT_MAX = 3.4028234663852886e38; // DAT_0019fc6c
const RATIO_SCALE = 1e6; // DAT_0019f960
const HAMMING_A = 0.54;
const HAMMING_B = -0.46;
const HAMMING_A_F = f(0.54);
const HAMMING_B_F = f(-0.46);
const MEL_SCALE = 2595.0; // DAT_0019fcd0
const MEL_BREAK_HZ = 700.0; // DAT_0019fc0c
const DB_PER_DECADE = 20.0; // DAT_0019fc60
const DB_TO_LOG10 = f(0.05); // DAT_0019fc14

/** Amp-curve grid search (startClone @0x24600..0x271b0), float bit patterns. */
const AMP_GRID_POS_COEFF = floatsFromBits([
  0xbf4ccccd, 0xbf59999a, 0xbf666667, 0xbf733334, 0xbf800000, 0xbf866666, 0xbf8ccccc, 0xbf933332,
  0xbf999998,
]);
const AMP_GRID_NEG_COEFF = floatsFromBits([
  0x3f4ccccd, 0x3f59999a, 0x3f666667, 0x3f733334, 0x3f800000, 0x3f866666, 0x3f8ccccc, 0x3f933332,
  0x3f999998,
]);
/** Multiplier recorded for each candidate (DAT_0019f948, 0x19fc78.., 0x19fbf8). */
const AMP_GRID_FACTOR = AMP_GRID_NEG_COEFF;
const AMP_GRID_DEFAULT_FACTOR = 1.0;

/** iterAmpCoeff constants. */
const ITER_INITIAL_BEST = f(100.0); // DAT_0019fc38
const ITER_EXP_DECAY = f(0.9); // DAT_0019fcc0
const ITER_EXP_BACKOFF = f(0.5); // DAT_0019fc44
const ITER_REJECT_RATIO = 1.2; // DAT_0019f988
const ITER_GAIN_MAX = f(5.0); // _DAT_0019e740
const ITER_GAIN_MIN = 0.2; // compared in double (_DAT_0019e750)
const ITER_GAIN_MIN_F = f(0.2); // stored value (DAT_0019fcbc)
const ITER_GEO_SMOOTH_HZ = f(60.0); // DAT_0019fcc4
const ITER_ERR_POINTS = 512;
const ITER_ERR_SCALE = f(1 / 512); // DAT_0019fccc

/** Ratio of tf#1/tf#2 soft floor and the low-frequency weighting ramp. */
const RATIO_FLOOR_REL = 0.001; // DAT_0019f528
const WEIGHT_RAMP_HZ = f(80.0); // DAT_0019fcac
const WEIGHT_RAMP_END = f(0.5); // DAT_0019fc44

/** _HT_IIRDownX2 output = (pathA + delayed pathB) * 0.5 (DAT_0019fc44). */
const HALFBAND_AVG = f(0.5);

/** Final IR2 correction clamp (DAT_0019fcb0 / DAT_0019f5a0 / DAT_0019fcb4). */
const CORR_MIN_F = f(0.1);
const CORR_MIN = 0.1;
const CORR_MAX = f(10.0);
const CORR_SMOOTH_REL = 0.1;
const CORR_BANDS = 256;
const IR2_BLOB_GAIN = f(4.0); // _DAT_0019e730

/** Blob layout (startClone @0x2b210..0x2b687). */
const BLOB_SIZE = 0x2288;
const BLOB_MAGIC = [0x56, 0x54, 0x53, 0x49]; // "VTSI"
const BLOB_CRC_OFFSET = 0x08;
const BLOB_CRC_START = 0x0c;
const BLOB_PAYLOAD_SIZE_OFFSET = 0x14;
const BLOB_PAYLOAD_SIZE = 0x2200;
const BLOB_BIQUAD_OFFSET = 0x18;
const BLOB_AMP_OFFSET = 0x68;
const BLOB_IR1_OFFSET_FIELD = 0x78;
const BLOB_IR1_LEN_FIELD = 0x7c;
const BLOB_IR2_OFFSET_FIELD = 0x80;
const BLOB_IR2_LEN_FIELD = 0x84;
const BLOB_IR_DATA = 0x88;

// ---------------------------------------------------------------------------
// Derived tables.
// ---------------------------------------------------------------------------

const IIR_UP_COEFFS = floatsFromBits(IIR_UP_COEFF_BITS);
const IIR_DOWN_COEFFS = floatsFromBits(IIR_DOWN_COEFF_BITS);
/** Stage counts and coefficient offsets (_HT_NUM_STAGES_UP_IIR = {7,5}, DOWN = {6,4}). */
const UP1 = { offset: 0, stages: 7 };
const UP2 = { offset: 7, stages: 5 };
const DOWN1 = { offset: 6, stages: 4 }; // 4x -> 2x, coefficients at +0x20e08
const DOWN2 = { offset: 0, stages: 6 }; // 2x -> 1x, coefficients at +0x20df0

function segmentFir(sr: number): Float32Array {
  if (sr === 44100) return floatsFromBits(SEGMENT_FIR_44100_BITS);
  if (sr === 48000) return floatsFromBits(SEGMENT_FIR_48000_BITS);
  return floatsFromBits(SEGMENT_FIR_96000_BITS);
}

// ---------------------------------------------------------------------------
// _CJJFFT_Float_Process / _arm_rfft_f32: 128-point radix-2 complex FFT in
// float32 with Q15 twiddles (sin table scaled by 2^-15).
// ---------------------------------------------------------------------------

const CJJ_N = CONV_FFT;
const CJJ_STAGES = Math.log2(CJJ_N);
const CJJ_TWIDDLE = Float32Array.from(Q15_SINE_128, (q) => q / 32768);
const CJJ_BITREV = (() => {
  const t = new Int32Array(CJJ_N);
  for (let i = 0; i < CJJ_N; i++) {
    let r = 0;
    for (let b = 0; b < CJJ_STAGES; b++) r |= ((i >> b) & 1) << (CJJ_STAGES - 1 - b);
    t[i] = r;
  }
  return t;
})();

function cjjFft128(re: Float32Array, im: Float32Array, inverse: boolean): void {
  for (let i = 0; i < CJJ_N - 1; i++) {
    const j = CJJ_BITREV[i];
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let half = 1, span = 2; half < CJJ_N; half *= 2, span *= 2) {
    for (let a = 0; a < CJJ_N; a += span) {
      const b = a + half;
      const br = re[b];
      const bi = im[b];
      re[b] = f(re[a] - br);
      im[b] = f(im[a] - bi);
      re[a] = f(br + re[a]);
      im[a] = f(bi + im[a]);
    }
    const step = CJJ_N / span;
    for (let j = 1, t = step; j < half; j++, t += step) {
      const s = inverse ? CJJ_TWIDDLE[t] : -CJJ_TWIDDLE[t];
      const c = CJJ_TWIDDLE[(CJJ_N / 4 + CJJ_N - t) % CJJ_N];
      for (let a = j; a < CJJ_N; a += span) {
        const b = a + half;
        const br = re[b];
        const bi = im[b];
        const ar = re[a];
        const ai = im[a];
        const tr = f(f(br * c) - f(s * bi));
        const ti = f(f(br * s) + f(bi * c));
        re[b] = f(ar - tr);
        im[b] = f(ai - ti);
        re[a] = f(tr + ar);
        im[a] = f(ti + ai);
      }
    }
  }
  if (inverse) {
    for (let k = 0; k < CJJ_N; k++) {
      re[k] = f(re[k] / CJJ_N);
      im[k] = f(im[k] / CJJ_N);
    }
  }
}

// ---------------------------------------------------------------------------
// zzy_ir_instance_f32: uniformly partitioned overlap-add convolution
// (convolverInit @0x30aa0, convolverProcessMono @0x311d0): 64-sample blocks,
// 128-point CJJFFT spectra; the MAC runs over bins 0..64 and the upper half
// is rebuilt by conjugate symmetry before the inverse FFT.
// ---------------------------------------------------------------------------

class PartitionedConvolver {
  private readonly partitions: number;
  private readonly hRe: Float32Array[];
  private readonly hIm: Float32Array[];
  private readonly xRe: Float32Array[];
  private readonly xIm: Float32Array[];
  private readonly overlap = new Float32Array(CONV_BLOCK);
  private readonly fftRe = new Float32Array(CJJ_N);
  private readonly fftIm = new Float32Array(CJJ_N);
  private readonly accRe = new Float32Array(CJJ_N);
  private readonly accIm = new Float32Array(CJJ_N);
  private current = 0;

  constructor(ir: Float32Array, length: number) {
    this.partitions = Math.ceil(f(length * f(1 / CONV_BLOCK)));
    if (this.partitions > CONV_MAX_PARTITIONS) throw new RangeError(`IR too long: ${length}`);
    this.hRe = [];
    this.hIm = [];
    this.xRe = [];
    this.xIm = [];
    for (let p = 0; p < this.partitions; p++) {
      const block = new Float32Array(CONV_BLOCK);
      for (let i = 0; i < CONV_BLOCK; i++) {
        const k = p * CONV_BLOCK + i;
        block[i] = k < length ? ir[k] : 0;
      }
      const spec = this.forward(block, 0);
      this.hRe.push(spec.re);
      this.hIm.push(spec.im);
      this.xRe.push(new Float32Array(CONV_BINS));
      this.xIm.push(new Float32Array(CONV_BINS));
    }
  }

  private forward(src: Float32Array, offset: number): { re: Float32Array; im: Float32Array } {
    const re = this.fftRe;
    const im = this.fftIm;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < CONV_BLOCK; i++) re[i] = src[offset + i];
    cjjFft128(re, im, false);
    const outRe = new Float32Array(CONV_BINS);
    const outIm = new Float32Array(CONV_BINS);
    outRe.set(re.subarray(0, CONV_BINS));
    outIm.set(im.subarray(0, CONV_BINS));
    return { re: outRe, im: outIm };
  }

  /** Filters 64 samples of buf starting at offset, in place. */
  processBlock(buf: Float32Array, offset: number): void {
    const P = this.partitions;
    const slot = this.current;
    const spec = this.forward(buf, offset);
    this.xRe[slot].set(spec.re);
    this.xIm[slot].set(spec.im);
    const accRe = this.accRe;
    const accIm = this.accIm;
    accRe.fill(0);
    accIm.fill(0);
    for (let u = 0; u < P; u++) {
      const s = (((slot - u) % P) + P) % P;
      const xr = this.xRe[s];
      const xi = this.xIm[s];
      const hr = this.hRe[u];
      const hi = this.hIm[u];
      for (let k = 0; k < CONV_BINS; k++) {
        accRe[k] = f(f(f(xr[k] * hr[k]) - f(hi[k] * xi[k])) + accRe[k]);
        accIm[k] = f(f(f(xr[k] * hi[k]) + f(xi[k] * hr[k])) + accIm[k]);
      }
    }
    for (let k = 1; k < CONV_BLOCK; k++) {
      accRe[CJJ_N - k] = accRe[k];
      accIm[CJJ_N - k] = -accIm[k];
    }
    const re = this.fftRe;
    const im = this.fftIm;
    re.set(accRe);
    im.set(accIm);
    cjjFft128(re, im, true);
    for (let k = 0; k < CONV_BLOCK; k++) {
      buf[offset + k] = f(re[k] + this.overlap[k]);
      this.overlap[k] = re[CONV_BLOCK + k];
    }
    this.current = (slot + 1) % P;
  }
}

/**
 * The block loop + zero-padded tail used everywhere in startClone and
 * iterAmpCoeff: filters src[srcOff..srcOff+n) into dst[dstOff..) (may alias).
 */
function convolveBlocks(
  ir: Float32Array,
  irLen: number,
  src: Float32Array,
  srcOff: number,
  dst: Float32Array,
  dstOff: number,
  n: number,
): void {
  const conv = new PartitionedConvolver(ir, irLen);
  const work = new Float32Array(CONV_BLOCK);
  let j = 0;
  for (; j <= n - CONV_BLOCK; j += CONV_BLOCK) {
    work.set(src.subarray(srcOff + j, srcOff + j + CONV_BLOCK));
    conv.processBlock(work, 0);
    dst.set(work, dstOff + j);
  }
  const rem = n % CONV_BLOCK;
  if (rem !== 0) {
    work.fill(0);
    work.set(src.subarray(srcOff + n - rem, srcOff + n));
    conv.processBlock(work, 0);
    dst.set(work.subarray(0, rem), dstOff + n - rem);
  }
}

// ---------------------------------------------------------------------------
// audiofft::OouraFFT (@0x32920/0x32e40): AudioFFT's wrapper around Ooura's
// fft4g rdft in double precision. The rdft itself is the same fft4g code r8brain
// uses, so the RealFft class of the resampler section below is shared.
// ---------------------------------------------------------------------------

class OouraFft {
  private readonly size: number;
  private readonly rdft: RealFft;
  private readonly buf: Float64Array;

  constructor(size: number) {
    this.size = size;
    this.rdft = getFft(Math.log2(size));
    this.buf = new Float64Array(size);
  }

  /** AudioFFT OouraFFT::fft: re/im get size/2+1 bins (im negated, rounded to float). */
  fft(data: Float32Array, re: Float32Array, im: Float32Array): void {
    const n = this.size;
    const a = this.buf;
    for (let i = 0; i < n; i++) a[i] = data[i];
    this.rdft.forward(a);
    for (let i = 0; i < n / 2; i++) {
      re[i] = a[2 * i];
      im[i] = -f(a[2 * i + 1]);
    }
    re[n / 2] = -im[0];
    im[0] = 0;
    im[n / 2] = 0;
  }
}

// ---------------------------------------------------------------------------
// computeSinCosTable @0x230c0.
// ---------------------------------------------------------------------------

function computeSinCosTable(n: number): { sin: Float32Array; cos: Float32Array } {
  const sin = new Float32Array(n);
  const cos = new Float32Array(n);
  const half = Math.trunc(f(0.5 * n));
  const step = f(TWO_PI_F / n);
  for (let i = 0; i < half; i++) {
    const arg = f(i * step);
    sin[i] = sinf(arg);
    cos[i] = cosf(arg);
  }
  for (let i = half; i < n; i++) {
    sin[i] = -sin[i - half];
    cos[i] = -cos[i - half];
  }
  return { sin, cos };
}

// ---------------------------------------------------------------------------
// Biquads (double precision DF-II as inlined in startClone/iterAmpCoeff).
// ---------------------------------------------------------------------------

interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Pre-filter at +0x232d8 in mode 0: a pass-through (copied from +0x24338). */
const PRE_BIQUAD: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

/** HTKPA::init: 2nd-order high-pass (numLC/denLC_profile), float math widened to double. */
function lowCutBiquad(sr: number): BiquadCoeffs {
  const C = floatsFromBits([0x9797147a, 0x4331b73f, 0x4676bdcf, 0x1817147a, 0xc6f6bdcf, 0xc331b73f]);
  const [k0, k1, k2, k3, k4, k5] = C; // DAT_0019fcf4..0x19fd08
  const sr2 = f(sr * sr);
  const den = f(f(f(k1 * sr) + sr2) + k2);
  const twoSr2 = f(sr2 + sr2);
  const b0 = f(f(k0 + sr2) / den);
  const b1 = f(-f(k3 + twoSr2) / den);
  const a1 = f(-f(k4 + twoSr2) / den);
  const a2 = f(f(f(f(k5 * sr) + sr2) + k2) / den);
  return { b0, b1, b2: b0, a1, a2 };
}

function biquadFilter(src: Float32Array, srcOff: number, dst: Float32Array, n: number, c: BiquadCoeffs): void {
  const na1 = -c.a1;
  const na2 = -c.a2;
  let w1 = 0;
  let w2 = 0;
  for (let i = 0; i < n; i++) {
    const w = na1 * w1 + (na2 * w2 + src[srcOff + i] * BIQUAD_IN_GAIN);
    const y = c.b0 * w + (c.b2 * w2 + c.b1 * w1);
    dst[i] = f(f(y) * BIQUAD_OUT_GAIN);
    w2 = w1;
    w1 = w;
  }
}

// ---------------------------------------------------------------------------
// 4x oversampled exponential waveshaper (_HT_IIRUpX2 / _HT_IIRDownX2 polyphase
// allpass half-band filters around the fitted amp curve).
// ---------------------------------------------------------------------------

interface AmpCurve {
  readonly posPeak: number; // +0x243f8
  readonly negPeak: number; // +0x243fc
  readonly kPos: number; // +0x24400
  readonly kNeg: number; // +0x24404
}

function allpassChain(x: number, coeffs: Float32Array, state: Float32Array, from: number, to: number): number {
  for (let k = from; k < to; k++) {
    const y = f(f(coeffs[k] * x) + state[k]);
    state[k] = f(x - f(coeffs[k] * y));
    x = y;
  }
  return x;
}

class OversampledShaper {
  private readonly up1 = new Float32Array(UP1.stages);
  private readonly up2 = new Float32Array(UP2.stages);
  private readonly down1 = new Float32Array(DOWN1.stages);
  private readonly down2 = new Float32Array(DOWN2.stages);
  private prev1 = 0;
  private prev2 = 0;
  private readonly x2 = new Float32Array(2);
  private readonly x4 = new Float32Array(4);
  private readonly coeffPos: number;
  private readonly coeffNeg: number;
  private readonly ampPos: number;
  private readonly ampNeg: number;

  constructor(amp: AmpCurve) {
    this.coeffPos = -amp.kPos;
    this.coeffNeg = amp.kNeg;
    this.ampPos = amp.posPeak;
    this.ampNeg = -amp.negPeak;
  }

  private static upsample(x: number, out: Float32Array, at: number, stage: typeof UP1, state: Float32Array): void {
    const c = IIR_UP_COEFFS.subarray(stage.offset, stage.offset + stage.stages);
    const split = stage.stages - (stage.stages >> 1);
    out[at] = allpassChain(x, c, state, 0, split);
    out[at + 1] = allpassChain(x, c, state, split, stage.stages);
  }

  private downsample(x0: number, x1: number, stage: typeof DOWN1, state: Float32Array, second: boolean): number {
    const c = IIR_DOWN_COEFFS.subarray(stage.offset, stage.offset + stage.stages);
    const split = stage.stages - (stage.stages >> 1);
    const a = allpassChain(x0, c, state, 0, split);
    const b = allpassChain(x1, c, state, split, stage.stages);
    const prev = second ? this.prev2 : this.prev1;
    const y = f(f(a + prev) * HALFBAND_AVG);
    if (second) this.prev2 = b;
    else this.prev1 = b;
    return y;
  }

  process(x: number): number {
    const { x2, x4 } = this;
    OversampledShaper.upsample(x, x2, 0, UP1, this.up1);
    OversampledShaper.upsample(x2[0], x4, 0, UP2, this.up2);
    OversampledShaper.upsample(x2[1], x4, 2, UP2, this.up2);
    for (let i = 0; i < 4; i++) {
      const v = x4[i];
      const positive = 0 < v;
      const coeff = positive ? this.coeffPos : this.coeffNeg;
      const gain = positive ? this.ampPos : this.ampNeg;
      x4[i] = f(f(1 - expf(f(coeff * v))) * gain);
    }
    const y0 = this.downsample(x4[0], x4[1], DOWN1, this.down1, false);
    const y1 = this.downsample(x4[2], x4[3], DOWN1, this.down1, false);
    return this.downsample(y0, y1, DOWN2, this.down2, true);
  }
}

/** biquad(pre) -> 4x shaper -> biquad(low cut), the model of the amp used everywhere. */
function ampModelChain(
  src: Float32Array,
  srcOff: number,
  n: number,
  ctx: CloneContext,
  between?: (buf: Float32Array) => void,
): Float32Array {
  const buf = new Float32Array(n);
  biquadFilter(src, srcOff, buf, n, PRE_BIQUAD);
  if (between) between(buf);
  const shaper = new OversampledShaper(ctx.amp);
  for (let i = 0; i < n; i++) buf[i] = shaper.process(buf[i]);
  biquadFilter(buf, 0, buf, n, ctx.lowCut);
  return buf;
}

// ---------------------------------------------------------------------------
// HTKPA::smoothdata @0x2d720: Gaussian smoothing (MATLAB smoothdata style).
// ---------------------------------------------------------------------------

const SMOOTH_GAUSS_SPAN = 5.0; // DAT_0019f998
const SMOOTH_CENTER_SCALE = 1e-6; // DAT_0019f9a0

function smoothdata(src: Float32Array, dst: Float32Array, n: number, window: number): void {
  const g = new Float64Array(Math.max(window, 0));
  let sum = 0.0;
  if (window >= 1) {
    const scale = SMOOTH_GAUSS_SPAN / window;
    const center = Math.ceil(window * 0.5);
    for (let i = 0; i < window; i++) {
      const t = (i + 1 - center) * scale;
      g[i] = Math.exp(t * -0.5 * t);
      sum += g[i];
    }
  }
  const len = window | 1;
  const kernel = new Float64Array(Math.max(len, 1));
  if (window > 0) {
    const norm = RATIO_SCALE / sum;
    for (let j = 0; j < window; j++) kernel[j] = g[window - 1 - j] * norm;
  }
  if (n <= 0) return;
  const c2 = Math.ceil(len * 0.5);
  const half = c2 - 1;
  const right = len - c2;
  for (let i = 0; i < n; i++) {
    const lo = Math.min(i, half);
    if (i < half || i >= n - right) {
      const hi = i < n - right ? right : n - 1 - i;
      let value = NaN;
      if (-lo <= hi) {
        let acc = 0.0;
        let wsum = 0.0;
        for (let j = -lo; j <= hi; j++) {
          wsum += kernel[j + half];
          acc += src[i + j] * kernel[j + half];
        }
        value = acc / wsum;
      }
      dst[i] = value;
    } else {
      let acc = 0.0;
      for (let j = -half; j <= right; j++) acc += src[i + j] * kernel[j + half];
      dst[i] = acc * SMOOTH_CENTER_SCALE;
    }
  }
}

// ---------------------------------------------------------------------------
// HTKPA::interp1 @0x2eae0: piecewise-linear interpolation (last segment
// extrapolated, FLT_MAX where no knot lies at or below the query).
// ---------------------------------------------------------------------------

function interp1(x: Float32Array, n: number, y: Float32Array, xi: Float32Array, m: number, out: Float32Array): void {
  if (n < 1) {
    out.fill(FLT_MAX, 0, m);
    return;
  }
  const slope = new Float32Array(n);
  const icpt = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (k < n - 1) {
      slope[k] = f(f(y[k + 1] - y[k]) / f(x[k + 1] - x[k]));
      icpt[k] = f(y[k] - f(x[k] * slope[k]));
    } else {
      slope[k] = slope[k - 1];
      icpt[k] = icpt[k - 1];
    }
  }
  for (let q = 0; q < m; q++) {
    const v = xi[q];
    let best = FLT_MAX;
    let idx = -1;
    for (let k = 0; k < n; k++) {
      const d = f(v - x[k]);
      if (0 <= d && d < best) {
        best = d;
        idx = k;
      }
    }
    out[q] = idx < 0 ? FLT_MAX : f(f(v * slope[idx]) + icpt[idx]);
  }
}

// ---------------------------------------------------------------------------
// HTKPA::downSampleSmoothFreq @0x2d040: dB smoothing on a mel-spaced axis,
// resampled to `m` points on a linear axis. `out`/`outFreq` may alias `freq`.
// ---------------------------------------------------------------------------

const DOWNSAMPLE_SMOOTH_REL = 0.002; // _DAT_0019f990

function hzToMel(hz: number): number {
  return f(log10f(f(f(hz / MEL_BREAK_HZ) + 1)) * MEL_SCALE);
}

function melToHz(mel: number): number {
  return f(f(exp10f(f(mel / MEL_SCALE)) + -1) * MEL_BREAK_HZ);
}

/** Linear ramp a..b over n points, accumulated in float, last point exact. */
function linspaceF(a: number, b: number, n: number, out: Float32Array): void {
  out[0] = a;
  if (n > 1) {
    const step = f(f(b - a) / f(n - 1));
    let v = a;
    for (let k = 1; k < n; k++) {
      v = f(v + step);
      out[k] = v;
    }
  }
  out[n - 1] = b;
}

function downSampleSmoothFreq(
  src: Float32Array,
  freq: Float32Array,
  n: number,
  m: number,
  out: Float32Array,
  outFreq: Float32Array,
): void {
  const db = new Float32Array(n);
  const tmp = new Float32Array(n);
  const melN = new Float32Array(n);
  const hzN = new Float32Array(n);
  const melM = new Float32Array(m);
  const hzM = new Float32Array(m);
  const f0 = freq[0];
  const fLast = freq[n - 1];
  const mel0 = hzToMel(f0);
  const melLast = hzToMel(fLast);
  linspaceF(mel0, melLast, n, melN);
  for (let k = 0; k < n; k++) hzN[k] = melToHz(melN[k]);
  hzN[0] = freq[0];
  hzN[n - 1] = freq[n - 1];
  linspaceF(mel0, melLast, m, melM);
  for (let k = 0; k < m; k++) hzM[k] = melToHz(melM[k]);
  hzM[0] = freq[0];
  hzM[m - 1] = freq[n - 1];
  linspaceF(freq[0], freq[n - 1], m, outFreq);
  for (let k = 0; k < n; k++) db[k] = f(log10f(src[k]) * DB_PER_DECADE);
  smoothdata(db, tmp, n, Math.trunc(n * DOWNSAMPLE_SMOOTH_REL));
  db.set(tmp);
  interp1(freq, n, db, hzN, n, tmp);
  smoothdata(tmp, db, n, Math.trunc(n / m) * 2);
  tmp.set(db);
  let onMelM = db;
  if (n !== m) {
    onMelM = new Float32Array(m);
    interp1(melN, n, tmp, melM, m, onMelM);
  }
  interp1(hzM, m, onMelM, outFreq, m, out);
  for (let k = 0; k < m; k++) out[k] = exp10f(f(out[k] * DB_TO_LOG10));
}

// ---------------------------------------------------------------------------
// HTKPA::minPhaseIR @0x2ddb0: real-cepstrum minimum-phase reconstruction with
// direct float DFTs, energy matched to the full-length response.
// ---------------------------------------------------------------------------

const MINPHASE_FLOOR_REL = 1e-5; // __exp10(-5.0)

function minPhaseIR(mag: Float32Array, bins: number, outLen: number, out: Float32Array): void {
  const N = 2 * bins - 2;
  const full = new Float32Array(N);
  full.set(mag.subarray(0, bins));
  for (let k = bins; k < N; k++) full[k] = mag[N - k];
  const logMag = Float32Array.from(full);
  if (bins > 1) {
    let peak = 0;
    for (let k = 0; k < N; k++) {
      const v = Math.abs(full[k]);
      if (v > peak) peak = v;
    }
    if (peak !== 0) {
      const floor = f(MINPHASE_FLOOR_REL * peak);
      for (let k = 0; k < N; k++) logMag[k] = Math.abs(full[k]) < floor ? floor : full[k];
    }
    for (let k = 0; k < N; k++) logMag[k] = logf(f(logMag[k] + f(FLT_EPSILON)));
  }
  const { sin, cos } = computeSinCosTable(N);
  const invN = f(1 / N);
  // Real cepstrum: c[k] = (1/N) sum_j log|H_j| e^{+i 2pi jk/N}.
  const cepRe = new Float32Array(N);
  const cepIm = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0, idx = 0; j < N; j++, idx = (idx + k) % N) {
      re = f(re + f(cos[idx] * logMag[j]));
      im = f(im + f(sin[idx] * logMag[j]));
    }
    cepRe[k] = f(re * invN);
    cepIm[k] = f(im * invN);
  }
  // Fold onto the causal half: c[k] + conj(c[N-k]).
  const foldRe = new Float32Array(N);
  const foldIm = new Float32Array(N);
  const halfN = N >> 1;
  foldRe[0] = cepRe[0];
  foldIm[0] = cepIm[0];
  for (let k = 1; k < halfN; k++) {
    foldRe[k] = f(cepRe[k] + cepRe[N - k]);
    foldIm[k] = f(cepIm[k] - cepIm[N - k]);
  }
  foldRe[halfN] = cepRe[halfN];
  foldIm[halfN] = -cepIm[halfN];
  // Forward DFT of the folded cepstrum, exp() -> minimum-phase spectrum.
  const specRe = new Float32Array(N);
  const specIm = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0, idx = 0; j < N; j++, idx = (idx + k) % N) {
      re = f(re + f(f(cos[idx] * foldRe[j]) + f(foldIm[j] * sin[idx])));
      im = f(im + f(-f(sin[idx] * foldRe[j]) + f(foldIm[j] * cos[idx])));
    }
    const e = expf(re);
    specRe[k] = f(e * cosf(im));
    specIm[k] = f(e * sinf(im));
  }
  // Inverse DFT, real part.
  const ir = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let acc = 0;
    for (let j = 0, idx = 0; j < N; j++, idx = (idx + k) % N) {
      acc = f(acc + f(f(specRe[j] * cos[idx]) - f(sin[idx] * specIm[j])));
    }
    ir[k] = f(acc * invN);
  }
  let energyFull = 0;
  for (let k = 0; k < N; k++) energyFull = f(energyFull + f(ir[k] * ir[k]));
  for (let k = 0; k < outLen; k++) out[k] = ir[k];
  if (outLen <= 0) return;
  let mean = 0;
  for (let k = 0; k < outLen; k++) mean = f(mean + out[k]);
  mean = f(mean / outLen);
  for (let k = 0; k < outLen; k++) out[k] = f(out[k] - mean);
  let energyOut = 0;
  for (let k = 0; k < outLen; k++) energyOut = f(energyOut + f(out[k] * out[k]));
  const gain = f(sqrtf(energyFull) / sqrtf(energyOut));
  for (let k = 0; k < outLen; k++) out[k] = f(out[k] * gain);
}

// ---------------------------------------------------------------------------
// HTKPA::tfestimate @0x2f2e0: H1 transfer-function magnitude |Pxy|/(Pxx+eps)
// with Hamming windows, 50 % overlap and time-aliasing into nfft bins.
// ---------------------------------------------------------------------------

const TF_INPUT_GAIN = f(1000.0); // DAT_0019fce0

function tfestimate(
  x: Float32Array,
  xOff: number,
  y: Float32Array,
  yOff: number,
  n: number,
  seglen: number,
  nfft: number,
  nfreq: number,
  outMag: Float32Array,
  outFreq: Float32Array,
  sr: number,
): void {
  const win = new Float32Array(seglen);
  const denom = f(seglen - 1);
  for (let i = 0; i < seglen; i++) {
    win[i] = f(f(cosf(f(f(i * TWO_PI_F) / denom)) * HAMMING_B_F) + HAMMING_A_F);
  }
  if (Math.trunc(nfft / 2) + 1 !== nfreq) throw new RangeError('tfestimate: nfreq != nfft/2+1');
  const fft = new OouraFft(nfft);
  const pxx = new Float32Array(nfreq);
  const pxyRe = new Float32Array(nfreq);
  const pxyIm = new Float32Array(nfreq);
  const bx = new Float32Array(seglen);
  const by = new Float32Array(seglen);
  const fx = new Float32Array(nfft);
  const fy = new Float32Array(nfft);
  const xr = new Float32Array(nfreq);
  const xi = new Float32Array(nfreq);
  const yr = new Float32Array(nfreq);
  const yi = new Float32Array(nfreq);
  const segF = f(seglen);
  if (n > 0) {
    const hop = seglen - Math.trunc(seglen * 0.5);
    const chunks = Math.ceil(f(segF / f(nfft)));
    let pos = 0;
    let last = false;
    do {
      if (n - seglen <= pos) {
        last = true;
        pos = n - seglen;
      }
      for (let i = 0; i < seglen; i++) {
        bx[i] = f(x[xOff + pos + i] * TF_INPUT_GAIN);
        by[i] = f(y[yOff + pos + i] * TF_INPUT_GAIN);
      }
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < seglen; i++) {
        sx = f(sx + bx[i]);
        sy = f(sy + by[i]);
      }
      const mx = f(sx / segF);
      const my = f(sy / segF);
      for (let i = 0; i < seglen; i++) {
        bx[i] = f(f(bx[i] - mx) * win[i]);
        by[i] = f(f(by[i] - my) * win[i]);
      }
      fx.fill(0);
      fy.fill(0);
      if (nfft < seglen) {
        for (let c = 0; c < chunks; c++) {
          const count = Math.min(nfft, seglen - c * nfft);
          for (let i = 0; i < count; i++) {
            fx[i] = f(fx[i] + bx[c * nfft + i]);
            fy[i] = f(fy[i] + by[c * nfft + i]);
          }
        }
      } else {
        fx.set(bx);
        fy.set(by);
      }
      fft.fft(fx, xr, xi);
      fft.fft(fy, yr, yi);
      for (let k = 0; k < nfreq; k++) {
        pxx[k] = f(pxx[k] + f(f(xr[k] * xr[k]) + f(xi[k] * xi[k])));
        pxyRe[k] = f(pxyRe[k] + f(f(yr[k] * xr[k]) + f(xi[k] * yi[k])));
        pxyIm[k] = f(pxyIm[k] + f(f(yi[k] * xr[k]) - f(xi[k] * yr[k])));
      }
      pos += hop;
    } while (pos < n && !last);
  }
  const nfftF = f(nfft);
  for (let k = 0; k < nfreq; k++) {
    const num = sqrtf(f(f(pxyRe[k] * pxyRe[k]) + f(pxyIm[k] * pxyIm[k])));
    outMag[k] = f(num / f(pxx[k] + f(FLT_EPSILON)));
    outFreq[k] = f(f(f(k) / nfftF) * sr);
  }
}

// ---------------------------------------------------------------------------
// startClone context (the HTKPA fields startClone reads, derived from init(sr)).
// ---------------------------------------------------------------------------

interface CloneContext {
  readonly sr: number;
  readonly srInt: number;
  readonly nyquist: number; // +0x20ec4
  readonly invNyquist: number; // +0x20ec8
  readonly seglen: number; // +0x232cc
  readonly lowCut: BiquadCoeffs; // +0x23300
  readonly melGrid: Float32Array; // +0x23b28, 512 log-spaced frequencies 80 Hz..10 kHz
  readonly input: Float32Array; // +0x243e0
  readonly output: Float32Array; // +0x243e8
  delay: number;
  amp: AmpCurve;
}

const MEL_GRID_START = f(121.95606994628906); // mel(80 Hz), DAT_0019fce4
const MEL_GRID_STEP = f(5.77547025680542); // DAT_0019fce8
const MEL_GRID_FIRST_HZ = 80.0;
const MEL_GRID_LAST_HZ = 10000.0;

function buildMelGrid(): Float32Array {
  const grid = new Float32Array(ITER_ERR_POINTS);
  let mel = MEL_GRID_START;
  grid[0] = MEL_GRID_FIRST_HZ;
  for (let k = 1; k < ITER_ERR_POINTS - 1; k++) {
    mel = f(mel + MEL_GRID_STEP);
    grid[k] = melToHz(mel);
  }
  grid[ITER_ERR_POINTS - 1] = MEL_GRID_LAST_HZ;
  return grid;
}

/** setInput/OutputSignalPath: first 70*sr samples of channel 0, 600 zeros appended. */
function loadSignal(samples: Float32Array, sr: number, what: string): Float32Array {
  const needed = f(sr * LOAD_SECONDS);
  if (!(f(samples.length) >= needed)) {
    throw new RangeError(`${what}: need at least ${LOAD_SECONDS} s (${needed} samples), got ${samples.length}`);
  }
  const total = Math.trunc(f(f(needed + LOAD_PAD_SAMPLES) * 4) / 4);
  const buf = new Float32Array(total);
  for (let i = 0; f(i) < needed; i++) buf[i] = samples[i];
  return buf;
}

function createContext(input: Float32Array, output: Float32Array, sampleRate: number): CloneContext {
  const sr = f(sampleRate);
  if (!(SUPPORTED_RATES as readonly number[]).includes(sr)) {
    throw new RangeError(`unsupported sample rate ${sampleRate} (startClone has FIRs for 44100/48000/96000)`);
  }
  const nyquist = f(0.5 * sr);
  return {
    sr,
    srInt: Math.trunc(sr),
    nyquist,
    invNyquist: f(1 / nyquist),
    seglen: Math.trunc(f(TF_SEGMENT_S * sr) + 0.5),
    lowCut: lowCutBiquad(sr),
    melGrid: buildMelGrid(),
    input: loadSignal(input, sr, 'input'),
    output: loadSignal(output, sr, 'output'),
    delay: 0,
    amp: { posPeak: 0, negPeak: 0, kPos: 0, kNeg: 0 },
  };
}

// ---------------------------------------------------------------------------
// startClone step 1: remove mean and linear trend from the output recording.
// ---------------------------------------------------------------------------

function detrendOutput(ctx: CloneContext): void {
  const y = ctx.output;
  const n = f(f(ctx.sr * LOAD_SECONDS) + LOAD_PAD_SAMPLES);
  let sum = 0;
  for (let i = 0; i === 0 || f(i) < n; i++) sum = f(sum + y[i]);
  const mean = f(sum / n);
  for (let i = 0; i === 0 || f(i) < n; i++) y[i] = f(y[i] - mean);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; ; i++) {
    const x = f(i + 1);
    sx = f(sx + x);
    sy = f(sy + y[i]);
    sxx = f(sxx + f(x * x));
    sxy = f(sxy + f(y[i] * x));
    if (!(n > x)) break;
  }
  const slope = f(f(f(sxy * n) - f(sy * sx)) / f(f(sxx * n) - f(sx * sx)));
  const intercept = f(f(sy - f(sx * slope)) / n);
  for (let i = 0; ; i++) {
    const x = f(i + 1);
    y[i] = f(y[i] - f(f(slope * x) + intercept));
    if (!(n > x)) break;
  }
}

/** startClone step 2: latency = first |y| > 0.01 within 600 samples after 6 s (600 if none). */
function findDelay(ctx: CloneContext): number {
  const start = ctx.srInt * DELAY_SEARCH_START_S;
  const end = start + DELAY_SEARCH_LEN - 1;
  let delay = 0;
  for (let i = start; i <= Math.max(end, start); i++) {
    if (Math.abs(ctx.output[i]) > DELAY_THRESHOLD) return i - start;
    if (i === end) delay = DELAY_SEARCH_LEN;
  }
  return delay;
}

// ---------------------------------------------------------------------------
// startClone step 3: fit y = A(1 - exp(k x)) to the 0.1 s block peaks of the
// first 5 s (input |x| peak vs output max/min), separately per polarity.
// ---------------------------------------------------------------------------

function fitAmpCurve(ctx: CloneContext): AmpCurve {
  const { input, output, delay, sr } = ctx;
  const blockLen = f(sr * AMP_FIT_BLOCK_S);
  const spanF = f(AMP_FIT_SPAN_S * sr);
  const blocks = Math.trunc(Math.floor(f(f(Math.trunc(spanF)) / blockLen)));
  const inPeak = new Float32Array(blocks);
  const outMax = new Float32Array(blocks);
  const outMin = new Float32Array(blocks);
  let posPeak = 0;
  let negPeak = 0;
  for (let b = 0; b < blocks; b++) {
    const s = Math.trunc(f(b * blockLen));
    const e = Math.trunc(f((b + 1) * blockLen));
    for (let j = s; j < e; j++) {
      const a = Math.abs(input[j]);
      if (a > inPeak[b]) inPeak[b] = a;
      const v = output[delay + j];
      if (v > outMax[b]) outMax[b] = v;
      if (outMin[b] > v) outMin[b] = v;
    }
    if (-outMin[b] > negPeak) negPeak = -outMin[b];
    if (outMax[b] > posPeak) posPeak = outMax[b];
  }
  const n2 = 2 * blocks;
  const xs = new Float32Array(n2);
  const ys = new Float32Array(n2);
  for (let k = 0; k < blocks; k++) {
    xs[k] = -inPeak[blocks - 1 - k];
    xs[blocks + k] = inPeak[k];
    ys[k] = outMin[blocks - 1 - k];
    ys[blocks + k] = outMax[k];
  }
  let posCount = 0;
  for (let k = 0; k < blocks; k++) {
    if (posPeak * 0.5 <= outMax[k]) {
      posCount = k + 1;
      break;
    }
  }
  let negCount = 0;
  for (let k = 0; k < blocks; k++) {
    if (outMin[k] <= negPeak * -0.5) {
      negCount = k + 1;
      break;
    }
  }
  const slopeOf = (count: number, target: (k: number) => number): number => {
    if (count <= 0) return NaN;
    let sxx = 0.0;
    let sxy = 0.0;
    for (let k = 0; k < count; k++) {
      sxx += inPeak[k] * inPeak[k];
      sxy += target(k) * inPeak[k];
    }
    return sxy / sxx;
  };
  const kPos0 = f(f(slopeOf(posCount, (k) => outMax[k])) / posPeak);
  const kNeg0 = f(f(slopeOf(negCount, (k) => -outMin[k])) / negPeak);
  const negAmp = -negPeak;
  const sse = (coeffPos: number, coeffNeg: number): number => {
    let acc = 0;
    for (let k = 0; k < n2; k++) {
      const x = xs[k];
      const coeff = 0 < x ? coeffPos : coeffNeg;
      const amp = x > 0 ? posPeak : negAmp;
      const err = f(ys[k] - f(f(1 - expf(f(coeff * x))) * amp));
      acc = f(acc + f(err * err));
    }
    return acc;
  };
  const search = (cost: (i: number) => number): number => {
    let best = FLT_MAX;
    let factor = AMP_GRID_DEFAULT_FACTOR;
    for (let i = 0; i < AMP_GRID_FACTOR.length; i++) {
      const s = cost(i);
      if (s <= best) {
        best = s;
        factor = AMP_GRID_FACTOR[i];
      }
    }
    return factor;
  };
  const posCoeff = (i: number): number => (i === 4 ? -kPos0 : f(AMP_GRID_POS_COEFF[i] * kPos0));
  const kPos = f(kPos0 * search((i) => sse(posCoeff(i), kNeg0)));
  const negCoeff = (i: number): number => (i === 4 ? kNeg0 : f(AMP_GRID_NEG_COEFF[i] * kNeg0));
  const kNeg = f(kNeg0 * search((i) => sse(-kPos, negCoeff(i))));
  return { posPeak, negPeak, kPos, kNeg };
}

// ---------------------------------------------------------------------------
// startClone step 4: transfer functions of the modelled amp vs the recording.
// ---------------------------------------------------------------------------

/** A window of the excitation (x) and the time-aligned recording (y). */
interface SignalWindow {
  readonly x: Float32Array;
  readonly xOff: number;
  readonly y: Float32Array;
  readonly yOff: number;
  readonly n: number;
}

function excitationWindow(ctx: CloneContext, startSeconds: number, n: number): SignalWindow {
  const start = ctx.srInt * startSeconds;
  return { x: ctx.input, xOff: start, y: ctx.output, yOff: ctx.delay + start, n };
}

interface TfPair {
  readonly ratio: Float32Array; // pfVar40: tf#1 / soft-floored tf#2
  readonly mag: Float32Array; // pfVar44: smoothed, soft-floored tf#2
  readonly freq: Float32Array; // pvVar43
}

/** tf#1 ("tfamp" on Windows): modelled amp on [6, 21 s) vs the recording. */
function tfMain(ctx: CloneContext, w: SignalWindow): Float32Array {
  const mag = new Float32Array(TF_NFREQ);
  const freq = new Float32Array(TF_NFREQ);
  const x = ampModelChain(w.x, w.xOff, w.n, ctx);
  tfestimate(x, 0, w.y, w.yOff, w.n, ctx.seglen, TF_NFFT, TF_NFREQ, mag, freq, ctx.sr);
  return mag;
}

/** tf#2 on the FIR-filtered [23, 28 s) segment, smoothed and soft-floored; ratio tf#1/tf#2. */
function tfRatio(ctx: CloneContext, w: SignalWindow, mag1: Float32Array): TfPair {
  const firOut = new Float32Array(w.n);
  const fir = segmentFir(ctx.sr);
  convolveBlocks(fir, fir.length, w.x, w.xOff, firOut, 0, w.n);
  const x2 = ampModelChain(firOut, 0, w.n, ctx);
  const mag = new Float32Array(TF_NFREQ);
  const freq = new Float32Array(TF_NFREQ);
  tfestimate(x2, 0, w.y, w.yOff, w.n, ctx.seglen, TF_NFFT, TF_NFREQ, mag, freq, ctx.sr);
  const tmp = new Float32Array(TF_NFREQ);
  smoothdata(mag, tmp, TF_NFREQ, Math.trunc(0.001 * TF_NFREQ));
  smoothdata(tmp, mag, TF_NFREQ, Math.trunc(TF_NFREQ * 0.005));

  let peak = 0;
  for (let k = 0; k < TF_NFREQ; k++) if (mag1[k] > peak) peak = mag1[k];
  const floor = f(peak * RATIO_FLOOR_REL);
  const knee = f(floor + floor);
  const curve = f(f(knee - floor) / f(knee * knee));
  for (let k = 0; k < TF_NFREQ; k++) {
    const v = mag[k];
    if (v < knee) mag[k] = f(f(f(curve * v) * v) + floor);
  }
  const ratio = new Float32Array(TF_NFREQ);
  for (let k = 0; k < TF_NFREQ; k++) ratio[k] = safeRatio(mag1[k], mag[k]);
  return { ratio, mag, freq };
}

/** (float)(a*1e6 / (b*1e6 + FLT_EPSILON)) in double. */
function safeRatio(a: number, b: number): number {
  return f((a * RATIO_SCALE) / (b * RATIO_SCALE + FLT_EPSILON));
}

// ---------------------------------------------------------------------------
// HTKPA::iterAmpCoeff @0x2b6c0: alternately refines IR1 (pre-amp EQ, 128
// taps, from the tf ratio) and IR2 (post-amp cabinet, 2048 taps, from the
// measured transfer function), keeping the best iteration by mel-grid error.
// ---------------------------------------------------------------------------

interface IterState {
  readonly weight: Float32Array; // +0x24328 (all ones)
  readonly exponent: Float32Array; // +0x24330 (1 below 80 Hz, ramp to 0.5)
  readonly ratio: Float32Array;
  readonly mag: Float32Array;
  readonly freq: Float32Array;
  readonly ir1: Float32Array; // +0x24408
  readonly ir2: Float32Array; // +0x24410
}

function geometricSmoothLowBins(ratio: Float32Array, count: number): void {
  if (count < 2) return;
  let prev = sqrtf(f(sqrtf(f(ratio[0] * ratio[1])) * ratio[0]));
  ratio[0] = prev;
  for (let i = 1; i < count; i++) {
    prev = sqrtf(f(sqrtf(f(prev * ratio[i + 1])) * ratio[i]));
    ratio[i] = prev;
  }
}

function melGridError(ctx: CloneContext, tf: Float32Array, freq: Float32Array, nfreq: number): number {
  const onGrid = new Float32Array(ITER_ERR_POINTS);
  interp1(freq, nfreq, tf, ctx.melGrid, ITER_ERR_POINTS, onGrid);
  let err = 0;
  for (let j = 0; j < ITER_ERR_POINTS; j++) err = f(Math.abs(logf(f(onGrid[j] + f(FLT_EPSILON)))) + err);
  return f(err * ITER_ERR_SCALE);
}

function iterAmpCoeff(ctx: CloneContext, st: IterState, w: SignalWindow, iterations: number): void {
  const { n } = w;
  const nfreq = TF_NFREQ;
  const { ratio, mag, freq, ir1, ir2 } = st;
  const gain = Float32Array.from(st.weight); // A0
  const gainSmooth = Float32Array.from(gain); // A2
  const freqTmp = new Float32Array(nfreq); // A4
  const measured = new Float32Array(nfreq); // A5
  const verify = new Float32Array(nfreq); // A6
  const ir1Bands = new Float32Array(IR1_LEN); // A10
  // Best-iteration snapshot. Natively B1/B2/A8/A9 are uninitialized malloc
  // blocks that are only valid once an iteration beats the initial error of
  // 100 (always the first one in practice); the port zero-fills them.
  const best = {
    gain: Float32Array.from(gain), // A7
    ir1: new Float32Array(IR1_LEN), // B1
    ir2: new Float32Array(IR2_LEN), // B2
    ratio: new Float32Array(nfreq), // A8
    mag: new Float32Array(nfreq), // A9
    err: ITER_INITIAL_BEST,
  };
  let g = 1.0;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < nfreq; k++) {
      const p = powf(gain[k], f(st.exponent[k] * g));
      const m = ITER_GAIN_MAX < p ? ITER_GAIN_MAX : p;
      gain[k] = m < ITER_GAIN_MIN ? ITER_GAIN_MIN_F : m;
    }
    downSampleSmoothFreq(gain, freq, nfreq, nfreq, gainSmooth, freqTmp);
    downSampleSmoothFreq(gainSmooth, freqTmp, nfreq, nfreq, gain, freq);
    for (let k = 0; k < nfreq; k++) mag[k] = f(gain[k] * mag[k]);
    for (let k = 0; k < nfreq; k++) ratio[k] = f(ratio[k] / gain[k]);
    g = f(g * ITER_EXP_DECAY);
    const lowBins = Math.trunc(Math.floor(f(f(ctx.invNyquist * ITER_GEO_SMOOTH_HZ) * f(nfreq))));
    geometricSmoothLowBins(ratio, lowBins);
    downSampleSmoothFreq(ratio, freq, nfreq, IR1_LEN, ir1Bands, freqTmp);
    minPhaseIR(ir1Bands, IR1_LEN, IR1_LEN, ir1);

    const sig = ampModelChain(w.x, w.xOff, n, ctx, (buf) => convolveBlocks(ir1, IR1_LEN, buf, 0, buf, 0, n));
    tfestimate(sig, 0, w.y, w.yOff, n, ctx.seglen, TF_NFFT, nfreq, measured, freq, ctx.sr);
    for (let k = 0; k < nfreq; k++) gainSmooth[k] = safeRatio(measured[k], mag[k]);
    downSampleSmoothFreq(gainSmooth, freq, nfreq, nfreq, gain, freq);
    minPhaseIR(measured, nfreq, IR2_LEN, ir2);
    convolveBlocks(ir2, IR2_LEN, sig, 0, sig, 0, n);
    tfestimate(sig, 0, w.y, w.yOff, n, ctx.seglen, TF_NFFT, nfreq, verify, freq, ctx.sr);
    const err = melGridError(ctx, verify, freq, nfreq);

    if (best.err > err) {
      best.gain.set(gain);
      best.ir1.set(ir1);
      best.ir2.set(ir2);
      best.ratio.set(ratio);
      best.mag.set(mag);
      best.err = err;
    } else if (err > best.err * ITER_REJECT_RATIO) {
      gain.set(best.gain);
      ir1.set(best.ir1);
      ir2.set(best.ir2);
      ratio.set(best.ratio);
      mag.set(best.mag);
      g = f(g * ITER_EXP_BACKOFF);
    }
  }
  ir1.set(best.ir1);
  ir2.set(best.ir2);
  ratio.set(best.ratio);
  mag.set(best.mag);
}

/** +0x24330: 1.0 up to bin floor(80 Hz)-1, then a linear ramp 1.0 -> 0.5 to Nyquist. */
function buildExponentWeights(ctx: CloneContext): Float32Array {
  const w = new Float32Array(TF_NFREQ).fill(1);
  const k0 = Math.trunc(Math.floor(f(f(ctx.invNyquist * WEIGHT_RAMP_HZ) * f(TF_NFREQ))));
  const len = TF_NFREQ - k0;
  const ramp = new Float32Array(len + 1);
  ramp[0] = 1;
  if (len > 0) {
    const step = f(WEIGHT_RAMP_END / len);
    let v = 1;
    for (let i = 1; i <= len; i++) {
      v = f(v - step);
      ramp[i] = v;
    }
  }
  ramp[len] = WEIGHT_RAMP_END;
  w.set(ramp, k0 - 1);
  return w;
}

// ---------------------------------------------------------------------------
// startClone step 6: final IR2 correction from a synchronous average of the
// periodic excitation in [50, 70 s), then level matching.
// ---------------------------------------------------------------------------

function hammingFrameSpectrum(frame: Float32Array, N: number, bins: number, tables: { sin: Float32Array; cos: Float32Array }): Float32Array {
  const magOut = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0, idx = 0; j < N; j++, idx = (idx + k) % N) {
      re = f(re + f(tables.cos[idx] * frame[j]));
      im = f(im + f(tables.sin[idx] * -frame[j]));
    }
    magOut[k] = sqrtf(f(f(re * re) + f(im * im)));
  }
  return magOut;
}

function removeMeanAndWindow(frame: Float32Array, N: number, window: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = f(sum + frame[i]);
  const mean = f(sum / f(N));
  for (let i = 0; i < N; i++) frame[i] = f(f(frame[i] - mean) * window[i]);
}

function clampCorrection(v: Float32Array): void {
  for (let k = 0; k < v.length; k++) {
    const x = v[k];
    const m = x <= CORR_MAX ? x : CORR_MAX;
    if (CORR_MAX < x || m < CORR_MIN) v[k] = CORR_MIN <= m ? m : CORR_MIN_F;
  }
}

function finalizeIr2(ctx: CloneContext, w: SignalWindow, ir1: Float32Array, ir2: Float32Array): void {
  const { n, y, yOff } = w;
  const frameLen = Math.ceil(ctx.sr * SYNC_FRAME_S);
  const bins = Math.trunc(frameLen * 0.5 + 1.0);

  const shaped = ampModelChain(w.x, w.xOff, n, ctx, (buf) => convolveBlocks(ir1, IR1_LEN, buf, 0, buf, 0, n));
  const filtered = new Float32Array(n);
  convolveBlocks(ir2, IR2_LEN, shaped, 0, filtered, 0, n);

  const frames = Math.trunc(n / frameLen);
  const avgX = new Float32Array(frameLen);
  const avgY = new Float32Array(frameLen);
  for (let fr = 0; fr < frames; fr++) {
    for (let i = 0; i < frameLen; i++) avgX[i] = f(filtered[fr * frameLen + i] + avgX[i]);
  }
  for (let fr = 0; fr < frames; fr++) {
    for (let i = 0; i < frameLen; i++) avgY[i] = f(y[yOff + fr * frameLen + i] + avgY[i]);
  }
  const window = new Float32Array(frameLen);
  const denom = f(frameLen - 1);
  for (let i = 0; i < frameLen; i++) {
    window[i] = f(cosf(f(f(i * TWO_PI_F) / denom)) * HAMMING_B + HAMMING_A);
  }
  removeMeanAndWindow(avgX, frameLen, window);
  removeMeanAndWindow(avgY, frameLen, window);
  const tables = computeSinCosTable(frameLen);
  const magX = hammingFrameSpectrum(avgX, frameLen, bins, tables);
  const magY = hammingFrameSpectrum(avgY, frameLen, bins, tables);

  const freqGrid = new Float32Array(bins);
  linspaceF(0, ctx.nyquist, bins, freqGrid);
  const smX = new Float32Array(bins);
  const smY = new Float32Array(bins);
  downSampleSmoothFreq(magX, freqGrid, bins, bins, smX, freqGrid);
  downSampleSmoothFreq(magY, freqGrid, bins, bins, smY, freqGrid);
  const corr = new Float32Array(bins);
  for (let k = 0; k < bins; k++) corr[k] = safeRatio(smY[k], smX[k]);
  clampCorrection(corr);
  const tmp = new Float32Array(bins);
  smoothdata(corr, tmp, bins, Math.trunc(bins * CORR_SMOOTH_REL));
  corr.set(tmp);
  clampCorrection(corr);
  linspaceF(0, ctx.nyquist, bins, freqGrid);
  const bandMag = new Float32Array(CORR_BANDS);
  const bandFreq = new Float32Array(CORR_BANDS);
  downSampleSmoothFreq(corr, freqGrid, bins, CORR_BANDS, bandMag, bandFreq);
  const corrIr = new Float32Array(CORR_BANDS);
  minPhaseIR(bandMag, CORR_BANDS, CORR_BANDS, corrIr);

  const acc = new Float32Array(IR2_LEN + CORR_BANDS - 1);
  for (let i = 0; i < IR2_LEN; i++) {
    const v = ir2[i];
    for (let j = 0; j < CORR_BANDS; j++) acc[i + j] = f(acc[i + j] + f(corrIr[j] * v));
  }
  ir2.set(acc.subarray(0, IR2_LEN));
  let sum = 0;
  for (let i = 0; i < IR2_LEN; i++) sum = f(sum + ir2[i]);
  const mean = f(sum / IR2_LEN);
  for (let i = 0; i < IR2_LEN; i++) ir2[i] = f(ir2[i] - mean);

  convolveBlocks(ir2, IR2_LEN, shaped, 0, shaped, 0, n);
  let eY = 0;
  let eX = 0;
  for (let i = 0; i < n; i++) {
    const yv = y[yOff + i];
    eY = f(eY + f(yv * yv));
    eX = f(eX + f(shaped[i] * shaped[i]));
  }
  const g = f(sqrtf(eY) / sqrtf(eX));
  for (let i = 0; i < IR2_LEN; i++) ir2[i] = f(ir2[i] * g);
}

// ===========================================================================
// Sample-rate conversion: bit-exact port of convertSampleRate() @0x11ea0 and
// r8brain-free-src r8b::CDSPResampler24 (state after the version-1.6 tag,
// commit 7f1980e; MIT, (c) 2013-2014 Aleksey Vaneev; fft4g (c) Takuya Ooura).
// Only the paths CDSPResampler24 reaches are ported; float64 throughout with the
// C++ operation order. Verified bit-exact against the DLL's cloneConvertSampleRate.
// ===========================================================================

// ---------------------------------------------------------------------------
// Parameters fixed by CDSPResampler24 and CDSPResampler's constructor.

/** ReqTransBand default of CDSPResampler24, percent. */
const MAIN_TRANS_BAND = 2.0;
/** ReqAtten passed by CDSPResampler24, decibel. */
const MAIN_ATTEN = 180.15;
/** Transition band of a 2x stage followed by further processing, percent. */
const POW2_STAGE_TRANS_BAND = 34.0;
/** Transition band of a 2x stage in a deeper chain, percent. */
const POW2_DEEP_STAGE_TRANS_BAND = 45.0;

/** CDSPFracInterpolator<24, 673> template arguments. */
const FRAC_FILTER_LEN = 24;
const FRAC_FILTER_FRACS = 673;
/** CDSPFracDelayFilterBank<24, 673, 3, 8>: 2nd order spline over 8 points. */
const FRAC_ELEMENT_SIZE = 3;
const FRAC_INTERP_POINTS = 8;
/** Kaiser {Beta, Power} for a half length of 12 taps (getKaiserParams). */
const FRAC_KAISER_BETA = 12.55262798;
const FRAC_KAISER_POWER = 1.51553897;

/** Kaiser Beta used by CDSPFIRFilter::buildLPFilter. */
const LP_KAISER_BETA = 125.0;

// ---------------------------------------------------------------------------
// r8bbase.h helpers.

function sqr(x: number): number {
  return x * x;
}

/** pow() with input sign check. */
function pows(v: number, p: number): number {
  return v < 0.0 ? -Math.pow(-v, p) : Math.pow(v, p);
}

/** r8b's own asinh (shadows the libm one inside namespace r8b). */
function r8bAsinh(v: number): number {
  return Math.log(v + Math.sqrt(v * v + 1.0));
}

/** Approximate zero-th order modified Bessel function of the first kind. */
function besselI0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    let y = x / 3.75;
    y *= y;
    return 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 +
      y * (0.2659732 + y * (0.360768e-1 + y * 0.45813e-2)))));
  }
  const y = 3.75 / ax;
  return Math.exp(ax) / Math.sqrt(ax) * (0.39894228 + y * (0.1328592e-1 +
    y * (0.225319e-2 + y * (-0.157565e-2 + y * (0.916281e-2 +
    y * (-0.2057706e-1 + y * (0.2635537e-1 + y * (-0.1647633e-1 +
    y * 0.392377e-2))))))));
}

/** Number of significant bits of a non-negative value (1 for zero). */
function getBitOccupancy(v: number): number {
  return v === 0 ? 1 : 32 - Math.clz32(v);
}

/** Normalizes a strided FIR filter to the given DC gain. */
function normalizeFirFilter(p: Float64Array, offset: number, len: number, dcGain: number, step: number): void {
  let s = 0.0;
  for (let i = 0, k = offset; i < len; i++, k += step) s += p[k];
  s = dcGain / s;
  for (let i = 0, k = offset; i < len; i++, k += step) p[k] *= s;
}

/** Sine generator driven by the 2*cos(si) recurrence (CSineGen). */
class SineGen {
  private value1: number;
  private value2: number;
  private readonly increment: number;

  constructor(si: number, ph: number) {
    this.value1 = Math.sin(ph);
    this.value2 = Math.sin(ph - si);
    this.increment = 2.0 * Math.cos(si);
  }

  generate(): number {
    const res = this.value1;
    this.value1 = this.increment * res - this.value2;
    this.value2 = res;
    return res;
  }
}

// ---------------------------------------------------------------------------
// Takuya Ooura's fft4g real DFT (r8b::ooura_fft), double precision.

function makewt(nw: number, ip: Int32Array, w: Float64Array): void {
  ip[0] = nw;
  ip[1] = 1;
  if (nw <= 2) return;
  const nwh = nw >> 1;
  const delta = Math.atan(1.0) / nwh;
  w[0] = 1;
  w[1] = 0;
  w[nwh] = Math.cos(delta * nwh);
  w[nwh + 1] = w[nwh];
  if (nwh > 2) {
    for (let j = 2; j < nwh; j += 2) {
      const x = Math.cos(delta * j);
      const y = Math.sin(delta * j);
      w[j] = x;
      w[j + 1] = y;
      w[nw - j] = y;
      w[nw - j + 1] = x;
    }
    bitrv2(nw, ip, w);
  }
}

function makect(nc: number, ip: Int32Array, w: Float64Array, c: number): void {
  ip[1] = nc;
  if (nc <= 1) return;
  const nch = nc >> 1;
  const delta = Math.atan(1.0) / nch;
  w[c] = Math.cos(delta * nch);
  w[c + nch] = 0.5 * w[c];
  for (let j = 1; j < nch; j++) {
    w[c + j] = 0.5 * Math.cos(delta * j);
    w[c + nc - j] = 0.5 * Math.sin(delta * j);
  }
}

function swapComplex(a: Float64Array, j1: number, k1: number): void {
  const xr = a[j1];
  const xi = a[j1 + 1];
  a[j1] = a[k1];
  a[j1 + 1] = a[k1 + 1];
  a[k1] = xr;
  a[k1 + 1] = xi;
}

/** Bit reversal; `ip` index 0 here is `ip + 2` of the C code. */
function bitrv2(n: number, ipBase: Int32Array, a: Float64Array): void {
  const IP = 2;
  ipBase[IP] = 0;
  let l = n;
  let m = 1;
  while ((m << 3) < l) {
    l >>= 1;
    for (let j = 0; j < m; j++) ipBase[IP + m + j] = ipBase[IP + j] + l;
    m <<= 1;
  }
  const m2 = 2 * m;
  if ((m << 3) === l) {
    for (let k = 0; k < m; k++) {
      for (let j = 0; j < k; j++) {
        let j1 = 2 * j + ipBase[IP + k];
        let k1 = 2 * k + ipBase[IP + j];
        swapComplex(a, j1, k1);
        j1 += m2;
        k1 += 2 * m2;
        swapComplex(a, j1, k1);
        j1 += m2;
        k1 -= m2;
        swapComplex(a, j1, k1);
        j1 += m2;
        k1 += 2 * m2;
        swapComplex(a, j1, k1);
      }
      const j1 = 2 * k + m2 + ipBase[IP + k];
      swapComplex(a, j1, j1 + m2);
    }
  } else {
    for (let k = 1; k < m; k++) {
      for (let j = 0; j < k; j++) {
        const j1 = 2 * j + ipBase[IP + k];
        const k1 = 2 * k + ipBase[IP + j];
        swapComplex(a, j1, k1);
        swapComplex(a, j1 + m2, k1 + m2);
      }
    }
  }
}

/** Radix-4 butterflies of the first stage (cft1st). */
function cft1st(n: number, a: Float64Array, w: Float64Array): void {
  let x0r = a[0] + a[2];
  let x0i = a[1] + a[3];
  let x1r = a[0] - a[2];
  let x1i = a[1] - a[3];
  let x2r = a[4] + a[6];
  let x2i = a[5] + a[7];
  let x3r = a[4] - a[6];
  let x3i = a[5] - a[7];
  a[0] = x0r + x2r;
  a[1] = x0i + x2i;
  a[4] = x0r - x2r;
  a[5] = x0i - x2i;
  a[2] = x1r - x3i;
  a[3] = x1i + x3r;
  a[6] = x1r + x3i;
  a[7] = x1i - x3r;
  let wk1r = w[2];
  x0r = a[8] + a[10];
  x0i = a[9] + a[11];
  x1r = a[8] - a[10];
  x1i = a[9] - a[11];
  x2r = a[12] + a[14];
  x2i = a[13] + a[15];
  x3r = a[12] - a[14];
  x3i = a[13] - a[15];
  a[8] = x0r + x2r;
  a[9] = x0i + x2i;
  a[12] = x2i - x0i;
  a[13] = x0r - x2r;
  x0r = x1r - x3i;
  x0i = x1i + x3r;
  a[10] = wk1r * (x0r - x0i);
  a[11] = wk1r * (x0r + x0i);
  x0r = x3i + x1r;
  x0i = x3r - x1i;
  a[14] = wk1r * (x0i - x0r);
  a[15] = wk1r * (x0i + x0r);
  let k1 = 0;
  for (let j = 16; j < n; j += 16) {
    k1 += 2;
    const k2 = 2 * k1;
    const wk2r = w[k1];
    const wk2i = w[k1 + 1];
    wk1r = w[k2];
    let wk1i = w[k2 + 1];
    let wk3r = wk1r - 2 * wk2i * wk1i;
    let wk3i = 2 * wk2i * wk1r - wk1i;
    radix4Twiddled(a, j, 2, wk1r, wk1i, wk2r, wk2i, wk3r, wk3i, false);
    wk1r = w[k2 + 2];
    wk1i = w[k2 + 3];
    wk3r = wk1r - 2 * wk2r * wk1i;
    wk3i = 2 * wk2r * wk1r - wk1i;
    radix4Twiddled(a, j + 8, 2, wk1r, wk1i, wk2r, wk2i, wk3r, wk3i, true);
  }
}

/**
 * One twiddled radix-4 butterfly shared by cft1st and cftmdl. With
 * `rotateW2` the second twiddle is (-wk2i, wk2r), i.e. multiplied by i.
 */
function radix4Twiddled(
  a: Float64Array, j: number, l: number,
  wk1r: number, wk1i: number, wk2r: number, wk2i: number, wk3r: number, wk3i: number,
  rotateW2: boolean,
): void {
  const j1 = j + l;
  const j2 = j1 + l;
  const j3 = j2 + l;
  let x0r = a[j] + a[j1];
  let x0i = a[j + 1] + a[j1 + 1];
  const x1r = a[j] - a[j1];
  const x1i = a[j + 1] - a[j1 + 1];
  const x2r = a[j2] + a[j3];
  const x2i = a[j2 + 1] + a[j3 + 1];
  const x3r = a[j2] - a[j3];
  const x3i = a[j2 + 1] - a[j3 + 1];
  a[j] = x0r + x2r;
  a[j + 1] = x0i + x2i;
  x0r -= x2r;
  x0i -= x2i;
  if (rotateW2) {
    a[j2] = -wk2i * x0r - wk2r * x0i;
    a[j2 + 1] = -wk2i * x0i + wk2r * x0r;
  } else {
    a[j2] = wk2r * x0r - wk2i * x0i;
    a[j2 + 1] = wk2r * x0i + wk2i * x0r;
  }
  x0r = x1r - x3i;
  x0i = x1i + x3r;
  a[j1] = wk1r * x0r - wk1i * x0i;
  a[j1 + 1] = wk1r * x0i + wk1i * x0r;
  x0r = x1r + x3i;
  x0i = x1i - x3r;
  a[j3] = wk3r * x0r - wk3i * x0i;
  a[j3 + 1] = wk3r * x0i + wk3i * x0r;
}

/** Plain radix-4 butterfly (twiddle 1) used by cftmdl and cftfsub. */
function radix4Plain(a: Float64Array, j: number, l: number): void {
  const j1 = j + l;
  const j2 = j1 + l;
  const j3 = j2 + l;
  const x0r = a[j] + a[j1];
  const x0i = a[j + 1] + a[j1 + 1];
  const x1r = a[j] - a[j1];
  const x1i = a[j + 1] - a[j1 + 1];
  const x2r = a[j2] + a[j3];
  const x2i = a[j2 + 1] + a[j3 + 1];
  const x3r = a[j2] - a[j3];
  const x3i = a[j2 + 1] - a[j3 + 1];
  a[j] = x0r + x2r;
  a[j + 1] = x0i + x2i;
  a[j2] = x0r - x2r;
  a[j2 + 1] = x0i - x2i;
  a[j1] = x1r - x3i;
  a[j1 + 1] = x1i + x3r;
  a[j3] = x1r + x3i;
  a[j3 + 1] = x1i - x3r;
}

function cftmdl(n: number, l: number, a: Float64Array, w: Float64Array): void {
  const m = l << 2;
  for (let j = 0; j < l; j += 2) radix4Plain(a, j, l);
  const wk1r = w[2];
  for (let j = m; j < l + m; j += 2) {
    const j1 = j + l;
    const j2 = j1 + l;
    const j3 = j2 + l;
    let x0r = a[j] + a[j1];
    let x0i = a[j + 1] + a[j1 + 1];
    const x1r = a[j] - a[j1];
    const x1i = a[j + 1] - a[j1 + 1];
    const x2r = a[j2] + a[j3];
    const x2i = a[j2 + 1] + a[j3 + 1];
    const x3r = a[j2] - a[j3];
    const x3i = a[j2 + 1] - a[j3 + 1];
    a[j] = x0r + x2r;
    a[j + 1] = x0i + x2i;
    a[j2] = x2i - x0i;
    a[j2 + 1] = x0r - x2r;
    x0r = x1r - x3i;
    x0i = x1i + x3r;
    a[j1] = wk1r * (x0r - x0i);
    a[j1 + 1] = wk1r * (x0r + x0i);
    x0r = x3i + x1r;
    x0i = x3r - x1i;
    a[j3] = wk1r * (x0i - x0r);
    a[j3 + 1] = wk1r * (x0i + x0r);
  }
  let k1 = 0;
  const m2 = 2 * m;
  for (let k = m2; k < n; k += m2) {
    k1 += 2;
    const k2 = 2 * k1;
    const wk2r = w[k1];
    const wk2i = w[k1 + 1];
    let wk1r2 = w[k2];
    let wk1i = w[k2 + 1];
    let wk3r = wk1r2 - 2 * wk2i * wk1i;
    let wk3i = 2 * wk2i * wk1r2 - wk1i;
    for (let j = k; j < l + k; j += 2) {
      radix4Twiddled(a, j, l, wk1r2, wk1i, wk2r, wk2i, wk3r, wk3i, false);
    }
    wk1r2 = w[k2 + 2];
    wk1i = w[k2 + 3];
    wk3r = wk1r2 - 2 * wk2r * wk1i;
    wk3i = 2 * wk2r * wk1r2 - wk1i;
    for (let j = k + m; j < l + (k + m); j += 2) {
      radix4Twiddled(a, j, l, wk1r2, wk1i, wk2r, wk2i, wk3r, wk3i, true);
    }
  }
}

/** Runs cft1st/cftmdl and returns the final stage length `l`. */
function cftStages(n: number, a: Float64Array, w: Float64Array): number {
  let l = 2;
  if (n > 8) {
    cft1st(n, a, w);
    l = 8;
    while ((l << 2) < n) {
      cftmdl(n, l, a, w);
      l <<= 2;
    }
  }
  return l;
}

function cftfsub(n: number, a: Float64Array, w: Float64Array): void {
  const l = cftStages(n, a, w);
  if ((l << 2) === n) {
    for (let j = 0; j < l; j += 2) radix4Plain(a, j, l);
    return;
  }
  for (let j = 0; j < l; j += 2) {
    const j1 = j + l;
    const x0r = a[j] - a[j1];
    const x0i = a[j + 1] - a[j1 + 1];
    a[j] += a[j1];
    a[j + 1] += a[j1 + 1];
    a[j1] = x0r;
    a[j1 + 1] = x0i;
  }
}

function cftbsub(n: number, a: Float64Array, w: Float64Array): void {
  const l = cftStages(n, a, w);
  if ((l << 2) === n) {
    for (let j = 0; j < l; j += 2) {
      const j1 = j + l;
      const j2 = j1 + l;
      const j3 = j2 + l;
      const x0r = a[j] + a[j1];
      const x0i = -a[j + 1] - a[j1 + 1];
      const x1r = a[j] - a[j1];
      const x1i = -a[j + 1] + a[j1 + 1];
      const x2r = a[j2] + a[j3];
      const x2i = a[j2 + 1] + a[j3 + 1];
      const x3r = a[j2] - a[j3];
      const x3i = a[j2 + 1] - a[j3 + 1];
      a[j] = x0r + x2r;
      a[j + 1] = x0i - x2i;
      a[j2] = x0r - x2r;
      a[j2 + 1] = x0i + x2i;
      a[j1] = x1r - x3i;
      a[j1 + 1] = x1i - x3r;
      a[j3] = x1r + x3i;
      a[j3 + 1] = x1i + x3r;
    }
    return;
  }
  for (let j = 0; j < l; j += 2) {
    const j1 = j + l;
    const x0r = a[j] - a[j1];
    const x0i = -a[j + 1] + a[j1 + 1];
    a[j] += a[j1];
    a[j + 1] = -a[j + 1] - a[j1 + 1];
    a[j1] = x0r;
    a[j1 + 1] = x0i;
  }
}

function rftfsub(n: number, a: Float64Array, nc: number, w: Float64Array, c: number): void {
  const m = n >> 1;
  const ks = Math.trunc(2 * nc / m);
  let kk = 0;
  for (let j = 2; j < m; j += 2) {
    const k = n - j;
    kk += ks;
    const wkr = 0.5 - w[c + nc - kk];
    const wki = w[c + kk];
    const xr = a[j] - a[k];
    const xi = a[j + 1] + a[k + 1];
    const yr = wkr * xr - wki * xi;
    const yi = wkr * xi + wki * xr;
    a[j] -= yr;
    a[j + 1] -= yi;
    a[k] += yr;
    a[k + 1] -= yi;
  }
}

function rftbsub(n: number, a: Float64Array, nc: number, w: Float64Array, c: number): void {
  a[1] = -a[1];
  const m = n >> 1;
  const ks = Math.trunc(2 * nc / m);
  let kk = 0;
  for (let j = 2; j < m; j += 2) {
    const k = n - j;
    kk += ks;
    const wkr = 0.5 - w[c + nc - kk];
    const wki = w[c + kk];
    const xr = a[j] - a[k];
    const xi = a[j + 1] + a[k + 1];
    const yr = wkr * xr + wki * xi;
    const yi = wkr * xi - wki * xr;
    a[j] -= yr;
    a[j + 1] = yi - a[j + 1];
    a[k] += yr;
    a[k + 1] = yi - a[k + 1];
  }
  a[m + 1] = -a[m + 1];
}

/** CDSPRealFFT: Ooura rdft of a fixed power-of-2 length. */
class RealFft {
  readonly len: number;
  /** Inverse FFT multiply constant (2 / Len for Ooura's unscaled rdft). */
  readonly invMulConst: number;
  private readonly ip: Int32Array;
  private readonly w: Float64Array;
  private readonly nw: number;
  private readonly nc: number;

  constructor(lenBits: number) {
    const n = 1 << lenBits;
    this.len = n;
    this.invMulConst = 2.0 / n;
    this.ip = new Int32Array(Math.ceil(2.0 + Math.sqrt(n >> 1)));
    this.w = new Float64Array(n >> 1);
    // rdft() builds its tables on the first call (ip[0] == 0); doing it here
    // is equivalent because the tables only depend on the length.
    let nw = this.ip[0];
    if (n > (nw << 2)) {
      nw = n >> 2;
      makewt(nw, this.ip, this.w);
    }
    let nc = this.ip[1];
    if (n > (nc << 2)) {
      nc = n >> 2;
      makect(nc, this.ip, this.w, nw);
    }
    this.nw = nw;
    this.nc = nc;
  }

  forward(a: Float64Array): void {
    const n = this.len;
    if (n > 4) {
      bitrv2(n, this.ip, a);
      cftfsub(n, a, this.w);
      rftfsub(n, a, this.nc, this.w, this.nw);
    } else if (n === 4) {
      cftfsub(n, a, this.w);
    }
    const xi = a[0] - a[1];
    a[0] += a[1];
    a[1] = xi;
  }

  inverse(a: Float64Array): void {
    const n = this.len;
    a[1] = 0.5 * (a[0] - a[1]);
    a[0] -= a[1];
    if (n > 4) {
      rftbsub(n, a, this.nc, this.w, this.nw);
      bitrv2(n, this.ip, a);
      cftbsub(n, a, this.w);
    } else if (n === 4) {
      cftfsub(n, a, this.w);
    }
  }
}

const fftCache = new Map<number, RealFft>();

function getFft(lenBits: number): RealFft {
  let fft = fftCache.get(lenBits);
  if (fft === undefined) {
    fft = new RealFft(lenBits);
    fftCache.set(lenBits, fft);
  }
  return fft;
}

// ---------------------------------------------------------------------------
// CDSPSincFilterGen (Kaiser power-raised window only).

/** Kaiser window evaluated at successive integer positions (calcWindowKaiser). */
class KaiserWindow {
  private wn: number;
  private readonly len2: number;
  private readonly beta: number;
  private readonly div: number;
  private readonly len2Frac: number;

  constructor(len2: number, beta: number, startPos: number, fracDelay: number) {
    this.wn = startPos;
    this.len2 = len2;
    this.beta = beta;
    this.div = besselI0(beta);
    this.len2Frac = fracDelay / len2;
  }

  next(): number {
    const n = 1.0 - sqr(this.wn / this.len2 + this.len2Frac);
    this.wn++;
    if (n < 0.0) return 0.0;
    return besselI0(this.beta * Math.sqrt(n)) / this.div;
  }
}

/**
 * generateBand() with Freq1 = 0: the Freq1 sine generator yields exact
 * zeros, so `f2 - f1` and `Freq2 - Freq1` reduce to the f2 terms bit-exactly.
 */
function generateLowPassBand(len2: number, freq2: number, power: number): { kernel: Float64Array; fl2: number } {
  const fl2 = Math.floor(len2);
  const kernel = new Float64Array(fl2 + fl2 + 1);
  const f2 = new SineGen(freq2, 0.0);
  const win = new KaiserWindow(len2, LP_KAISER_BETA, 0, 0.0);
  f2.generate();
  kernel[fl2] = freq2 * pows(win.next(), power) / Math.PI;
  for (let t = 1; t <= fl2; t++) {
    const v = f2.generate() * pows(win.next(), power) / t / Math.PI;
    kernel[fl2 + t] = v;
    kernel[fl2 - t] = v;
  }
  return { kernel, fl2 };
}

/**
 * generateFrac() for the fractional delay filter bank: writes FilterLen taps
 * at stride FRAC_ELEMENT_SIZE starting at `op`.
 */
function generateFracDelay(table: Float64Array, op: number, fracDelay: number): void {
  const len2 = FRAC_FILTER_LEN / 2;
  const fl2 = Math.ceil(len2);
  const power = FRAC_KAISER_POWER;
  const win = new KaiserWindow(len2, FRAC_KAISER_BETA, -fl2, fracDelay);
  const f0 = Math.sin(fracDelay * Math.PI);
  const f = [f0, -f0];
  let t = -fl2;
  if (t + fracDelay < -len2) {
    win.next();
    table[op] = 0.0;
    op += FRAC_ELEMENT_SIZE;
    t++;
  }
  let mt = fracDelay >= 1.0 - 1e-13 && fracDelay <= 1.0 + 1e-13 ? -1 : 0;
  while (t < mt) {
    table[op] = f[t & 1] * pows(win.next(), power) / (t + fracDelay) / Math.PI;
    op += FRAC_ELEMENT_SIZE;
    t++;
  }
  let ut = t + fracDelay;
  table[op] = Math.abs(ut) <= 1e-13 ? pows(win.next(), power) :
    f[t & 1] * pows(win.next(), power) / ut / Math.PI;
  mt = fl2 - 2;
  while (t < mt) {
    op += FRAC_ELEMENT_SIZE;
    t++;
    table[op] = f[t & 1] * pows(win.next(), power) / (t + fracDelay) / Math.PI;
  }
  op += FRAC_ELEMENT_SIZE;
  t++;
  ut = t + fracDelay;
  table[op] = ut > len2 ? 0.0 : f[t & 1] * pows(win.next(), power) / ut / Math.PI;
}

// ---------------------------------------------------------------------------
// CDSPFIRFilter::buildLPFilter + CDSPFIRFilterCache.

/** Attenuation correction tables of buildLPFilter (tb >= 0.25 and tb < 0.10). */
const ATTEN_CORRS_WIDE = Int8Array.from([
  -127, -127, -125, -125, -122, -119, -115, -110, -104, -97,
  -91, -82, -75, -24, -16, -6, 4, 14, 24, 29, 30, 32, 37, 44,
  51, 57, 63, 67, 65, 50, 53, 56, 58, 60, 63, 64, 66, 68, 74,
  77, 78, 78, 78, 79, 79, 60, 60, 60, 61, 59, 52, 47, 41, 36,
  30, 24, 17, 9, 0, -8, -10, -11, -14, -13, -18, -25, -31, -38,
  -44, -50, -57, -63, -68, -74, -81, -89, -96, -101, -104, -107,
  -109, -110, -86, -84, -85, -82, -80, -77, -73, -67, -62, -55,
  -48, -42, -35, -30, -20, -11, -2, 5, 6, 6, 7, 11, 16, 21, 26,
  34, 41, 46, 49, 52, 55, 56, 48, 49, 51, 51, 52, 52, 52, 52,
  52, 51, 51, 50, 47, 47, 50, 48, 46, 42, 38, 35, 31, 27, 24,
  20, 16, 12, 11, 12, 10, 8, 4, -1, -6, -11, -16, -19, -17, -21,
  -24, -27, -32, -34, -37, -38, -40, -41, -40, -40, -42, -41,
  -44, -45, -43, -41, -34, -31, -28, -24, -21, -18, -14, -10,
  -5, -1, 2, 5, 8, 7, 4, 3, 2, 2, 4, 6, 8, 9, 9, 10, 10, 10, 10,
  9, 8, 9, 11, 14, 13, 12, 11, 10, 8, 7, 6, 5, 3, 2, 2, -1, -1,
  -3, -3, -4, -4, -5, -4, -6, -7, -9, -5, -1, -1, 0, 1, 0, -2,
  -3, -4, -5, -5, -8, -13, -13, -13, -12, -13, -12, -11, -11,
  -9, -8, -7, -5, -3, -1, 2, 4, 6, 9, 10, 11, 14, 18, 21, 24,
  27, 30, 34, 37, 37, 39, 40,
]);
const ATTEN_CORRS_WIDE_SCALE = 101.0;

const ATTEN_CORRS_NARROW = Int8Array.from([
  -15, -17, -20, -20, -20, -21, -20, -16, -17, -18, -17, -13,
  -12, -11, -9, -7, -5, -4, -1, 1, 3, 4, 5, 6, 7, 9, 9, 10, 10,
  10, 11, 11, 11, 12, 12, 12, 10, 11, 10, 10, 8, 10, 11, 10, 11,
  11, 13, 14, 15, 19, 27, 26, 23, 18, 14, 8, 4, -2, -6, -12,
  -17, -23, -28, -33, -37, -42, -46, -49, -53, -57, -60, -61,
  -64, -65, -67, -66, -66, -66, -65, -64, -61, -59, -56, -52,
  -48, -42, -38, -31, -27, -19, -13, -7, -1, 8, 14, 22, 29, 37,
  45, 52, 59, 66, 73, 80, 86, 91, 96, 100, 104, 108, 111, 114,
  115, 117, 118, 120, 120, 118, 117, 114, 113, 111, 107, 103,
  99, 95, 89, 84, 78, 72, 66, 60, 52, 44, 37, 30, 21, 14, 6, -3,
  -11, -18, -26, -34, -43, -51, -58, -65, -73, -78, -85, -90,
  -97, -102, -107, -113, -115, -118, -121, -125, -125, -126,
  -126, -126, -125, -124, -121, -119, -115, -111, -109, -101,
  -102, -95, -88, -81, -73, -67, -63, -54, -47, -40, -33, -26,
  -18, -11, -5, 2, 8, 14, 19, 25, 31, 36, 37, 43, 47, 49, 51,
  52, 57, 57, 56, 57, 58, 58, 58, 57, 56, 52, 52, 50, 48, 44,
  41, 39, 37, 33, 31, 26, 24, 21, 18, 14, 11, 8, 4, 2, -2, -5,
  -7, -9, -11, -13, -15, -16, -18, -19, -20, -23, -24, -24, -25,
  -27, -26, -27, -29, -30, -31, -32, -35, -36, -39, -40, -44,
  -46, -51, -54, -59, -63, -69, -76, -83, -91, -98,
]);
const ATTEN_CORRS_NARROW_SCALE = 196.0;

const ATTEN_CORR_COUNT = 264;
const ATTEN_CORR_MIN = 49.0;
const ATTEN_CORR_DIFF = 176.25;
const WIDE_TB = 0.25;
const NARROW_TB = 0.10;

/** Kaiser window power, half-length factor and cutoff shift of the LP design. */
interface LpDesign {
  pwr: number;
  hl: number;
  fo1: number;
}

function correctedAtten(tb: number, reqAtten: number): number {
  if (tb >= WIDE_TB) {
    if (reqAtten >= 117.0) return -reqAtten - 1.60;
    return reqAtten >= 60.0 ? -reqAtten - 1.91 : -reqAtten - 2.25;
  }
  if (tb >= NARROW_TB) {
    throw new Error("r8b: transition bands of 10-25 % are not used by CDSPResampler24");
  }
  if (reqAtten >= 117.0) return -reqAtten - 0.21;
  return reqAtten >= 60.0 ? -reqAtten - 0.25 : -reqAtten - 0.36;
}

/** The empirical filter design formulas of buildLPFilter (tb < 0.10 or >= 0.25). */
function designLowPass(reqTransBand: number, reqAtten: number): LpDesign {
  const tb = reqTransBand * 0.01;
  let atten = correctedAtten(tb, reqAtten);
  let attenCorr = Math.floor((-atten - ATTEN_CORR_MIN) * ATTEN_CORR_COUNT / ATTEN_CORR_DIFF + 0.5);
  attenCorr = Math.min(ATTEN_CORR_COUNT, Math.max(0, attenCorr));
  atten -= tb >= WIDE_TB
    ? ATTEN_CORRS_WIDE[attenCorr] / ATTEN_CORRS_WIDE_SCALE
    : ATTEN_CORRS_NARROW[attenCorr] / ATTEN_CORRS_NARROW_SCALE;

  const pwr = 7.43932822146293e-8 * sqr(atten) + 0.000102747434588003 *
    Math.cos(0.00785021930010397 * atten) * Math.cos(0.633854318781239 +
    0.103208573657699 * atten) - 0.00798132247867036 -
    0.000903555213543865 * atten - 0.0969365532127236 * Math.exp(
    0.0779275237937911 * atten) - 1.37304948662012e-5 * atten * Math.cos(
    0.00785021930010397 * atten);

  let hl: number;
  let fo1: number;
  if (pwr <= 0.067665322581) {
    if (tb >= WIDE_TB) {
      hl = 2.6778150875894 / tb + 300.547590563091 * Math.atan(Math.atan(
        2.68959772209918 * pwr)) / (5.5099277187035 * tb - tb *
        Math.tanh(Math.cos(r8bAsinh(atten))));
      fo1 = 0.987205355829873 * tb + 1.00011788929851 * Math.atan2(
        -0.321432067051302 - 6.19131357321578 * Math.sqrt(pwr),
        hl + -1.14861472207245 / (hl - 14.1821147585957) + Math.pow(
        0.9521145021664, Math.pow(Math.atan2(1.12018764830637, tb),
        2.10988901686912 * hl - 20.9691278378345)));
    } else {
      hl = (2.45739657014937 + 269.183679500541 * pwr * Math.cos(
        5.73225668178813 + Math.atan2(Math.cosh(0.988861169868941 -
        17.2201556280744 * pwr), 1.08340138240431 * pwr))) / tb;
      fo1 = 2.291956939 * tb + 0.01942450693 * sqr(tb) * hl -
        4.67538973161837 * pwr * tb - 1.668433124 * tb *
        Math.pow(pwr, pwr);
    }
  } else if (tb >= WIDE_TB) {
    hl = (1.50258368698213 + 158.556968859477 * r8bAsinh(pwr) *
      Math.tanh(57.9466246871383 * Math.tanh(pwr)) -
      0.0105440479814834 * atten) / tb;
    fo1 = 0.994024401639321 * tb + (-0.236282717577215 -
      6.8724924545387 * Math.sqrt(Math.sin(pwr))) / hl;
  } else {
    hl = (1.15990238966306 * pwr - 5.02124037125213 * sqr(
      pwr) - 0.158676856669827 * atten * Math.cos(1.1609073390614 *
      pwr - 6.33932586197475 * pwr * sqr(pwr))) / tb;
    fo1 = 0.867344453126885 * tb + 0.052693817907757 * tb * Math.log(
      pwr) + 0.0895511178735932 * tb * Math.atan(59.7538527741309 *
      pwr) - 0.0745653568081453 * pwr * tb;
  }
  return { pwr, hl, fo1 };
}

/** A built linear-phase (zero-phase kernel block) low-pass FIR filter. */
interface LpFilter {
  /** Kernel spectrum (rdft packed), 2 << blockLenBits values. */
  kernelBlock: Float64Array;
  blockLenBits: number;
  kernelLen: number;
  latency: number;
}

function buildLowPassFilter(reqNormFreq: number, reqTransBand: number, reqAtten: number, reqGain: number): LpFilter {
  const { pwr, hl, fo1 } = designLowPass(reqTransBand, reqAtten);
  const len2 = 0.25 * hl / reqNormFreq;
  const freq2 = Math.PI * (1.0 - fo1) * reqNormFreq;
  const { kernel, fl2 } = generateLowPassBand(len2, freq2, Math.abs(pwr));
  const kernelLen = kernel.length;
  const blockLenBits = getBitOccupancy(kernelLen - 1);
  const blockLen = 1 << blockLenBits;
  const ffto = getFft(blockLenBits + 1);

  let s = 0.0;
  for (let i = 0; i < kernelLen; i++) s += kernel[i];
  s = ffto.invMulConst * reqGain / s;

  // Time-shift so that a zero-phase response is produced, scaled by "s";
  // the middle of the block stays zero-padded.
  const kernelBlock = new Float64Array(blockLen * 2);
  for (let i = 0; i <= fl2; i++) kernelBlock[i] = kernel[fl2 + i] * s;
  for (let i = 1; i <= fl2; i++) kernelBlock[blockLen * 2 - i] = kernelBlock[i];
  ffto.forward(kernelBlock);
  return { kernelBlock, blockLenBits, kernelLen, latency: fl2 };
}

const filterCache = new Map<string, LpFilter>();

function getLowPassFilter(reqNormFreq: number, reqTransBand: number, reqGain: number): LpFilter {
  const key = `${reqNormFreq}|${reqTransBand}|${reqGain}`;
  let filter = filterCache.get(key);
  if (filter === undefined) {
    filter = buildLowPassFilter(reqNormFreq, reqTransBand, MAIN_ATTEN, reqGain);
    filterCache.set(key, filter);
  }
  return filter;
}

// ---------------------------------------------------------------------------
// CDSPBlockConvolver (power-of-2 up/down factors, DoConsumeLatency = true).

class BlockConvolver {
  readonly latencyFrac: number;
  readonly upFactor: number;
  readonly downFactor: number;
  readonly inputDelay: number;
  private readonly filter: LpFilter;
  private readonly fftin: RealFft;
  private readonly fftout: RealFft;
  private readonly upShift: number;
  private readonly downShift: number;
  private readonly blockLen2: number;
  private readonly outOffset: number;
  private readonly prevInputLen: number;
  private readonly inputLen: number;
  private readonly prevInput: Float64Array;
  private curInput: Float64Array;
  private curOutput: Float64Array;
  private inDataLeft: number;
  private latencyLeft: number;
  /** Output buffer and write position of the running process() call. */
  private out: Float64Array = new Float64Array(0);
  private outPos = 0;

  constructor(filter: LpFilter, upFactor: number, downFactor: number, prevLatency: number) {
    this.filter = filter;
    this.upFactor = upFactor;
    this.downFactor = downFactor;
    this.blockLen2 = 2 << filter.blockLenBits;
    this.upShift = getBitOccupancy(upFactor) - 1;
    this.downShift = getBitOccupancy(downFactor) - 1;
    if ((1 << this.upShift) !== upFactor || (1 << this.downShift) !== downFactor) {
      throw new Error("r8b: only power-of-2 convolver factors are used by CDSPResampler24");
    }
    const fftinBits = filter.blockLenBits + 1 - this.upShift;
    this.prevInputLen = Math.trunc((filter.kernelLen - 1) / upFactor);
    this.inputLen = this.blockLen2 - this.prevInputLen * upFactor;
    this.outOffset = filter.latency;

    let latencyFrac = prevLatency * upFactor; // linear-phase filter: own LatencyFrac == 0
    let latency = Math.trunc(latencyFrac);
    latencyFrac -= latency;
    latencyFrac /= downFactor;
    latency += this.inputLen + this.outOffset;

    let inputDelay = 0;
    const fftoutBits = filter.blockLenBits + 1 - this.downShift;
    if (downFactor > 1) {
      // UpShift == 0 here: power-of-2 up and down factors never combine.
      let delay = latency & (downFactor - 1);
      if (delay > 0) {
        delay = downFactor - delay;
        latency += delay;
        if (delay >= upFactor) inputDelay = delay - (upFactor - 1);
      }
    }
    this.latencyFrac = latencyFrac;
    this.inputDelay = inputDelay;
    this.fftin = getFft(fftinBits);
    this.fftout = getFft(fftoutBits);
    this.prevInput = new Float64Array(this.prevInputLen);
    this.curInput = new Float64Array(this.blockLen2);
    this.curOutput = new Float64Array(this.blockLen2);
    this.latencyLeft = latency;
    this.inDataLeft = this.inputLen - inputDelay;
  }

  getMaxOutLen(maxInLen: number): number {
    return Math.trunc((maxInLen * this.upFactor + this.inputDelay + this.downFactor - 1) / this.downFactor);
  }

  process(ip: Float64Array, l0: number, out: Float64Array): number {
    this.out = out;
    this.outPos = 0;
    let ipPos = 0;
    let l = l0 * this.upFactor;
    while (l > 0) {
      const offs = this.inputLen - this.inDataLeft;
      if (l < this.inDataLeft) {
        this.inDataLeft -= l;
        this.curInput.set(ip.subarray(ipPos, ipPos + (l >> this.upShift)), offs >> this.upShift);
        this.copyToOutput(offs - this.outOffset, l);
        break;
      }
      const b = this.inDataLeft;
      l -= b;
      this.inDataLeft = this.inputLen;
      const bu = b >> this.upShift;
      this.curInput.set(ip.subarray(ipPos, ipPos + bu), offs >> this.upShift);
      ipPos += bu;
      this.convolveBlock();
      this.copyToOutput(offs - this.outOffset, b);
      const tmp = this.curInput;
      this.curInput = this.curOutput;
      this.curOutput = tmp;
    }
    return this.outPos;
  }

  /** Overlap handling, FFT, spectrum mirroring/multiplication, inverse FFT. */
  private convolveBlock(): void {
    const cur = this.curInput;
    const ilu = this.inputLen >> this.upShift;
    const pil = this.prevInputLen;
    cur.set(this.prevInput, ilu);
    this.prevInput.set(cur.subarray(ilu - pil, ilu));
    this.fftin.forward(cur);
    if (this.upShift > 0) this.mirrorInputSpectrum();
    const kernel = this.filter.kernelBlock;
    // multiplyBlocksZ over the fftout length.
    cur[0] *= kernel[0];
    cur[1] *= kernel[1];
    for (let i = 2; i < this.fftout.len; i += 2) {
      cur[i] *= kernel[i];
      cur[i + 1] *= kernel[i];
    }
    if (this.downShift > 0) {
      const z = this.blockLen2 >> this.downShift;
      cur[1] = kernel[z] * cur[z];
    }
    this.fftout.inverse(cur);
  }

  private copyToOutput(offs: number, b: number): void {
    if (offs < 0) {
      if (offs + b <= 0) {
        offs += this.blockLen2;
      } else {
        this.copyToOutput(offs + this.blockLen2, -offs);
        b += offs;
        offs = 0;
      }
    }
    if (this.latencyLeft > 0) {
      if (this.latencyLeft >= b) {
        this.latencyLeft -= b;
        return;
      }
      offs += this.latencyLeft;
      b -= this.latencyLeft;
      this.latencyLeft = 0;
    }
    const df = this.downFactor;
    if (this.downShift > 0) {
      let skip = offs & (df - 1);
      if (skip > 0) {
        skip = df - skip;
        b -= skip;
        offs += skip;
      }
      if (b <= 0) return;
      b = (b + df - 1) >> this.downShift;
      const from = offs >> this.downShift;
      this.out.set(this.curOutput.subarray(from, from + b), this.outPos);
    } else {
      this.out.set(this.curOutput.subarray(offs, offs + b), this.outPos);
    }
    this.outPos += b;
  }

  /** Spectrum mirroring equivalent to zero insertion ("power of 2" upsampling). */
  private mirrorInputSpectrum(): void {
    const cur = this.curInput;
    const bl1 = this.blockLen2 >> this.upShift;
    const bl2 = bl1 + bl1;
    for (let i = bl1 + 2; i < bl2; i += 2) {
      cur[i] = cur[bl2 - i];
      cur[i + 1] = -cur[bl2 - i + 1];
    }
    cur[bl1] = cur[1];
    cur[bl1 + 1] = 0.0;
    cur[1] = cur[0];
    for (let i = 1; i < this.upShift; i++) {
      const z = bl1 << i;
      cur.copyWithin(z, 0, z);
      cur[z + 1] = 0.0;
    }
  }
}

// ---------------------------------------------------------------------------
// CDSPFracDelayFilterBank<24, 673, 3, 8> + CDSPFracInterpolator<24, 673>.

const FRAC_FILTER_SIZE = FRAC_FILTER_LEN * FRAC_ELEMENT_SIZE;

/** 2nd order spline coefficients over 8 equidistant points (calcSpline2p8Coeffs). */
function calcSpline2p8Coeffs(table: Float64Array, c: number): void {
  const at = (k: number) => table[c + k * FRAC_FILTER_SIZE];
  const xm3 = at(0), xm2 = at(1), xm1 = at(2), x0 = at(3);
  const x1 = at(4), x2 = at(5), x3 = at(6), x4 = at(7);
  table[c] = x0;
  table[c + 1] = (61.0 * (x1 - xm1) + 16.0 * (xm2 - x2) + 3.0 * (x3 - xm3)) / 76.0;
  table[c + 2] = (106.0 * (xm1 + x1) + 10.0 * x3 + 6.0 * xm3 - 3.0 * x4 -
    29.0 * (xm2 + x2) - 167.0 * x0) / 76.0;
}

function calculateFracFilterBank(): Float64Array {
  const table = new Float64Array(FRAC_FILTER_SIZE * (FRAC_FILTER_FRACS + FRAC_INTERP_POINTS));
  const pc2 = FRAC_INTERP_POINTS / 2;
  let p = 0;
  for (let i = -pc2 + 1; i <= FRAC_FILTER_FRACS + pc2; i++) {
    generateFracDelay(table, p, (FRAC_FILTER_FRACS - i) / FRAC_FILTER_FRACS);
    normalizeFirFilter(table, p, FRAC_FILTER_LEN, 1.0, FRAC_ELEMENT_SIZE);
    p += FRAC_FILTER_SIZE;
  }
  const tableEnd = (FRAC_FILTER_FRACS + 1) * FRAC_FILTER_SIZE;
  for (p = 0; p < tableEnd; p += FRAC_ELEMENT_SIZE) calcSpline2p8Coeffs(table, p);
  return table;
}

let fracFilterBank: Float64Array | undefined;

const FRAC_LEN_D2 = FRAC_FILTER_LEN >> 1;
const FRAC_LEN_D2_MINUS1 = FRAC_LEN_D2 - 1;
const FRAC_LEN_D2_PLUS1 = FRAC_LEN_D2 + 1;
const FRAC_BUF_LEN_BITS = 8;
const FRAC_BUF_LEN = 1 << FRAC_BUF_LEN_BITS;
const FRAC_BUF_LEN_MASK = FRAC_BUF_LEN - 1;
const FRAC_BUF_LEFT_MAX = FRAC_BUF_LEN - FRAC_LEN_D2_MINUS1;
const FRAC_COUNTER_RESET = 1000;

class FracInterpolator {
  private readonly srcSampleRate: number;
  private readonly dstSampleRate: number;
  private readonly bank: Float64Array;
  /** Ring buffer, both halves hold the same samples. */
  private readonly buf = new Float64Array(FRAC_BUF_LEN * 2);
  private bufLeft = 0;
  private writePos = 0;
  /** Accounts for the filter latency at zero fractional delay. */
  private readPos = FRAC_BUF_LEN - FRAC_LEN_D2_MINUS1;
  private inCounter = 0;
  private inPosInt = 0;
  private inPosFrac: number;
  private inPosShift: number;

  constructor(srcSampleRate: number, dstSampleRate: number, initFracPos: number) {
    this.srcSampleRate = srcSampleRate;
    this.dstSampleRate = dstSampleRate;
    this.inPosFrac = initFracPos;
    this.inPosShift = initFracPos;
    fracFilterBank ??= calculateFracFilterBank();
    this.bank = fracFilterBank;
  }

  getMaxOutLen(maxInLen: number): number {
    return Math.ceil(maxInLen * this.dstSampleRate / this.srcSampleRate) + 1;
  }

  process(ip: Float64Array, l: number, out: Float64Array): number {
    let ipPos = 0;
    let op = 0;
    while (l > 0) {
      const b = Math.min(Math.min(l, FRAC_BUF_LEN - this.writePos), FRAC_BUF_LEFT_MAX - this.bufLeft);
      const chunk = ip.subarray(ipPos, ipPos + b);
      this.buf.set(chunk, this.writePos);
      this.buf.set(chunk, this.writePos + FRAC_BUF_LEN);
      ipPos += b;
      this.writePos = (this.writePos + b) & FRAC_BUF_LEN_MASK;
      l -= b;
      this.bufLeft += b;
      while (this.bufLeft >= FRAC_LEN_D2_PLUS1) {
        out[op++] = this.interpolate();
        this.advance();
      }
    }
    if (this.inCounter > FRAC_COUNTER_RESET) {
      // Resettable counter for higher sample timing precision.
      this.inCounter = 0;
      this.inPosInt = 0;
      this.inPosShift = this.inPosFrac;
    }
    return op;
  }

  private interpolate(): number {
    let x = this.inPosFrac * FRAC_FILTER_FRACS;
    const fti = Math.trunc(x);
    x -= fti;
    const x2 = x * x;
    const bank = this.bank;
    const rp = this.readPos;
    let ftp = fti * FRAC_FILTER_SIZE;
    let s = 0.0;
    for (let i = 0; i < FRAC_FILTER_LEN; i++) {
      s += (bank[ftp] + bank[ftp + 1] * x + bank[ftp + 2] * x2) * this.buf[rp + i];
      ftp += FRAC_ELEMENT_SIZE;
    }
    return s;
  }

  private advance(): void {
    this.inCounter++;
    const nextInPos = this.inCounter * this.srcSampleRate / this.dstSampleRate + this.inPosShift;
    const nextInPosInt = Math.trunc(nextInPos);
    const posIncr = nextInPosInt - this.inPosInt;
    this.inPosInt = nextInPosInt;
    this.inPosFrac = nextInPos - nextInPosInt;
    this.readPos = (this.readPos + posIncr) & FRAC_BUF_LEN_MASK;
    this.bufLeft -= posIncr;
  }
}

// ---------------------------------------------------------------------------
// CDSPResampler<CDSPFracInterpolator<24, 673>> (UsePower2 = true).

interface ProcessResult {
  data: Float64Array;
  count: number;
}

class Resampler24 {
  private readonly convs: BlockConvolver[] = [];
  private readonly interp: FracInterpolator | undefined;

  constructor(srcSampleRate: number, dstSampleRate: number) {
    if (srcSampleRate === dstSampleRate) {
      this.interp = undefined;
      return;
    }
    let srcSRMult: number;
    let srcSRDiv = 1;
    let prevLatencyFrac = 0.0;
    if (dstSampleRate * 2 > srcSampleRate) {
      // A single convolver with 2x upsampling.
      srcSRMult = 2;
      const normFreq = dstSampleRate > srcSampleRate ? 0.5 : 0.5 * dstSampleRate / srcSampleRate;
      const conv0 = new BlockConvolver(getLowPassFilter(normFreq, MAIN_TRANS_BAND, 2.0), 2, 1, 0.0);
      this.convs.push(conv0);
      prevLatencyFrac = conv0.latencyFrac;
      const pow2Count = this.findPow2UpCount(srcSampleRate, dstSampleRate);
      if (pow2Count > 0) {
        for (let i = 1; i < pow2Count; i++) {
          const tb = i >= 2 ? POW2_DEEP_STAGE_TRANS_BAND : POW2_STAGE_TRANS_BAND;
          const conv = new BlockConvolver(getLowPassFilter(0.5, tb, 2.0), 2, 1, prevLatencyFrac);
          this.convs.push(conv);
          prevLatencyFrac = conv.latencyFrac;
        }
        this.interp = undefined; // "power of 2" ratio: no interpolator
        return;
      }
    } else {
      srcSRMult = 1;
      const checkSR = dstSampleRate * 4;
      while (checkSR * srcSRDiv <= srcSampleRate) {
        srcSRDiv *= 2;
        // Deeper downsampling uses a less steep filter at this step.
        const tb = checkSR * srcSRDiv <= srcSampleRate ? POW2_DEEP_STAGE_TRANS_BAND : POW2_STAGE_TRANS_BAND;
        const conv = new BlockConvolver(getLowPassFilter(0.5, tb, 1.0), 1, 2, prevLatencyFrac);
        this.convs.push(conv);
        prevLatencyFrac = conv.latencyFrac;
      }
      const normFreq = dstSampleRate * srcSRDiv / srcSampleRate;
      const downf = normFreq === 0.5 ? 2 : 1;
      const conv = new BlockConvolver(getLowPassFilter(normFreq, MAIN_TRANS_BAND, 1.0), 1, downf, prevLatencyFrac);
      this.convs.push(conv);
      prevLatencyFrac = conv.latencyFrac;
      if (downf > 1) {
        this.interp = undefined; // "power of 2" ratio: no interpolator
        return;
      }
    }
    this.interp = new FracInterpolator(srcSampleRate * srcSRMult / srcSRDiv, dstSampleRate, prevLatencyFrac);
  }

  /** Number of 2x steps if dst/src is a power of 2 (>= 2), else 0. */
  private findPow2UpCount(srcSampleRate: number, dstSampleRate: number): number {
    for (let count = 1; ; count++) {
      const testSR = srcSampleRate * (1 << count);
      if (testSR > dstSampleRate) return 0;
      if (testSR === dstSampleRate) return count;
    }
  }

  /** CDSPResampler::process; the result may alias `ip`. */
  process(ip: Float64Array, l: number): ProcessResult {
    let data = ip;
    for (const conv of this.convs) {
      const out = new Float64Array(conv.getMaxOutLen(l));
      l = conv.process(data, l, out);
      data = out;
    }
    if (this.interp === undefined) return { data, count: l };
    const out = new Float64Array(this.interp.getMaxOutLen(l));
    return { data: out, count: this.interp.process(data, l, out) };
  }
}

// ---------------------------------------------------------------------------
// convertSampleRate() wrapper.

/**
 * Port of convertSampleRate() @0x11ea0 for one channel. Suite uses it for the excitation
 * (44.1 kHz asset -> model rate, getConvertNormalWav) and for the IRs (model rate -> 44.1 kHz).
 */
export function convertSampleRate(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  const src = Math.fround(srcRate);
  const dst = Math.fround(dstRate);
  if (!(src > 0) || !(dst > 0)) {
    throw new RangeError(`convertSampleRate: invalid rates ${srcRate} -> ${dstRate}`);
  }
  const len = input.length;
  // (int)(((float)len * dst) / src), evaluated in float32.
  const outLen = Math.trunc(Math.fround(Math.fround(Math.fround(len) * dst) / src));
  const output = new Float32Array(Math.max(outLen, 0));
  if (len === 0 || outLen <= 0) return output;

  const resampler = new Resampler24(src, dst);
  const buffer = Float64Array.from(input);
  let prev = 0;
  let cur: number;
  let first = true;
  do {
    // Every call after the first feeds a zeroed block of the same length.
    if (!first) buffer.fill(0);
    first = false;
    const { data, count } = resampler.process(buffer, len);
    cur = Math.min(count, outLen);
    // Quirk kept from the original: positions [prev, cur) are filled from the
    // start of this call's output, where prev is the previous call's count.
    for (let k = prev; k < cur; k++) output[k] = data[k - prev];
    prev = cur;
  } while (cur < outLen);
  return output;
}

// ---------------------------------------------------------------------------
// Blob assembly (startClone @0x2b210..) and Modbus CRC-16.
// ---------------------------------------------------------------------------

function crc16(bytes: Uint8Array, start: number, end: number): { lo: number; hi: number } {
  let hi = 0xff; // the byte XORed with the data (bVar79)
  let lo = 0xff; // bVar74
  for (let i = start; i < end; i++) {
    const idx = hi ^ bytes[i];
    hi = lo ^ CRC16_TABLE_HI[idx];
    lo = CRC16_TABLE_LO[idx];
  }
  return { lo, hi };
}

function writeResampledIr(view: DataView, byteOffset: number, ir: Float32Array, len: number, sr: number): void {
  const resampled = convertSampleRate(ir.subarray(0, len), sr, BLOB_SAMPLE_RATE);
  const count = Math.min(resampled.length, len);
  for (let i = 0; i < len; i++) view.setFloat32(byteOffset + 4 * i, i < count ? resampled[i] : 0, true);
}

function buildBlob(ctx: CloneContext, ir1: Float32Array, ir2: Float32Array): Uint8Array {
  const bytes = new Uint8Array(BLOB_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(BLOB_PAYLOAD_SIZE_OFFSET, BLOB_PAYLOAD_SIZE, true);
  const biquads = [PRE_BIQUAD, ctx.lowCut];
  biquads.forEach((c, s) => {
    [c.b0, c.b1, c.b2, c.a1, c.a2].forEach((v, i) => view.setFloat64(BLOB_BIQUAD_OFFSET + 40 * s + 8 * i, v, true));
  });
  const { posPeak, negPeak, kPos, kNeg } = ctx.amp;
  [posPeak, negPeak, kPos, kNeg].forEach((v, i) => view.setFloat32(BLOB_AMP_OFFSET + 4 * i, v, true));
  view.setUint32(BLOB_IR1_OFFSET_FIELD, 0, true);
  view.setUint32(BLOB_IR1_LEN_FIELD, IR1_LEN, true);
  view.setUint32(BLOB_IR2_OFFSET_FIELD, IR1_LEN, true);
  view.setUint32(BLOB_IR2_LEN_FIELD, IR2_LEN, true);
  writeResampledIr(view, BLOB_IR_DATA, ir1, IR1_LEN, ctx.sr);
  writeResampledIr(view, BLOB_IR_DATA + 4 * IR1_LEN, ir2, IR2_LEN, ctx.sr);
  bytes.set(BLOB_MAGIC, 0);
  view.setUint16(4, BLOB_SIZE, true);
  const crc = crc16(bytes, BLOB_CRC_START, BLOB_SIZE);
  bytes[BLOB_CRC_OFFSET] = crc.lo;
  bytes[BLOB_CRC_OFFSET + 1] = crc.hi;
  return bytes;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Port of HTKPA::init(sr) + setInput/OutputSignalPath + startClone().
 *
 * @param input  channel 0 of HTCache/<sr>.wav (the excitation), float [-1, 1)
 * @param output channel 0 of the NAM render of that excitation, same rate
 * @param sampleRate model sample rate: 44100, 48000 or 96000
 * @returns the 8840-byte VTSI blob
 */
export function cloneSnapTone(input: Float32Array, output: Float32Array, sampleRate: number): Uint8Array {
  const ctx = createContext(input, output, sampleRate);
  detrendOutput(ctx);
  ctx.delay = findDelay(ctx);
  ctx.amp = fitAmpCurve(ctx);

  const { sr } = ctx;
  const mag1 = tfMain(ctx, excitationWindow(ctx, TF_MAIN_START_S, Math.trunc(f(TF_MAIN_SPAN_S * sr))));
  const firWindow = excitationWindow(ctx, TF_FIR_START_S, Math.trunc(f(TF_FIR_SPAN_S * sr)));
  const tf = tfRatio(ctx, firWindow, mag1);
  const ir1 = new Float32Array(IR1_LEN);
  const ir2 = new Float32Array(IR2_LEN);
  ir2[0] = 1;
  const state: IterState = {
    weight: new Float32Array(TF_NFREQ).fill(1),
    exponent: buildExponentWeights(ctx),
    ratio: tf.ratio,
    mag: tf.mag,
    freq: tf.freq,
    ir1,
    ir2,
  };
  const iterWindows = [
    firWindow,
    excitationWindow(ctx, TF_MAIN_START_S, Math.trunc(f(TF_MAIN_SPAN_S * sr))),
    excitationWindow(ctx, ITER3_START_S, Math.trunc(f(sr * ITER3_SPAN_S))),
  ];
  iterWindows.forEach((w, i) => iterAmpCoeff(ctx, state, w, ITER_COUNTS[i]));

  finalizeIr2(ctx, excitationWindow(ctx, SYNC_AVG_START_S, Math.trunc(f(sr * SYNC_AVG_SPAN_S))), ir1, ir2);
  const ir2Blob = ir2.map((v) => f(v * IR2_BLOB_GAIN));
  return buildBlob(ctx, ir1, ir2Blob);
}
