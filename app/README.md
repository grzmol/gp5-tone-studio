# VLTN Tone Studio (app)

A desktop editor and librarian for the Valeton GP-5, built with Electron 43 (Chromium 150), React 19, TypeScript, Tailwind v4 and shadcn/ui (radix).

The design source is `../design/` (DESIGN.md, the screen specs and the mockups). The GP-5 protocol code is vendored from `../.claude/skills/gp5-toolkit` into `src/renderer/src/gp5/`.

Electron is pinned to 43.x because Chromium 152 (Electron 44) breaks WebMIDI SysEx.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Electron with HMR |
| `npm run web` | The renderer as a web app on http://localhost:5790 (Chrome or Edge, using WebMIDI) |
| `npm run typecheck` | Typechecks the main/preload and renderer projects |
| `npm test` | Vitest (renderer, main and shared logic) |
| `npm run test:toolkit` | Byte-exact protocol and .prst tests of the vendored toolkit |
| `npm run build:wasm` | Rebuilds `src/renderer/src/snaptone/a1kernel.wasm` from `a1kernel.c` (needs clang with the wasm32 target; the `.wasm` is committed) |
| `npm run build` / `npm run dist` | `electron-vite` build; `dist` also packages with `electron-builder.yml` |

## Branches and releases
- Work happens on `develop`. Merging `develop` into `main` publishes a release: `.github/workflows/release.yml` runs the typecheck and both test suites, builds the `.dmg` (arm64 and x64), the NSIS installer, the AppImage and the `.deb`, and creates GitHub Release `v<version>` with them.
- `<version>` is `version` in `package.json`. Bump it on `develop` before merging; the workflow fails when that release already exists.
- Add a `## [<version>]` section to `../CHANGELOG.md` in the same change. The workflow fails without it, and it puts that section at the top of the release notes, before the install notes (`.github/release-notes.md`) and GitHub's list of PRs.
- The TONE3000 sign-in in release builds needs the repository secret `T3K_CLIENT_ID`.
- Packages are unsigned: macOS Gatekeeper and Windows SmartScreen warn on first launch.
- In-app updates (`src/main/ipc/update.ts`, `src/renderer/src/app/updates.ts`, `overlays/UpdateDialog.tsx`) read the release's `latest.yml` / `latest-linux.yml`, written by electron-builder from `publish` in `electron-builder.yml`. The workflow uploads them with the blockmaps and stops if one is missing or names another version. The release is created as a draft and published once every file is there. Packaged builds check 3 s after launch and every 6 h (*Settings › About* can turn that off). A new version opens a dialog: "Download and install" fetches the installer (electron-updater checks the SHA-512) and restarts into it, unless a pedal job is running or the preset has unsaved changes. "Later" leaves a downloaded update to install on quit. This applies to the Windows installer and the AppImage. macOS (unsigned, so Squirrel.Mac can't update it), the `.deb` and `npm run dev` offer the release page instead. Development runs check only on *Help › Check for updates…*.

## Launch parameters (web build, demos, E2E)
- `?mock` connects the simulated GP-5, loaded with the bundled 100-slot backup (`src/renderer/src/gp5/fixtures/backup/`).
- `?screen=rig|library|tones|device|capture|song` opens that screen. Add `&param=` to pass a value: `device` + `settings` opens Settings, `capture` takes a capture id, and `song` takes the tab (`stems` or `tone`, e.g. `?screen=song&param=tone` opens Tone match; without it Song reopens the tab used last).

## Layout
- `src/main/`: the window, menu, permissions (`midi`/`midiSysex`, audio-only `media`) and CSP. It also has the `app://bundle` protocol and one IPC module per domain in `ipc/`.
- `src/preload/`: exposes the typed `window.gp5host`, using one module per domain. Results unwrap to `HostError`.
- `src/shared/`: the host API types (`host.ts`, `host/*.ts`), the IPC contract, and pure helpers shared across processes.
- `src/renderer/src/`:
  - `app/`: the shell, palette, command bus and toasts
  - `state/`: the device store (`device.ts`, contract in `device-types.ts`), navigation, UI bus and MIDI log
  - `components/gear/`: hardware art with an accessible control layer
  - `components/write/`: the write confirmation and helpers
  - `snaptone/`: NAM A1/A2 → SnapTone conversion in a Web Worker (see below)
  - `song/`: the Song screen's store, decoding, WAV writer and stem separation (see below)
  - `screens/<name>/`: the screens
  - `host/web/`: the browser fallbacks

