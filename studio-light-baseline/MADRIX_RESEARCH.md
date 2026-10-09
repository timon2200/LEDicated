# MADRIX istraživanje i primjena na Studio Varaždin

Provjereno 26. rujna 2026. Izvori su službena MADRIX stranica i HTML priručnik MADRIX 5.8. Ni jedna slika, ikona, brand asset ni proprietary implementation nije preuzeta. Tablica opisuje MADRIX; odjeljak s prijedlogom opisuje naš vlastiti proizvod.

## Provjerene činjenice

| Područje | MADRIX ponašanje | Službeni izvor |
|---|---|---|
| Pregledi | Dva izvora efekata, Deck A/B, i treći pregled stvarnog izlaza. Pregledi su tehnički prikaz piksela, ne fotorealistična soba. | [3 Previews](https://help.madrix.com/m5/html/madrix/hidd_user_interface_preview_window.html) |
| Prijelazi | Ručni i automatski crossfader s trajanjem i vrstom prijelaza. Obični crossfade interpolira boje A/B. | [Crossfader](https://help.madrix.com/m5/html/madrix/hidd_user_interface_fade_array.html) |
| Efekti | SCE radi bez audio ulaza; S2L reagira na audio; M2L analizira glazbene parametre; TRI koristi okidanje; MAS je vlastiti kod. Svaki efekt ima svoje parametre i zajedničke kontrole sloja. | [Effects](https://help.madrix.com/m5/html/madrix/hidd_effects_link.html), [Effect Areas](https://help.madrix.com/m5/html/madrix/hidd_user_interface_effect_area_.html) |
| Slojevi | Efekti se kombiniraju; slojevi imaju opacity, solo i blind. Broj slojeva praktično ograničava računalo. | [Layers](https://help.madrix.com/m5/html/madrix/hidd_user_interface_layer_array_.html) |
| Palete | Globalne boje, liste i gradijenti dijele se među efektima. Promjena globalne boje ažurira reference. Podržana su četiri kanala RGBW. | [Global Colors](https://help.madrix.com/m5/html/madrix/hidd_color_selection.html) |
| Mapping | Patch opisuje vrste, broj i položaj uređaja; pregledi predstavljaju isti patch. | [Patch Editor](https://help.madrix.com/m5/html/madrix/hidd_preferences_patch.html) |
| Cue liste | Slijed spremljenih efekata s trajanjem, prijelazima i time codeom; prethodni/sljedeći cue i pauza. Live master i blackout ostaju dostupni. | [Cue List Editor](https://help.madrix.com/m5/html/madrix/hidd_cue_list_.html) |
| Live kontrola | Master, blackout, freeze, audio gain/AGC, intenzitet decka, filter boje i multiplikator brzine. | [Master / Audio](https://help.madrix.com/m5/html/madrix/hidd_gui_levels.html), [Deck Controls](https://help.madrix.com/m5/html/madrix/speed_master.html) |
| Audio analiza | Osjetljivost, threshold i čišćenje signala. Veći prozor analize daje više podataka i kašnjenja. Postavke ovise o glazbi. | [Audio And Sound](https://help.madrix.com/m5/html/madrix/hidd_before_start_audio_input_configuration.html) |
| BPM | BPM je brzina efekta. TAP računa tempo nakon najmanje četiri klika. Različiti efekti mogu drukčije tumačiti BPM. | [Using BPM Control](https://help.madrix.com/m5/html/madrix/hidd_bpm.html) |

Dokumentacija pregledana u ovom istraživanju **ne potvrđuje univerzalno pouzdan automatski BPM/downbeat detektor za svaki YouTube sadržaj**. Audio reakcija, brzina efekta i stabilan beat clock odvojene su funkcije.

MADRIX 5 trenutno je Windows 11 softver; naš MacBook proizvod treba vlastiti engine. [Službena stranica](https://www.madrix.com/products/madrix-5)

## Naš prijedlog za devet barova

Ovo su odluke i preporuke za našu aplikaciju, ne tvrdnje o funkcijama MADRIX-a.

### Jedan ekran

- Veliki centralni pregled devet vertikalnih barova A1–C3 u stvarnom 3×3 rasporedu.
- Lijevo scene s malim pregledom; desno samo parametri odabrane scene.
- Gore audio izvor, audio level, BPM, confidence i TAP / Auto / Manual.
- Dolje master, automatski show, Next, Freeze i jasno izdvojen Blackout.
- U Settings: WLED adrese, stvarne adresabilne grupe po baru, reverse, bijeli kanal, FPS i izmjereni offset latencije.

### Pojednostavljen workflow

1. Preview i fizički output koriste isti renderirani frame.
2. Current / Next umjesto punog Deck A/B sučelja. Korisnik odabere scenu i GO; engine interno radi dva render izvora.
3. Dva sloja: osnovni izgled i audio accent. Nema neograničenog layer editora.
4. Zajedničke RGBW palete: Amber, Ice, Magenta, Red, Clean White.
5. Cue lista: scena, trajanje u taktovima, prijelaz u beatovima. Za nepoznate YouTube pjesme nema timelinea vezanog uz sekunde pjesme.
6. Operator način za live show; Edit otkriva mapping i parametre.

### Predložene scene

- Ambient: mirna paleta i sporo disanje.
- Bass Pulse: pulsiraju cijeli raspored ili redovi.
- Column Chase: lijevo → sredina → desno iz zajedničkog clocka.
- Vertical Runner: putujuća grupa po baru s trailom.
- Mirror: zrcalno kretanje vanjskih stupaca.
- Wave: zajednički prostorni val.
- Build: rast energije na granicama takta.
- Drop: naglasak i povratak na bazu; ručno ili iz provjerenog događaja.

### Audio i ritam

MacBook loopback ulaz prenosi audio reprodukcije aplikaciji uz istodobni izlaz na zvučnike. Mikrofon je fallback, a ne poželjan glavni ulaz.

`Audio capture → FFT/RMS/onsets → tempo estimate + confidence → clock → scene/layers → RGBW frame → preview + output`

Amplitude bass/mid/high pojasa treba odvojiti od beat clocka. Auto tempo treba smoothing, obradu half/double tempa i minimalni confidence. Pri lošem signalu: zadržati posljednji stabilni tempo, prikazati HOLD i ponuditi TAP/manual. Promjene scena čekaju sljedeći beat; cue promjene mogu čekati 4/8/16 taktova. Pouzdan početak takta ne obećavati bez testiranja.

## Kriteriji spremnosti

- Mapping: svaka stvarna adresabilna grupa pripada jednom baru, reverse radi.
- Preview/output: isti frame, master, bijeli kanal i blackout.
- Crossfade: poznate krajnje vrijednosti, nema skoka svjetline.
- Clock: synthetic click track 90/120/140 BPM, silence i half/double slučajevi.
- Quantization: promjene i cue trajanja koriste isti clock.
- Disconnect: status i fallback bez rušenja.
- RGBW: test stvarnog redoslijeda kanala i WLED bijelog kanala.
- Audio: YouTube pause, govor, oglasi, promjena uređaja.
- Latencija: izmjeren offset s konkretnim zvučnicima i mrežom.
- Soak: najmanje sat svih devet fizičkih barova.

Softverski testovi i demonstracija mogu se završiti prije hardvera. Potvrda fizičke spremnosti traži stvarne trake, izmjerenu adresabilnu gustoću, napajanje i svih devet izlaza. Browser sam ne šalje UDP WLED frameove; potrebno je lokalno companion/backend rješenje ili drugi provjereni transport.
