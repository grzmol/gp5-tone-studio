import type { SnapToneApi } from "@shared/host/snaptone";
import { invoke } from "./invoke";

export const snapToneApi: SnapToneApi = {
  hasSignal: () => invoke("snaptone:hasSignal"),
  signal: () => invoke("snaptone:signal"),
  chooseSignal: () => invoke("snaptone:chooseSignal"),
};
