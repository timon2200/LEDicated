# Studio Varaždin — 9 Bar Club Grid

Project brief · 24 September 2026 · software implementation updated 26 September 2026


## Aktualno: Studio Light aplikacija

Izrađena je lokalna aplikacija za ovaj sustav: [pokretanje i testovi](app/README.md). Ima osam scena, pet paleta, 3×3 pregled, Mac audio ulaz, procjenu tempa i TAP, beat GO prijelaze, automatski slijed, master i blackout. Sučelje je pojednostavljeno prema [istraživanju MADRIX-a](MADRIX_RESEARCH.md).

Softver je pokretljiv i testiran; fizička instalacija čeka provjeru traka, napajanja, WLED postavki i latencije. Stariji LedFx koraci ispod ostaju alternativni put za usporedbu. Glavni put sada je **BlackHole → Studio Light → WLED**; ne pokretati oba izvora svjetlosnog izlaza istodobno.

## Goal and room layout

Build nine individually controlled, 120 cm diffused LED bars in the 3 × 3 arrangement shown in the supplied sketch. The sketch establishes the visual pattern, not physical dimensions, mounting method, cable lengths, or viewing direction. Number bars from the audience-facing view:

```text
                     BACK / STAGE
              L1          C1          R1

              L2          C2          R2

              L3          C3          R3
                     FRONT / AUDIENCE
```

All nine bars should be independently addressable. Within each bar, pixels should run top to bottom in the logical map even if some strips are installed in reverse; correct those bars in software. This lets a scene sweep across rows, columns and diagonals without depending on wiring order.

## First decisions

