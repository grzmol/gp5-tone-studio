# Notices

This toolkit reimplements and ports protocol knowledge and code from:

- **drewmerc302/valeton-gp50** — MIT License, Copyright (c) 2026 Andrew Mercurio. `.prst` codec (`lib/prst.mjs` is a port of `app/static/prst.js`), CRC/framing, fixtures `65-Puppy.prst`, `67-OerdriveM.prst`, `gp50_suite_write_slot0.json`. The model catalog (`lib/catalog-data.mjs`, `../gp5-effects-catalog/catalog.md`) is generated from its `fxid_ring_gp5.json`, which the author notes is derived from Valeton Suite data: treat it as vendor data and do not redistribute it publicly.
- **fsanchezlme97-ui/gp5-editor** — MIT License, Copyright (c) 2026 fsanchezlme97-ui. GP-5 write/rename capture (`fixtures/gp5_suite_import.json`, `fixtures/97-FF_CC.prst`), SysEx preset select, live-edit layouts.
- **Builty/TonexOneController** — Apache License 2.0, Copyright (C) 2025 Greg Smith (the README also asks for public attribution). USB identification, pacing, global settings, save (0x4A) and patch-volume (0x42) commands, CRC routine credited to rvalladares.com.
- **helvecioneto/gp5-wc** — Apache License 2.0. Live-edit command templates and the GP-5 standard MIDI CC map.
- **cesardamien/hotone-family-firmware-fix** — MIT License, Copyright (c) 2026 Cesar Damien. USB VID/PID facts and the Windows 11 driver analysis.

Facts only, no code copied: flameshikari/valeton-suite-en (GPL-3.0), kabir0st/gp200-studio (GPL-3.0), majabojarska/Valeton-GP180-Rev-Eng (GPL-3.0), lshug/valeton-gp200-english-patch (GPL-3.0), lucascantarelli/gp100-nextgen-editor, lucascantarelli/gp-100-patch-architect, jmiskovic/webgp-200, leocosta1/pocket-cortex, drewmerc302/nam-a2a1-converter.

Valeton, GP-5 and Valeton Suite are trademarks of their owner. This project is not affiliated with Valeton.
