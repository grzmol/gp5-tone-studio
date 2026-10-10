# Changelog

All notable changes to VLTN Tone Studio. Versions match `app/package.json` and the GitHub Releases. The release workflow copies the section of the version it publishes into the release notes.

## [0.4.0] - 2026-10-10

### Added
- **In-app updates.** When Tone Studio starts and finds a newer release on GitHub, it asks whether to download and install it. On Windows and with the AppImage, *Download and install* fetches the update, checks it against the SHA-512 published with the release, and restarts into the new version. The progress shows in the dialog, and *Hide* lets you keep working while it downloads. On macOS and with the `.deb`, the dialog offers the release page instead.
- **Safe restarts.** The app never restarts for an update while it is writing to or backing up the GP-5. If the preset has unsaved changes, it asks first. *Later* or *Install when I quit* installs a downloaded update the next time you close the app.
- **Update controls.** *Help › Check for updates…*, the command palette and the About dialog check right away. *Settings › About* shows the version and the update status. It also has *Check for updates automatically* (on by default: at launch and every six hours). Nothing is downloaded until you agree.

### Changed
- Releases also publish `latest.yml`, `latest-linux.yml` and the installer blockmaps, which the app updates from. Each release is created as a draft and only published once every file is uploaded. The workflow stops if the update files are missing or name another version.

### Known limitations
- 0.4.0 is the first version that can update itself. To get it, download it from the Releases page; from 0.4.0 on, the app offers new versions by itself.
- macOS builds aren't signed yet, so macOS can't install updates in place. The app opens the release page instead.

## [0.3.0] - 2026-10-10

### Added
- **User IRs over USB.** Tone Studio writes cab IRs straight to the GP-5's 20 User IR slots, without Valeton Suite, on Windows, macOS and Linux. It works for IR tones from TONE3000, for a `.wav` you drop on the window or open, and for the IR made by Tone Match. The WAV is prepared the way Suite does it: first channel, resampled to 44.1 kHz, 24-bit, first 512 samples (11.6 ms, all the GP-5 keeps). Before you write to an occupied slot, the app shows what you'll replace.
- **TONE3000 app key in Settings.** Enter your publishable key under *Settings › TONE3000 account*. If you change it, the app signs you out. With no key set, Tones links to Settings.
- **Tone Match is easier to find.** It's in the command palette (*Tone match*, *Split a song into stems*), and after a split the stems view shows a *Match the guitar tone* button. The analysis starts as soon as the split finishes.

### Changed
- *Sign in to TONE3000* now signs you in and comes straight back; you no longer have to pick a tone first. *Browse TONE3000* still opens the tone picker.
- Tones opens on the *Trending* list.
- User IR slots are numbered 1–20 everywhere, like on the pedal and in the Rig.
- The Song screen remembers whether you were on Stems or Tone match.
- *Settings › Valeton Suite* is only used to find the SnapTone test signal and for firmware updates, and it's hidden on Linux.
- Builds made locally with `npm run dist` include Valeton's SnapTone test signal when it's in the git-ignored fixtures folder. Published builds still ask for the file once.

### Removed
- The Valeton Suite hand-off for IRs: the *Ready for Valeton Suite* folder, *Open Valeton Suite* and linking the slot after Suite.

### Known limitations
- Overwriting a User IR slot that already holds an IR hasn't been tested on a GP-5 yet. The pedal can't send an IR back, so keep the WAV of anything you replace.

## [0.2.0] - 2026-10-10

### Added
- NAM A2 captures become GP-5 SnapTones (bit-exact with Valeton Suite's renderer).
- Song screen: splits a song into six stems on your computer, and Tone Match proposes a GP-5 preset and a matching IR from the guitar stem.

## [0.1.0] - 2026-10-10

### Added
- Editor and librarian for the Valeton GP-5: Rig, Library, Tones, Device and Settings.
- NAM A1 captures become SnapTones in the app and are written to the pedal over USB (no Valeton Suite).
- TONE3000 sign-in, tone lists and downloads.
- Release builds for macOS (`.dmg`), Windows (NSIS) and Linux (AppImage, `.deb`).

[0.4.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/grzmol/VLTN-Tone-Studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/grzmol/VLTN-Tone-Studio/releases/tag/v0.1.0
