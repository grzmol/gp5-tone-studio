## Install

- **macOS**: `…-arm64.dmg` for Apple Silicon, `…-x64.dmg` for Intel. The app isn't signed yet. If macOS says it is damaged or can't be opened, run this once after copying it to Applications:
  `xattr -dr com.apple.quarantine "/Applications/VLTN Tone Studio.app"`
- **Windows**: `…-x64.exe`. SmartScreen warns about an unsigned app: choose *More info* → *Run anyway*.
- **Linux**: `sudo apt install ./vltn-tone-studio-…-amd64.deb`, or make the `.AppImage` executable and run it. MIDI needs access to `/dev/snd/seq` (the `audio` group on some distros); *Device › Diagnostics* shows what is missing.
