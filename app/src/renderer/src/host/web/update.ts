import type { UpdateApi, UpdateSnapshot } from "@shared/host/update";
import { HostError } from "@shared/ipc";

// Browser build: a new deploy is the update, the page picks it up on the next load.
const snapshot: UpdateSnapshot = { mode: "unsupported", current: "web", state: { status: "idle" } };

export const webUpdate: UpdateApi = {
  state: async () => snapshot,
  check: async () => snapshot,
  download: async () => {
    throw new HostError("unsupported", "Updates are part of the desktop app");
  },
  install: async () => {
    throw new HostError("unsupported", "Updates are part of the desktop app");
  },
  onState: () => () => {},
};