1. **The ordered strip:** three 5 m rolls of the AliExpress-selected “24V 2814 RGBWW, WHITE PCB, 5m 60 IP30”. The listing calls it “4in1”, consistent with RGB plus **one selectable white colour** (here warm white), but verify the actual connector/cut marks on arrival. WS2814 itself is a **four-channel RGBW** chip, not independently adjustable warm and cool whites. The product page could not be opened through the available browser tools, so no unshown seller specifications are treated as verified. [Order listing](https://www.aliexpress.com/item/1005010559785087.html); [WS2814 datasheet](https://www.signliteled.com/wp-content/uploads/2024/08/WS2814-Datasheet.pdf); [WLED compatible strips](https://kno.wled.ge/basics/compatible-led-strips/).
2. **The ordered power supplies:** one each labelled 24 V **100 W**, **300 W**, and **400 W** in the order screenshot. The **100 W is a PSU rating, not a strip rating**. These are three separate units, not one combined 800 W source. Their continuous output and electrical certification have not been independently established. Inspect labels and test the units before assigning a role; do not parallel their positive outputs.
3. **Music source:** the MacBook will play general audio, including YouTube, to room speakers. It can capture its own system audio through a virtual loopback device and run LedFx. Arbitrary YouTube videos do **not** provide the lighting system with a dependable BPM/downbeat clock, so the first show mode will react to audio transients and spectrum. An estimated beat clock with tap/phase correction is a later refinement. See [MAC_AUDIO_SETUP.md](MAC_AUDIO_SETUP.md).

## Preliminary numbers

| Item | Calculation | Planning value |
| --- | ---: | ---: |
| Installed strip | 9 × 1.2 m | 10.8 m |
| Rolls to buy if using 5 m rolls | ceil(10.8 / 5) | 3 rolls |
| Physical LEDs, if 60 LEDs/m | 9 × 72 | 648 LEDs |
| Logical pixels, **if 6 LEDs share one WS2814 address** | 9 × 12 | 108 pixels |
| **Illustrative chip-based load only** | 108 groups × 4 channels × 16.5 mA | ≈7.1 A, ≈171 W at 24 V |
| **Actual strip maximum** | Measure delivered strip at full RGBW | Unknown until bench test |
| **Actual per-bar maximum** | Measure a 1.2 m sample at full RGBW | Unknown until bench test |

The number entered in WLED is the number of **addressable groups**, not the number of physical LEDs. Six LEDs per 24 V WS2814 group is common and documented by WLED; verify the actual cut interval and IC count on the delivered strip. A 1.2 m cut works if the cut interval is 10 cm; never cut between marked points. [WLED compatible strips](https://kno.wled.ge/basics/compatible-led-strips/).

At this likely grouping, a bar has only **12 independent zones** spaced roughly 10 cm apart. The aluminium profile and diffuser must be tested from the normal viewing distance; a shallow diffuser could reveal steps or bright points during chases. If smooth fine-grained motion is a top priority, compare a denser addressable strip before committing to all nine profiles.

The ≈171 W figure is **an inference from the [WS2814 IC's nominal 16.5 mA/channel](https://www.signliteled.com/wp-content/uploads/2024/08/WS2814-Datasheet.pdf)** and the assumed six-LED grouping. It is **not a seller rating or measured strip load**; the actual LED arrangement and simultaneous-channel behavior may differ. The 100 W supply is useful only for a fused **single-bar bench test**, within its verified rating. Use one verified, continuously rated supply for the full grid after measuring maximum load and adding headroom. A traceable example class is the [Mean Well LRS-350-24: 24 V, 14.6 A, 350.4 W](https://www.meanwell.com/Upload/PDF/LRS-350/LRS-350-SPEC.PDF); a sealed-driver class is the [HLG-320H-24 family](https://www.meanwell.com/Upload/PDF/HLG-320H/HLG-320H-SPEC.PDF). The low-profile 300 W and 400 W purchases remain test candidates, not accepted permanent-installation ratings.

## Recommended control architecture

```text
YouTube / any Mac audio ── macOS Multi-Output ── room speakers
                                    │
                                    └─ BlackHole virtual input ── LedFx on MacBook
                                                                  │
                                                        dedicated LAN/AP ── WLED nodes
                                                                          └─ nine buffered DATA lines

230 V AC ── protected switch / electrician-installed supply ── 24 V PSU
                                                        │
                                                        ├─ fused +24 V branch to each of nine bars
                                                        └─ 24→5 V converters for C3 controllers
All 24 V LED grounds and controller/data grounds share a defined common reference.
```

**Use the existing ESP32-C3 SuperMini boards for output nodes.** The user lists an order of **10 × 4 MB C3 SuperMini** plus **8 × TZT C3 SuperMini** boards: 18 purchased in total, subject to what is physically on hand. Current WLED documentation lists **two LED strip outputs per C3**, so use five boards for nine separate inputs: four boards drive two bars each and the fifth drives one. The remaining boards are spares. Keep nodes close to their bars if possible; if all five must live in the box behind C1, measure every data cable before choosing direct 5 V data versus differential distribution. Each data output needs a proper **5 V AHCT level shifter/buffer**, unless the selected controller board already includes one. Do not feed 24 V into a C3 GPIO. Confirm the safe GPIOs from the actual SuperMini board revision before wiring. [WLED multi-strip limits](https://kno.wled.ge/features/multi-strip/); [WLED wiring/level shifters](https://kno.wled.ge/basics/wiring-guides/).

Proposed C3 assignment (can be changed to suit physical positions):

| Node | Output 1 | Output 2 |
| --- | --- | --- |
| C3-A | C1 | C2 |
| C3-B | L1 | L2 |
| C3-C | R1 | R2 |
| C3-D | L3 | C3 |
| C3-E | R3 | spare |

Give each node a fixed DHCP reservation and a physical label. Connect the show computer by Ethernet to a dedicated local access point; the C3 boards use its 2.4 GHz Wi-Fi. This reduces contention with guests' phones, though Wi-Fi remains a reliability limit. If the final room has long data runs or crowded radio conditions, redesign around wired/differential data before installation. WLED recommends differential transmission for long LED-data links. [WLED long data lines](https://kno.wled.ge/advanced/longdata/).

**Integrated-controller alternative remains open.** Some ready-made controllers combine 24 V power handling, 5 V data buffering, fuses and Ethernet. Do not select one solely from an older tutorial: the current [QuinLED Dig-Quad product page](https://quinled.info/quinled-dig-quad/) notes an IC failure issue at 24 V on its current pre-assembled revision. The existing C3 boards are the baseline until an exact 24 V-rated controller revision is verified.

### Software in two stages

**Stage 1 — make it work:** flash WLED on the C3s. Configure WS2814 according to [WLED's specific recipe](https://kno.wled.ge/basics/compatible-led-strips/): SK6812 RGBW, BRG color order, swap W and G; verify these against a red/green/blue/white test on the actual strip. Set each output to the measured logical pixel count (estimated 12 per bar). Route macOS system audio to both the speakers and BlackHole, then select BlackHole as the input to **LedFx**. Group LedFx device segments into the nine-bar layout. LedFx defaults to DDP for WLED and supports synchronized virtuals across devices. [LedFx setup](https://docs.ledfx.app/en/latest/configuring.html); [LedFx virtuals](https://docs.ledfx.app/en/latest/howto/virtuals.html); [BlackHole setup](https://github.com/ExistentialAudio/BlackHole/wiki/Getting-Started%3A-Creating-a-Multi-Output-Device).

**Stage 2 — controlled show scenes:** run a central scene engine on the MacBook. It estimates tempo and onset phase from the **same BlackHole audio feed**, with manual **tap BPM**, **phase nudge** and sensitivity controls when the estimate is wrong. It sends coordinated pixel frames to WLED and has a configurable visual latency offset. Song structure and drops cannot be guaranteed from arbitrary audio; the operator cues a deliberate build/drop. If playback later moves to a DJ application with Link/MIDI clock, that clock can replace the estimate. WLED receives [DDP](https://kno.wled.ge/interfaces/ddp/) on UDP 4048; LedFx uses RGB DDP, so WLED's [auto-white mode](https://kno.wled.ge/features/cct/) is needed if its warm-white channel should participate in those effects.

Keep one show computer as the source of live effects at a time. For this app, configure and test a black WLED fallback after realtime timeout, so a blackout or disconnect cannot restore an earlier bright effect. Calm local presets may be selected manually. Verify takeover and recovery during commissioning.

## Parts to source or verify

| Item | Quantity | Specification / purpose | Status |
| --- | ---: | --- | --- |
| 24 V WS2814 RGBW strip, 60 LEDs/m, IP30 | 3 × 5 m rolls | Provides 9 × 1.2 m cuts plus spare material; confirm RGBW warm white and actual draw | Ordered, processing |
| 24 V supplies, labelled 100 W / 300 W / 400 W | 1 each | 100 W for one-bar bench test only; 300 W/400 W are unverified candidates; do not parallel | Ordered, processing |
| Certified 24 V constant-voltage supply | 1 if ordered units cannot be verified for permanent use | Continuous rating above measured full load with installation-temperature headroom | Decision after bench test |
| ESP32-C3 SuperMini boards | 5 active + spares | Two outputs maximum per board in WLED; board-specific GPIOs and firmware image to verify | User lists 18 purchased |
| 24 V → 5 V DC converters | Up to 5 | Local regulated supply for C3 and 5 V buffer, sized to board draw; do not power a C3 from 24 V directly | Needed unless integrated in controller |
| AHCT 3.3 V → 5 V data buffer channels | 9 | e.g. SN74AHCT125-based modules; can be integrated in controller hardware | Needed unless integrated |
| Fused DC distribution | 1 enclosure, 9 branches | One accessible fuse per bar on +24 V close to distribution; terminal blocks rated for aggregate current | Needed |
| DC fuses + labelled holders | 9 + spares | Size per branch from measured bar current and cable rating; no fixed value yet | Needed |
| Bar power cable | 9 runs | Copper 2-core, size from run length, measured current and voltage drop | Length unknown |
| Data cable / connectors | 9 runs | Data plus ground reference, keyed/labelled and strain relieved; differential Tx/Rx pairs for long runs | Length unknown |
| Aluminium LED profiles, diffusers, end caps, clips | 9 × 1.2 m | Size to strip PCB width, provide heat spreading and clean visible bars; test hotspot visibility | Needed |
| Enclosures, ferrules, cable glands, labels | As built | Secure, serviceable, non-exposed terminals | Needed |
| Dedicated Wi-Fi access point + Ethernet to show computer | 1 | Local show network | Recommended |
| BlackHole virtual audio device | 1 Mac install | Captures system audio, including browser playback, before it reaches speakers | Needed for planned Mac audio path |
| USB audio interface | 1 only if needed for reliable wired speaker output | Preferred to Bluetooth for predictable sound/lighting alignment | Conditional |
| Tap/blackout control | 1 | Physical or reliable software control for show operator | Recommended |

**Do not buy all electronics before the one-bar bench test.** Verify strip protocol, color order, maximum current, actual group length, heat and diffuser appearance with one 1.2 m sample first.

## Electrical and installation rules

- Feed **+24 V and GND to each bar from fused distribution**. Do not route nine bars' power through a C3 board or through the copper of other strips. Add end injection only if a full-white test shows a measurable voltage/colour drop along a bar. [WLED wiring pro tips](https://kno.wled.ge/advanced/wiring/).
- Size each cable and fuse together using its **actual run length**, installation method, measured load and local electrical requirements. No branch fuse value can be finalized from the order screenshot. Fuse each positive branch close to the supply/distribution point. Use ferrules in screw terminals and secure all cables mechanically. [WLED wiring pro tips](https://kno.wled.ge/advanced/wiring/).
- Keep 230 V AC connections, protective earth, supply enclosure, switching and building attachment under a qualified electrician's design/installation. The IP30 strip is for dry interior locations; protect touchable wiring, ventilate drivers, and mount bars so they cannot fall. Do not enclose a power supply without checking its cooling requirements.
- **Never parallel the +24 V outputs of the 300 W and 400 W supplies.** If the design later uses multiple supplies, each positive bus must feed distinct strips; common data grounds may be needed. [WLED multi-supply guidance](https://kno.wled.ge/advanced/wiring/).
- Test maximum **RGB and white** brightness, temperature, voltage at the far end of each bar, voltage at the C3 and flicker. Set a venue brightness ceiling after tests. Avoid rapid full-room flashes by default and provide an immediate blackout button.

## Commissioning sequence

1. On delivery, record exact strip, PSU, C3 and room measurements; take photos of strip cut points, connector and PSU labels. The electronics box is **behind C1**; measure cable routes from there.
2. Build one 120 cm bar on the bench with a fused 24 V feed, controller, buffer, aluminium profile and diffuser.
3. Verify data direction, four color channels, addressable group count, current and thermal behaviour at full output for at least 30 minutes.
4. Fix the physical layout, cable routes, bar orientation and controller grouping. Have the mains/distribution design checked before ceiling/wall installation.
5. Install and label all nine bars. Test each one separately, then test all nine at maximum load.
6. Bring up WLED and LedFx; map the 3 × 3 grid; save basic fallback looks.
7. Route MacBook system audio into LedFx using [MAC_AUDIO_SETUP.md](MAC_AUDIO_SETUP.md); test with a YouTube video and local audio file. Later add estimated-BPM scene control with manual tap and phase correction. Calibrate lighting latency against a metronome in the room.

## Information still needed

- Close-up photos of the delivered strip cut marks/connector and each PSU's complete label; the order links and screenshot have been recorded, but seller detail pages were inaccessible to the available browser tools.
- Confirm how many of the 18 purchased ESP32-C3 SuperMini boards are physically available and photograph both sides of one board.
- Length of each cable route from the box behind C1; ceiling or wall mounting; any ambient light/smoke/haze.
- Whether the room speakers are connected by cable/USB interface or Bluetooth.
- Preferred control device for the operator and whether the lights must run unattended.

See [SCENES.md](SCENES.md) for the initial show language, [MAC_AUDIO_SETUP.md](MAC_AUDIO_SETUP.md) for MacBook audio routing, [ORDERED_PARTS.md](ORDERED_PARTS.md) for the purchase record, [WATCH_LIST.md](WATCH_LIST.md) for video tutorials, and [layout.json](layout.json) for stable bar IDs.
