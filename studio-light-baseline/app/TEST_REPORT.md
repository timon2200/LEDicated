# Studio Light — provjera softvera

Datum: 26. rujna 2026. Okruženje: macOS, Node.js 24.21.0, izolirani Chrome preglednik.

**Ukupno 26/26 automatiziranih testova prolazi.**

## Provedene provjere

| Provjera | Rezultat | Što potvrđuje |
|---|---|---|
| `npm run build` | Prolazi | Sintaksa izvršnih modula; native module aplikacija ne treba zasebno bundlanje |
| Engine testovi | 19 prolazi | Osam scena, pet paleta, deterministički frameovi, mapiranje, fade/master, blackout, clock/TAP i sintetički onseti |
| Lokalni server i UDP testovi | 7 prolazi | Pet simuliranih kontrolera, sadržaj stvarnih RGB/RGBW UDP paketa i zaseban bijeli kanal, mapiranje, smjer, konfiguracija, ograničenje FPS-a i watchdog |
| `browser-smoke.mjs` | Prolazi | Devet barova, GO, palete, master i tijekom freezea, BPM, ručna ½ korekcija, blackout i validacija uključivanja izlaza |
| Raspored ekrana | Prolazi | Širine 1440, 1024, 736, 390 i 320 px bez horizontalnog prelijevanja |
| `browser-audio.mjs` | Prolazi | Sintetički PCM signal 120 BPM kroz browser capture, FFT/RMS, onset procjenu i UI: izmjereno 120,9 BPM; start/stop audio ulaza |
| `visual-smoke.mjs` | Prolazi | Interaktivni pregled razgovora: scena, paleta, beat korak, blackout, uski ekran, bez runtime grešaka |

Audio test koristi umjetni audio uređaj izoliranog preglednika. Ne pristupa stvarnom mikrofonu i ne potvrđuje macOS BlackHole routing. Testovi transporta koriste stvarni lokalni UDP prijemnik; ne potvrđuju fizički ESP32/WLED prijem.

## Uočeno i popravljeno

- Trkač prolazi cijelim stupcem L1 → L2 → L3 prije srednjeg i desnog stupca; svih 108 uzastopnih pozicija potvrđeno testom.

- UI modul u server allowlistu i build provjeri usklađen na `ui.mjs`.
- Prvi frame nakon uključivanja izlaza može se poslati odmah; sljedeći frameovi poštuju limit.
- Master odmah smanjuje oba izvora tijekom crossfadea.
- Master i blackout odmah djeluju i tijekom zamrznutog izlaza.
- Ručna korekcija ½/2× isključuje auto procjenu kako se izbor ne bi poništio.
- Početno zaključavanje auto tempa poravnava fazu s detektiranim onsetom; početak glazbenog takta ostaje ručan.
- Pregled koristi isti resampling i reverse mapping kao transport. Gamma i prikaz bijelog kanala služe približnom prikazu na monitoru.

## Preostalo za fizičko odobrenje

Stvarni broj adresabilnih grupa, GPIO i firmware C3 pločica, WLED redoslijed kanala, izgled bijelog emitera, potrošnja i pad napona, zaštita napajanja, YouTube/BlackHole audio, latencija zvučnika, mrežni prekidi i sat rada svih devet barova.

Status: **softver pokretljiv i testiran, spreman za prvi kontrolirani test hardvera**. Konačna montaža još nije odobrena testom fizičkog sustava.
# Provjera 8. listopada 2026. (popodne — DAW studio i parametarski audio driver)

- `npm test`: **66/66** prolazi (renderer, logaritamski spektrogram, frekvencijski band driver, praćenje/gate, obvojnice, beat grid, state operacije i DDP UDP transport).
- `npm run build`: sintaksa svih 22 izvršna ES modula prolazi (`node --check`).
- `daw-smoke.mjs`: Playwright provjera prolazi (`DAW smoke OK`) — crtanje, odabir, sječenje, brisanje, 3×3 birač barova s uzorcima, parametarski EQ spektrogram s povlačenjem pojasa, Kick/Bas predlošci, obvojnica s dvoklikom, Solo clip / Bypass izolacija, mikser, live i output dockovi.
- Fizički WLED, boje RGBW trake, električna potrošnja i Bluetooth sinkronizacija i dalje čekaju isporuku opreme.