## SnapTones
`src/renderer/src/snaptone/` reproduces Valeton Suite 2.1.0's NAM → SnapTone converter, so captures go to the pedal without Suite:
- `pipeline.ts`: the model is checked (`shared/nam.ts` `prepareNam`: A1 at the trainer sizes, or A2), the excitation (channel 0 of Suite's `nam_input_wav.wav`) is resampled to the model rate, the model renders it, and `htkpa.ts` measures the pair into the 8840-byte clone.
- `wavenet.ts` + `a1kernel.wasm`: NAM A1 WaveNet with fast tanh, as Suite renders it.
- `a2.ts` + `a2kernel.wasm`: NAM A2. Suite renders a `SlimmableContainer`'s last (full-size) submodel through NeuralAmpModelerCore's A2 fast path. The kernel copies that path's operation order and matches it bit for bit (`a2.test.ts`, reference outputs from NAM core).
- `kernel.ts`: shared host for both kernels (heap, prewarm, 1024-frame blocks). Rebuild the `.wasm` files with `npm run build:wasm` (clang with the wasm32 target).
- `htkpa.ts`: port of Suite's native HTKPA clone and its r8brain resampler. The tests check the whole pipeline against clones made by Suite itself (`gp5/fixtures/snaptone-a1std.clo`, `gp5/fixtures/snaptone-a2.clo`).
- `worker.ts` / `convert.ts`: run it off the UI thread (about 10–20 s).
- The upload is `Gp5Session.uploadSnapTone` (`gp5/lib/snaptone.mjs`): command `11 25`, 146 frames, one ACK each, verified in the 0x24 table.

`nam_input_wav.wav` is Valeton's test signal, so it isn't in the repo or in published builds. When it sits in `src/renderer/src/snaptone/fixtures/` (git-ignored), `npm run dev` and local `npm run dist` builds use it automatically (electron-builder `extraResources`; CI checkouts don't have it). Otherwise the app asks for it once ("Choose nam_input_wav.wav…" in the send steps); on Windows and macOS it is also picked up from the Valeton Suite install (Settings › Valeton Suite, hidden on Linux where it has no use). Either way main keeps a checked copy in `userData/snaptone/` (`src/main/ipc/snaptone.ts`). The browser build keeps it in memory. The same fixture copy runs the comparison tests; without it those tests are skipped.

## User IRs
IRs go to the pedal's 20 User IR slots over USB, without Suite. The upload was reverse-engineered from Valeton Suite 2.1.0's code (`.claude/skills/gp5-reverse-engineering/userir.md`). It is covered by `MockGp5` tests, and a GP-5 accepted it on 2026-10-10 (all 112 frames ACKed, slot read back from the 0x20 table). Overwriting an occupied slot hasn't been tried on hardware yet.
- `userir/convert.ts` `prepareUserIr` does what Suite does with a WAV: channel 0, r8brain resample to 44.1 kHz (`snaptone/htkpa.ts`), JUCE 24-bit rounding, and the first 512 samples (11.6 ms). Each sample is sent as an int32. A 24-bit / 44.1 kHz file goes through unchanged.
- The upload is `Gp5Session.uploadUserIr` (`gp5/lib/userir.mjs`): command `11 21`, 112 frames, one ACK each. It is verified in the 0x20 User IR table, and `useDevice.uploadUserIr` wraps it.
- Entry points, each ending in a slot picker and a Write button (that press is the confirmation; an occupied slot shows what it replaces):
  - Tones › a TONE3000 IR (`UserIrSteps`; main `tones:prepareIr` downloads the WAV and checks it, then the slot is linked to the tone);
  - a `.wav` opened or dropped outside Song (`LocalIrDialog`);
  - Tone Match's matched IR.
- IR content can't be read back from the pedal. The UI numbers slots 1–20 like the pedal; in code they are 0–19.

## Song: stem splitter
The Song screen (`screens/song/`, store `song/store.ts`) splits a song into six stems with Demucs `htdemucs_6s` (drums, bass, other, vocals, guitar, piano) on the user's machine:
- The model isn't bundled. `SEPARATION_MODEL` in `src/shared/host/song.ts` pins the ONNX export (Hugging Face URL at a commit, SHA-256, size). The desktop app downloads it in main into `userData/models/` (resumes a `.part` file, checks the hash, then renames it; `src/main/ipc/song.ts`). The browser build keeps it in Cache Storage.
- `song/decode.ts` decodes with WebAudio at 44.1 kHz and makes mono stereo. `song/stems/worker.ts` runs onnxruntime-web, using WebGPU when the GPU can run the model and single-threaded WebAssembly otherwise. `song/stems/demucs.ts` ports Demucs' normalisation and chunked overlap-add (`apply_model`, overlap 0.25). It matches PyTorch within 3e-4.
- On an RTX 4070 Ti SUPER, a 30 s clip splits in about 4.3 s with WebGPU, and a 3:51 song in 28 s. The WebAssembly fallback takes about 87 s for the same 30 s: the page isn't cross-origin isolated, so it runs on one thread.
- Stems export as 16- or 24-bit WAV (`song/wav.ts`, `host.song.saveFiles`).
- Audio files dropped on the window open in Song. While Song is showing, a dropped `.wav` is also a song; elsewhere it goes to a User IR slot.

Tone Match (`song/tonematch/`, `screens/song/tonematch/`): analyses the guitar stem in a Web Worker (1/3-octave silence-gated LTAS, gain class, delay from onset autocorrelation, reverb from note-ending tails), proposes a GP-5 preset auditioned through the Rig's live edits (`screens/rig/edits.ts`, nothing is saved), and designs a 1024-tap minimum-phase cabinet IR (44.1 kHz) from a ~20 s recording of the GP-5's USB audio with the CAB block off. "Write to a User IR slot…" sends it over USB (`LocalIrDialog`; the pedal keeps the first 512 taps).

## TONE3000
Sign-in needs a TONE3000 app key (client_id). Enter it in Settings › TONE3000 account (saved as `clientId` in `userData/tone3000.json`; changing it signs out), or set `MAIN_VITE_T3K_CLIENT_ID` at build time, or `T3K_CLIENT_ID` at runtime. The Settings key wins. See `../design/tone3000.md`. Tokens are encrypted with Electron `safeStorage`. When the OS keychain is unavailable, for example KWallet not initialised, they are kept in memory only.
