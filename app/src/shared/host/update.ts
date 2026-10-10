// App updates (owner: shell). Releases are the GitHub Releases of RELEASE_REPO, published by .github/workflows/release.yml.
// "install": electron-updater downloads the installer, checks its SHA-512 against latest*.yml and installs it when
// the user restarts (Windows NSIS, Linux AppImage). "notify": the app only says a newer release exists and links to
// it (macOS until builds are signed, the .deb, development runs). "unsupported": the web build.

export const RELEASE_REPO = { owner: "grzmol", repo: "VLTN-Tone-Studio" } as const;

export type UpdateMode = "install" | "notify" | "unsupported";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current"; checkedAt: string }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export interface UpdateSnapshot {
  mode: UpdateMode;
  /** This build's version */
  current: string;
  state: UpdateState;
}

export interface UpdateApi {
  state(): Promise<UpdateSnapshot>;
  /** Ask GitHub now. Resolves with the state after the check (errors land in `state`, they don't throw). */
  check(): Promise<UpdateSnapshot>;
  /** "install" mode, state "available": fetch the installer and verify it. */
  download(): Promise<void>;
  /** State "ready": quit, install and start the new version. Refused while a backup or write is running. */
  install(): Promise<void>;
  onState(cb: (snapshot: UpdateSnapshot) => void): () => void;
}

/** Plain release versions only ("1.2.3" or "v1.2.3"); pre-releases and anything else are not offered. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The release page is built from the version, never taken from the API response. */
export const releaseUrl = (version: string) => `https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/releases/tag/v${version}`;

/** `GET /repos/{owner}/{repo}/releases/latest` body → its plain release version, or null when it isn't one. */
export function latestReleaseVersion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { tag_name, draft, prerelease } = body as Record<string, unknown>;
  if (typeof tag_name !== "string" || draft !== false || prerelease !== false) return null;
  const v = parseVersion(tag_name);
  return v ? v.join(".") : null;
}
