// IR match session: open the GP-5's USB input, turn the CAB block off live, record ~20 s of the player, then design
// the cabinet IR that takes the cab-less recording to the guitar stem's spectrum (irdesign.ts).
// The CAB block's on/off is put back after the recording, on cancel, and when the panel goes away.
import { create } from "zustand";
import { host } from "@/host";
import { encodeWav } from "@/song/wav";
import { useDevice } from "@/state/device";
import { IR_RATE, matchIr, type MatchedIr } from "./irdesign";
import { ltas, LTAS_FRAME } from "./ltas";
import { InputRecorder, isGp5Input, listInputs, type AudioInput, type Level } from "./recorder";
import { useToneMatch } from "./store";

export const RECORD_S = 20;
/** Gated playing needed for a usable spectrum */
export const MIN_PLAYING_S = 6;
const CAB = 4;
const TICK_MS = 200;

export type IrStep =
  | { kind: "idle" }
  | { kind: "opening" }
  /** Input open and metering, CAB off: waiting for Record */
  | { kind: "ready" }
  | { kind: "recording" }
  | { kind: "done"; result: MatchedIr; playedS: number }
  | { kind: "error"; message: string };

/** The input is open and the CAB block is off: nothing else may change the preset meanwhile. */
export const isSessionLive = (step: IrStep) => step.kind === "opening" || step.kind === "ready" || step.kind === "recording";

export interface IrMatchState {
  step: IrStep;
  inputs: AudioInput[];
  inputId: string | null;
  level: Level | null;
  /** Seconds recorded in the current take */
  seconds: number;
  /** Open the input (asks for permission) and turn the CAB block off */
  open(): Promise<void>;
  selectInput(deviceId: string): Promise<void>;
  record(): void;
  /** Stop the take (also called after RECORD_S) and design the IR */
  finish(): Promise<void>;
  /** Stop everything and put the CAB block back */
  cancel(): Promise<void>;
  /** The IR as a 24-bit mono 44.1 kHz WAV */
  wavBytes(): Uint8Array | null;
  /** Save the WAV through the host; resolves with where it went, null when cancelled */
  save(fileName: string): Promise<string | null>;
}

let recorder: InputRecorder | null = null;
let ticker: number | undefined;
/** The CAB block's state before the session turned it off (only restored on the same slot). */
let cab: { slot: number; enabled: boolean } | null = null;

const message = (e: unknown) => {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "NotAllowedError" || e.name === "SecurityError") return "Recording needs permission to use your audio input.";
  if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "That audio input isn't available any more. Pick another one.";
  return e.message;
};

function cabOff() {
  const d = useDevice.getState();
  if (d.status !== "connected" || !d.preset) throw new Error("Connect the GP-5 first: the recording goes through it, with its CAB block turned off.");
  if (!cab) cab = { slot: d.preset.slot, enabled: d.preset.blocks[CAB].enabled };
  if (d.preset.blocks[CAB].enabled) d.setBlockEnabled(CAB, false);
}

function restoreCab() {
  const saved = cab;
  cab = null;
  const d = useDevice.getState();
  if (!saved || d.status !== "connected" || d.preset?.slot !== saved.slot) return;
  if (d.preset.blocks[CAB].enabled !== saved.enabled) d.setBlockEnabled(CAB, saved.enabled);
}

async function closeRecorder() {
  window.clearInterval(ticker);
  ticker = undefined;
  const r = recorder;
  recorder = null;
  await r?.close().catch(() => {});
}

export const useIrMatch = create<IrMatchState>((set, get) => {
  /** Bumped by every open/cancel, so an input that finishes opening after a cancel is closed instead of kept. */
  let attempt = 0;
  const openInput = async (deviceId: string | null, id: number) => {
    await closeRecorder();
    const r = await InputRecorder.open(deviceId, (level) => set({ level }));
    if (id !== attempt) {
      await r.close().catch(() => {});
      return false;
    }
    recorder = r;
    return true;
  };
  const fail = async (e: unknown) => {
    await closeRecorder();
    restoreCab();
    set({ step: { kind: "error", message: message(e) } });
  };

  return {
    step: { kind: "idle" },
    inputs: [],
    inputId: null,
    level: null,
    seconds: 0,

    async open() {
      if (!useToneMatch.getState().analysis) return;
      const audition = useToneMatch.getState().audition.kind;
      if (audition === "applying" || audition === "restoring") {
        set({ step: { kind: "error", message: "Wait until the preset audition finishes, then start the IR match." } });
        return;
      }
      const id = ++attempt;
      set({ step: { kind: "opening" }, seconds: 0, level: null });
      try {
        cabOff();
        const inputs = await listInputs();
        if (id !== attempt) return;
        if (inputs.length === 0) throw new Error("No audio input found. Connect the GP-5 with USB; it is also an audio interface.");
        const keep = inputs.find((i) => i.deviceId === get().inputId);
        const inputId = (keep ?? inputs.find((i) => isGp5Input(i.label)) ?? inputs[0]).deviceId;
        set({ inputs, inputId });
        if (await openInput(inputId, id)) set({ step: { kind: "ready" } });
      } catch (e) {
        if (id === attempt) await fail(e);
      }
    },

    async selectInput(deviceId) {
      if (get().step.kind !== "ready") return;
      const id = attempt;
      set({ inputId: deviceId, level: null });
      try {
        await openInput(deviceId, id);
      } catch (e) {
        if (id === attempt) await fail(e);
      }
    },

    record() {
      if (!recorder || get().step.kind !== "ready") return;
      recorder.start();
      set({ step: { kind: "recording" }, seconds: 0 });
      ticker = window.setInterval(() => {
        const seconds = recorder?.seconds ?? 0;
        set({ seconds });
        if (seconds >= RECORD_S) void get().finish();
      }, TICK_MS);
    },

    async finish() {
      if (!recorder || get().step.kind !== "recording") return;
      window.clearInterval(ticker);
      const rate = recorder.sampleRate;
      const samples = recorder.stop();
      await closeRecorder();
      restoreCab();
      try {
        const stem = useToneMatch.getState().analysis?.ltas;
        if (!stem) throw new Error("The song's analysis went away. Analyse it again.");
        const recording = ltas(samples, rate);
        const playedS = (recording.activeFrames * (LTAS_FRAME / 2)) / rate;
        if (playedS < MIN_PLAYING_S)
          throw new Error(`Only ${playedS.toFixed(0)} s of playing came through. Check that the GP-5 is the input and its level moves when you play, then record again.`);
        set({ step: { kind: "done", result: matchIr(stem, recording), playedS } });
      } catch (e) {
        set({ step: { kind: "error", message: message(e) } });
      }
    },

    async cancel() {
      attempt++;
      recorder?.stop();
      await closeRecorder();
      restoreCab();
      set({ step: { kind: "idle" }, level: null, seconds: 0 });
    },

    wavBytes() {
      const { step } = get();
      return step.kind === "done" ? encodeWav({ sampleRate: IR_RATE, channels: [step.result.ir] }, 24) : null;
    },

    async save(fileName) {
      const bytes = get().wavBytes();
      if (!bytes) return null;
      return host.song.saveFiles([{ name: fileName, bytes }], "Save the matched IR");
    },
  };
});

// A new analysis (another song, or analysed again) makes a recording or a matched IR stale.
useToneMatch.subscribe((s, prev) => {
  if (s.analysis !== prev.analysis && useIrMatch.getState().step.kind !== "idle") void useIrMatch.getState().cancel();
});
