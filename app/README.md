# GP-5 Tone Studio (app)

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
| `npm run build` / `npm run dist` | `electron-vite` build; `dist` also packages with `electron-builder.yml` |

## Launch parameters (web build, demos, E2E)
- `?mock` connects the simulated GP-5, loaded with the bundled 100-slot backup (`src/renderer/src/gp5/fixtures/backup/`).
- `?screen=rig|library|tones|device|capture` opens that screen. Add `&param=` to pass a value: `device` + `settings` opens Settings, and `capture` takes a capture id.

## Layout
- `src/main/`: the window, menu, permissions (`midi`/`midiSysex`, audio-only `media`) and CSP. It also has the `app://bundle` protocol and one IPC module per domain in `ipc/`.
- `src/preload/`: exposes the typed `window.gp5host`, using one module per domain. Results unwrap to `HostError`.
- `src/shared/`: the host API types (`host.ts`, `host/*.ts`), the IPC contract, and pure helpers shared across processes.
- `src/renderer/src/`:
  - `app/`: the shell, palette, command bus and toasts
  - `state/`: the device store (`device.ts`, contract in `device-types.ts`), navigation, UI bus and MIDI log
  - `components/gear/`: hardware art with an accessible control layer
  - `components/write/`: the write confirmation and helpers
  - `screens/<name>/`: the screens
  - `host/web/`: the browser fallbacks

## TONE3000
Sign-in needs a TONE3000 app key (client_id). Set it with `MAIN_VITE_T3K_CLIENT_ID` at build time, or `T3K_CLIENT_ID` at runtime, or `userData/tone3000.json`. See `../design/tone3000.md`. Tokens are encrypted with Electron `safeStorage`. When the OS keychain is unavailable, for example KWallet not initialised, they are kept in memory only.
