import type { TonesApi } from "@shared/host/tones";
import { HostError } from "@shared/ipc";

// TONE3000 needs the desktop app: sign-in runs in an embedded view with a redirect only the desktop app can
// intercept, tokens live in the OS keychain, and every API call (lists included) needs the Bearer token.
const desktopOnly = (what: string) => async (): Promise<never> => {
  throw new HostError("unsupported", `${what} needs the desktop app`);
};

export const webTones: TonesApi = {
  account: async () => ({ status: "signed-out", user: null, configured: false, splashSeen: true }),
  markSplashSeen: async () => {},
  beginFlow: desktopOnly("Signing in to TONE3000"),
  setFlowBounds: async () => {},
  cancelFlow: async () => {},
  signOut: async () => {},
  list: desktopOnly("TONE3000"),
  tone: desktopOnly("TONE3000"),
  models: desktopOnly("TONE3000"),
  image: async () => null,
  downloadModel: desktopOnly("Downloading from TONE3000"),
  prepareForSuite: desktopOnly("Preparing files for Valeton Suite"),
  prepareSnapTone: desktopOnly("Downloading from TONE3000"),
  prepareLocalIr: desktopOnly("Preparing files for Valeton Suite"),
  setPending: desktopOnly("Linking slots to TONE3000 tones"),
  link: desktopOnly("Linking slots to TONE3000 tones"),
  local: async () => [],
  handoff: desktopOnly("The Valeton Suite folder"),
  openSuite: desktopOnly("Opening Valeton Suite"),
  pickSuite: desktopOnly("Choosing the Valeton Suite location"),
  onEvent: () => () => {},
};
