import type { DeviceHostApi } from "@shared/host/device";
import { invoke } from "./invoke";

export const deviceApi: DeviceHostApi = {
  status: () => invoke("device:status"),
  saveReport: (text, fileName) => invoke("device:saveReport", text, fileName),
  pickSuitePath: () => invoke("device:pickSuitePath"),
};
