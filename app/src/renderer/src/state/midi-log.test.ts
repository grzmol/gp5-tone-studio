import { describe, expect, it } from "vitest";
import { CC, encode, packetize } from "@/gp5/lib/protocol.mjs";
import { MidiLogDecoder, RingBuffer } from "./midi-log";

describe("RingBuffer", () => {
  it("keeps items oldest first until full", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    expect(r.toArray()).toEqual([1, 2]);
    expect(r.size).toBe(2);
  });

  it("drops the oldest item when over capacity", () => {
    const r = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) r.push(i);
    expect(r.toArray()).toEqual([5, 6, 7]);
    expect(r.size).toBe(3);
    expect(r.last(2)).toEqual([6, 7]);
    expect(r.last(10)).toEqual([5, 6, 7]);
  });

  it("stays bounded at the monitor cap", () => {
    const r = new RingBuffer<number>(2000);
    for (let i = 0; i < 5000; i++) r.push(i);
    const all = r.toArray();
    expect(all.length).toBe(2000);
    expect(all[0]).toBe(3000);
    expect(all.at(-1)).toBe(4999);
  });

  it("clear empties it and keeps working", () => {
    const r = new RingBuffer<string>(2);
    r.push("a");
    r.push("b");
    r.push("c");
    r.clear();
    expect(r.toArray()).toEqual([]);
    r.push("d");
    expect(r.toArray()).toEqual(["d"]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});

describe("MidiLogDecoder", () => {
  const frames = (payload: number[]) => packetize(payload) as Uint8Array[];

  it("decodes a CC preset select with its raw bytes", () => {
    const d = new MidiLogDecoder();
    const line = d.line("tx", Uint8Array.from([0xb0, CC.PRESET_SELECT, 63]))!;
    expect(line).toMatchObject({ dir: "out", text: "Select preset 63", raw: "CC#0 63, B0 00 3F" });
  });

  it("decodes outgoing globals and param edits, naming the param when known", () => {
    const d = new MidiLogDecoder((block, index) => (block === 3 && index === 0 ? "Gain" : undefined));
    const [g] = frames(encode.setGlobal("monitorLevel", 3));
    expect(d.line("tx", g)!.text).toBe("Global Monitor level 3");
    const [p] = frames(encode.setParam(3, 0, 70));
    expect(d.line("tx", p)!.text).toBe("AMP Gain 70");
  });

  it("reassembles multi-frame writes: partial frames, then the decoded message", () => {
    const d = new MidiLogDecoder();
    const prst = new Uint8Array(507);
    const all = frames(encode.writePreset(12, prst));
    expect(all.length).toBeGreaterThan(1);
    const lines = all.map((f) => d.line("tx", f)!);
    expect(lines[0].text).toBe(`Frame 1 of ${all.length}`);
    expect(lines.at(-1)!.text).toBe(`Write slot 12 (${all.length} frames)`);
  });

  it("marks ACKs and unreadable frames", () => {
    const d = new MidiLogDecoder();
    const [ack] = frames([0x14, 0x08, 0x00]);
    expect(d.line("rx", ack, { raw: Uint8Array.from([0x14, 0x08, 0x00]) })).toMatchObject({ dir: "in", text: "Acknowledged", ack: true });
    expect(d.line("rx-bad", Uint8Array.from([0xf0, 1, 2, 0xf7]))).toMatchObject({ dir: "bad" });
  });

  it("describes read requests and replies", () => {
    const d = new MidiLogDecoder();
    const [req] = frames(encode.read(0x40));
    expect(d.line("tx", req)!.text).toBe("Read preset names");
    const reply = Uint8Array.from([0x12, 0x10, 1, 3, 1, 0, 0]);
    expect(d.line("rx", frames([...reply])[0], { raw: reply })!.text).toBe("Reply: pedal settings (7 bytes)");
  });
});
