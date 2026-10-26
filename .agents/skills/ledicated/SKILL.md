---
name: ledicated
description: >-
  Upravljanje LEDicated DAW rasvjetnim studiom i WLED kontrolerima.
  Omogućuje AI agentima live uređivanje vremenske trake (timeline),
  upravljanje reprodukcijom (play, pause, seek, loop), okidanje live performance padova,
  postavljanje master svjetline i blackouta, te konfiguraciju hardvera (E8, C3, DDP).
---

# LEDicated Skill — Studio Light & Timeline Controller

Ovaj skill omogućuje agentima u Antigravityju da u stvarnom vremenu upravljaju LEDicated aplikacijom, uređuju timeline, aktiviraju efekte i upravljaju showom poput korisnika.

## Načini korištenja

### 1. Preko MCP alata (Model Context Protocol)
Poslužitelj je registriran u globalnoj konfiguraciji `~/.gemini/config/mcp_config.json` pod imenom `ledicated`.

Dostupni MCP alati:
- `ledicated_get_status` — Cjelokupno stanje aplikacije, otvoreno sučelje, aktivna pjesma, playhead, master, blackout, snaga (W).
- `ledicated_list_tracks` — Popis svih audio zapisa u biblioteci.
- `ledicated_get_track_details` — Detaljna analiza (stemovi, taktovi, energija).
- `ledicated_select_track` — Odabir pjesme za uređivanje i reprodukciju.
- `ledicated_get_timeline` — Dohvat slojeva, clipova i keyframeova.
- `ledicated_add_layer` — Dodavanje novog sloja (blend mode, opacity, boja).
- `ledicated_remove_layer` — Brisanje sloja.
- `ledicated_add_clip` — Dodavanje svjetlosnog efekta na sloj (preset, targets, boja, brzina, audio driver).
- `ledicated_patch_clips` — Izmjena svojstava clipa.
- `ledicated_delete_clips` — Brisanje clipova.
- `ledicated_move_clip` / `ledicated_resize_clip` / `ledicated_split_clip` / `ledicated_duplicate_clips`.
- `ledicated_add_keyframe` / `ledicated_remove_keyframe` — Uređivanje krivulje intenziteta.
- `ledicated_create_auto_show` — Automatsko generiranje kompletnog showa usklađenog s dropovima i ritmom pjesme.
- `ledicated_transport_control` — Reprodukcija: `play`, `pause`, `stop`, `seek`, `loop`, `set_tempo`, `tap_tempo`, `record`.
- `ledicated_live_pad_trigger` — Opaljivanje live performance padova (QWERASDFZXCV).
- `ledicated_set_master` — Postavljanje master svjetline (0–60).
- `ledicated_blackout` — Panic switch za gašenje svih LED dioda.
- `ledicated_get_preview_frame` — Dohvat točnih RGBW vrijednosti za svih 9 barova i potrošnje u vatima.
- `ledicated_get_hardware_config` / `ledicated_update_hardware_config` — WLED i DDP postavke.
- `ledicated_discover_wled` / `ledicated_probe_wled` / `ledicated_test_bar` / `ledicated_arm_output`.

### 2. Preko CLI alata u terminalu
Iz direktorija projekta (`studio-light-baseline/app`):

```bash
# Status i pregled
node cli.mjs status
node cli.mjs tracks
node cli.mjs timeline --summary
node cli.mjs frame 12.5

# Uređivanje timelinea
node cli.mjs add-layer "Drop Strobe" --color "#3aa0ff"
node cli.mjs add-clip <layerId> strobe 16.0 8.0 --speed 4 --color "#ffffff"
node cli.mjs auto-show --style club --energy 0.85

# Reprodukcija i live padovi
node cli.mjs play
node cli.mjs seek 32.0
node cli.mjs pause
node cli.mjs pad Q hit
node cli.mjs master 45
node cli.mjs blackout
```
