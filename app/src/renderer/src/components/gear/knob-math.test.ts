import { describe, expect, it } from "vitest";
import { DRAG_RANGE_PX, FINE_FACTOR, clampStep, dragValue, formatValue, keyValue, parseTyped, valueText, wheelValue } from "./knob-math";

const pct = { min: 0, max: 100, step: 1 };
const time = { min: 20, max: 1000, step: 1, unit: "ms" };
const tenths = { min: 0.1, max: 10, step: 0.1, unit: "Hz" };
const eq = { min: -50, max: 50, step: 1 };

describe("clampStep", () => {
  it("clamps to the range", () => {
    expect(clampStep(-5, pct)).toBe(0);
    expect(clampStep(140, pct)).toBe(100);
    expect(clampStep(5, time)).toBe(20);
  });
  it("snaps to the step grid anchored at min without float noise", () => {
    expect(clampStep(41.6, pct)).toBe(42);
    expect(clampStep(0.1 + 0.2, tenths)).toBe(0.3);
    expect(clampStep(9.96, tenths)).toBe(10);
  });
  it("maps non-finite input to min", () => {
    expect(clampStep(Number.NaN, eq)).toBe(-50);
  });
});

describe("keyValue", () => {
  it("steps ±1 with arrows and ±10 with page keys", () => {
    expect(keyValue("ArrowUp", 50, pct)).toBe(51);
    expect(keyValue("ArrowRight", 50, pct)).toBe(51);
    expect(keyValue("ArrowDown", 50, pct)).toBe(49);
    expect(keyValue("ArrowLeft", 50, pct)).toBe(49);
    expect(keyValue("PageUp", 50, pct)).toBe(60);
    expect(keyValue("PageDown", 50, pct)).toBe(40);
  });
  it("uses the param step for fractional params", () => {
    expect(keyValue("ArrowUp", 0.5, tenths)).toBe(0.6);
    expect(keyValue("PageDown", 0.5, tenths)).toBe(0.1);
  });
  it("clamps at the limits and jumps with Home/End", () => {
    expect(keyValue("PageUp", 95, pct)).toBe(100);
    expect(keyValue("ArrowDown", -50, eq)).toBe(-50);
    expect(keyValue("Home", 300, time)).toBe(20);
    expect(keyValue("End", 300, time)).toBe(1000);
  });
  it("ignores other keys", () => {
    expect(keyValue("a", 50, pct)).toBeNull();
    expect(keyValue(" ", 50, pct)).toBeNull();
  });
});

describe("dragValue", () => {
  it("turns the full range over DRAG_RANGE_PX, up = more", () => {
    expect(dragValue(0, -DRAG_RANGE_PX, pct)).toBe(100);
    expect(dragValue(50, -DRAG_RANGE_PX / 4, pct)).toBe(75);
    expect(dragValue(50, DRAG_RANGE_PX / 4, pct)).toBe(25);
  });
  it("is FINE_FACTOR times slower with Shift", () => {
    expect(dragValue(50, -DRAG_RANGE_PX / 4, pct, true)).toBe(Math.round(50 + 25 / FINE_FACTOR));
    expect(dragValue(20, -DRAG_RANGE_PX, time, true)).toBe(118);
  });
  it("clamps", () => {
    expect(dragValue(90, -1000, pct)).toBe(100);
    expect(dragValue(-40, 1000, eq)).toBe(-50);
  });
});

describe("wheelValue", () => {
  it("moves 1% of the range per notch (at least one step), Shift one step", () => {
    expect(wheelValue(50, -100, pct)).toBe(51);
    expect(wheelValue(300, -100, time)).toBe(310);
    expect(wheelValue(300, 100, time, true)).toBe(299);
    expect(wheelValue(1, -3, tenths)).toBe(1.1);
  });
  it("ignores zero deltas and clamps", () => {
    expect(wheelValue(50, 0, pct)).toBe(50);
    expect(wheelValue(100, -100, pct)).toBe(100);
  });
});

describe("typed values", () => {
  it("parses numbers with units, commas and signs, clamped and snapped", () => {
    expect(parseTyped("320 ms", time)).toBe(320);
    expect(parseTyped("-3,4", eq)).toBe(-3);
    expect(parseTyped("2,25", tenths)).toBe(2.3);
    expect(parseTyped("5000", time)).toBe(1000);
  });
  it("returns null for text without a number", () => {
    expect(parseTyped("loud", pct)).toBeNull();
    expect(parseTyped("", pct)).toBeNull();
  });
  it("formats with the step's decimals and unit", () => {
    expect(formatValue(42, pct)).toBe("42");
    expect(formatValue(2.3, tenths)).toBe("2.3");
    expect(valueText(320, time)).toBe("320 ms");
  });
});
