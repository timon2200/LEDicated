# Studio Light — aplikacija za devet barova

Lokalna aplikacija za naš raspored 3×3, s bibliotekom pjesama, editabilnim showom, MacBook audio ulazom i pet WLED ESP32-C3 kontrolera. Softverska simulacija radi; konačna fizička instalacija još nije potvrđena.

## Pokretanje

Potreban je Node.js 20 ili noviji. Za samu aplikaciju nema npm paketa. Za lokalnu analizu uvezenih pjesama trebaju `ffmpeg` i `ffprobe` u `PATH`.

U ovoj mapi pokreni:

```sh
npm start
```

Otvori [Studio Light](http://127.0.0.1:8787). Server sluša samo lokalno. Početno je uključena simulacija: demo ritam, bez audio snimanja i bez slanja na trake. IP adrese kontrolera početno su prazne.

Na Macu možeš dvaput kliknuti `Start Studio Light.command` u ovoj mapi. Pokreće lokalni server i otvara sučelje kroz njegovu `--open` opciju. Node.js 20+ i dalje mora biti instaliran.

```sh
npm test
npm run build
```

`build` je provjera sintakse svih izvršnih modula. Browser koristi native JavaScript module, pa nije potreban bundler.

## Projekti pjesama i setovi

- MP3/WAV se povlači ili odabire u odjeljku **Projekti pjesama**. Najviše 100 lokalnih pjesama; sadržaj se deduplicira. Kopije, JSON projekti i kompaktne analize su u privatnoj mapi `app/data/` (izuzeta iz Git praćenja). Uvoz čuva najmanje 2 GiB slobodnog prostora. Probni `Sounds.mp3` je uvezen u biblioteku.
- `ffmpeg` dekodira pjesmu kroz tok bez trajnog WAV cachea. Analiza vraća waveform, procijenjeni tempo i beat mrežu te omotnice bubnjeva i basa. **Bubnjevi i bas su procjene frekvencijskih pojaseva, ne AI separirani stemovi.** Procjena za `Sounds.mp3` je 152 BPM i može zahtijevati ručnu korekciju.
- Odaberi pjesmu, reproduciraj, unesi točno vrijeme za scrub ili klikni/povuci playhead po waveformu. Play nastavlja od odabranog trenutka; lokalni audio endpoint podržava HTTP byte ranges za pouzdano traženje unutar MP3/WAV datoteke. Timeline zauzima cijelu širinu editora. Zoom kontrola, tipke −/+, Fit, pinch na MacBook trackpadu i dva prsta lijevo/desno upravljaju vremenskim prozorom. ⌥ + povuci pomiče timeline; Space pokreće/pauzira, strelice pomiču jedan kadar, Shift + strelice jednu sekundu. Beat snap koristi analiziranu mrežu. Kontrole imaju objašnjenja na hover i fokus. Slojevi imaju clipove, keyframeove, efekte, blend, odabir barova i audio drivere. Auto show stvara editabilan početni klupski raspored. Setovi čuvaju odabrane pjesme po redoslijedu označavanja.
- Audio svira na zadanom macOS izlazu; za Bluetooth u polje **Bluetooth pomak** unesi izmjereno odstupanje. Negativna vrijednost odgađa svjetlo. Kalibracijski klik/bljesak daje ručnu usporedbu, ne automatsko mjerenje. Svaki Bluetooth uređaj i način povezivanja treba izmjeriti zasebno.
- Jedna deterministička funkcija pretvara spremljeni timeline i vrijeme pjesme u finalni RGBW kadar. Taj isti kadar ide u WebGL2 preview i `/api/frame`; server i pregled koriste isti modul za preslikavanje broja i smjera adresabilnih grupa. Pregled crta svaku fizičku LED diodu zasebno (početno 72 po baru, 648 ukupno), a diode iste grupe dijele boju. Klik na bar otvara detaljni red dioda; hover nad diodom pokazuje njezinu poziciju, grupu i točne RGBW bajtove. Ako WebGL2 nije dostupan, koristi se Canvas 2D. Blackout i nulti master imaju prednost.

**Granice:** broj od 72 fizičke diode i 12 grupa po baru su procjene. U Postavkama se oba broja mogu unijeti odvojeno. Preview pokazuje iste numeričke RGBW vrijednosti kao izlaz, ali približnu boju i sjaj na monitoru; fotografska pozadina scene je dekorativna. Pravi RGBW redoslijed, bijeli kanal, struja, grupiranje i Bluetooth latencija čekaju fizičko mjerenje. Beat procjena nije jamstvo točne strukture pjesme. Aplikacija ne uključuje model za AI separaciju pravih stemova.

## Što radi

- Osam scena: Ambijent, Puls, Stupci, Redovi, Trkač, Zrcalo, Val i Gradnja. Trkač prati L1 → L2 → L3 → C1 → C2 → C3 → R1 → R2 → R3, svaki bar od vrha do dna.
- Pet zajedničkih paleta, master svjetline, energija i audio naglasak.
- Current / Next workflow: odaberi sljedeću scenu i pritisni GO. Promjena čeka sljedeći beat; prijelaz traje fiksno 0,6 s.
- Automatski slijed mijenja scene nakon 4, 8 ili 16 taktova. Početak takta operator postavlja ručno.
- TAP, ručni BPM, korekcija ½/2×, pomak faze i offset vremena.
- Procjena tempa iz audio onseta, confidence i HOLD prikaz. Ovo nije potvrđeno prepoznavanje pjesme, početka takta ili dropa.
- Freeze, Blackout i postavke stvarnog broja adresabilnih grupa/smjera svakog bara.

TAP i ručne korekcije isključuju automatski tempo kako procjena ne bi poništila operatorov izbor. Automatski tempo procjenjuje ponavljanje onseta; kod nestabilne glazbe treba ručna korekcija. Sadržaj poput govora i YouTube oglasa može proizvesti audio reakciju.

## MacBook i YouTube audio

Koristi [BlackHole](https://github.com/ExistentialAudio/BlackHole) kao virtualni ulaz. U macOS Audio MIDI Setup napravi Multi-Output Device sa zvučnicima/audio sučeljem i BlackHoleom te odaberi taj uređaj za reprodukciju. Potom u aplikaciji odaberi BlackHole i klikni **Spoji audio**. Browser će zatražiti dopuštenje za pristup audio ulazu.

Detaljniji postojeći vodič: [MAC_AUDIO_SETUP.md](../MAC_AUDIO_SETUP.md). Ondje je dio uputa pisan za LedFx; ova aplikacija koristi odabir ulaza u vlastitom sučelju.

Audio se obrađuje u browseru. Sirovi audio ne šalje se serveru ni vanjskom servisu. Lokalnom serveru šalju se samo renderirani svjetlosni frameovi. **Demo** stvara umjetni puls i ne snima mikrofon. Pravi YouTube/BlackHole test još je otvoreni commissioning korak.

## Arhitektura

```text
BlackHole / odabrani audio ulaz
        ↓
Browser: audio level + bas + onset procjena
        ↓
Zajednički beat clock + scene engine
        ↓
RGBW frame od 12 logičkih uzoraka po baru
        ├── zajednički mapping grupa → svaka fizička LED → WebGL2/Canvas pregled
        └── lokalni HTTP → server → isti mapping grupa → DDP RGBW/RGB UDP 4048
                                                     ↓
                                               5 WLED kontrolera
```

`engine.mjs` je zajednički deterministički renderer. `ui.mjs` obrađuje audio i upravlja prikazom; `server.mjs` sprema konfiguraciju i šalje DDP. Server sam ne izračunava nove efekte bez aktivnog browsera.

Vizualizacija i transport koriste isti izvorni frame te jednak resampling i reverse. Za svaku fizičku diodu pregled ponavlja boju pripadne adresabilne grupe; time ne izmišlja neovisnu kontrolu unutar grupe. Na ekranu se bijeli emiter aproksimira RGB bojom uz približnu monitor gamma korekciju 2,2; u RGBW transportu njegov se kanal šalje neovisno, a izlazni bajtovi ne dobivaju tu display korekciju. Pregled nije kalibrirana procjena fizičke boje ni svjetline u sobi. Engine trenutačno ima 12 uzoraka po baru; veći uneseni broj grupa duplicira uzorke, manji ih preslikava. To nije dodatna efektna rezolucija.

## Obvezni WLED mapping

Svaki kontroler prima jedan uzastopni DDP niz. **Redoslijed izlaza i duljina u WLED-u moraju odgovarati ovoj tablici.** Ne preslikavati proizvoljno prema fizičkoj udaljenosti.

| Kontroler | Prvi WLED izlaz: početak 0 | Drugi WLED izlaz: početak nakon prvog bara |
|---|---|---|
| C3-A | C1 | C2 |
| C3-B | L1 | L2 |
| C3-C | R1 | R2 |
| C3-D | L3 | C3 |
| C3-E | R3 | Nema |

Ako prvi bar ima 12 grupa, drugi počinje na logičkoj adresi 12. Ako ima drugi broj, početak drugog izlaza mora biti upravo taj broj. Unesi stvarnu adresabilnu gustoću nakon testa trake; 60 fizičkih LED-ova/m ne znači nužno 60 adresabilnih piksela/m. Default 12 grupa po 120 cm je pretpostavka.

U Postavkama unesi privatne IPv4 adrese svih pet kontrolera, spremi ih i tek zatim uključi izlaz. Postavke se spremaju u lokalni `config.json`. Aplikacija potvrđuje slanje UDP paketa, **ne potvrđuje prijem ni fizičko svjetlo**.

## RGBW i zaštita izlaza

Nova konfiguracija koristi **DDP RGBW**: četiri neovisna bajta R, G, B, W po adresabilnoj grupi, s DDP data type `0x1B`. W kanal se prenosi izravno. Podrška prijema RGBW potvrđena je u službenom kodu označenih WLED izdanja [v0.14.4](https://raw.githubusercontent.com/wled/WLED/v0.14.4/wled00/e131.cpp) i [v0.15.1](https://raw.githubusercontent.com/wled/WLED/v0.15.1/wled00/e131.cpp); za naš build odaberi v0.15.1 ili noviji firmware i provjeri ponašanje na konkretnoj pločici. v0.13.3 nema taj provjereni RGBW prijem.

U postavkama postoji **RGB fallback**. On pretvara W u aproksimaciju toplog RGB svjetla i šalje tri bajta po grupi; to nije neovisna kontrola fizičkog W emitera. Starija spremljena konfiguracija bez polja `transport` ostaje na RGB načinu radi kompatibilnosti; u postavkama izričito odaberi RGBW nakon provjere firmwarea.

Neovisno kodiranje W kanala sada je softverski podržano. Stvarni white-channel redoslijed WS2814 trake, kvaliteta bijele boje i postavka WLED auto-white još se moraju provjeriti na hardveru. Za RGBW način odaberi manual white handling koji čuva primljeni W; testiraj posebno crvenu, zelenu, plavu i čistu W vrijednost.

Ograničenje mastera na 60% i kanalni limit 153 su vizualni softverski limit. **Nisu zaštita od struje, pregrijavanja ili pogrešnog napajanja.** Projekt napajanja i osigurača ostaje zaseban.

Blackout isključuje slanje i pokušava poslati nule. Serverov watchdog nakon prekida frameova pokušava poslati nule; skrivena kartica također isključuje izlaz. UDP paket može biti izgubljen. WLED mora imati provjeren realtime timeout i siguran tamni fallback, uključujući scenarij pada servera ili gubitka mreže. To još nije provjereno na fizičkom hardveru.

## Rezultati i granice testiranja

Provjera 8. listopada 2026.: **47 automatiziranih testova prolazi**, uključujući HTTP tok pjesme, simulirani DDP RGBW izlaz, mapiranje fizičkih dioda i trackpad matematiku zooma/pomaka; syntax build prolazi. Novi UI vizualno je provjeren u ugrađenom pregledniku na 1512 px i 390/320 px bez horizontalnog prelijevanja. Ranija Chrome browser smoke provjera ostaje dokumentirana kao provjera baselinea od 26. rujna; ažurirani `browser-smoke.mjs` nije pokrenut u ovoj provjeri. Autoritativan broj prikazuje aktualni `npm test` izlaz.

Automatizirani testovi obuhvaćaju renderer, spatial scene mapping, granice vrijednosti, master/blackout, prijelaze, manual clock, sintetičke onsete, konfiguraciju i transport/watchdog. Sintetički onset testovi ne dokazuju cijeli audio → tempo pipeline na proizvoljnoj pjesmi.

Browser smoke provjerava devet barova, queue/GO, palete, nulti master i tijekom freezea, BPM, ručnu ½ korekciju, freeze, blackout, odbijanje izlaza bez IP adresa, odsutnost runtime grešaka i širine 1440/1024/736/390/320 px. Interaktivna vizualizacija također je provjerena na različitim širinama.

Poseban browser audio test provodi umjetni PCM signal od 120 BPM kroz capture → FFT/RMS → onsete → procjenu tempa. Zabilježena procjena bila je **120,9 BPM**, a START/STOP su prošli bez runtime grešaka. Koristi browserov lažni audio uređaj, bez pristupa stvarnom mikrofonu. To potvrđuje integraciju audio pipelinea na tom signalu; pravi YouTube sadržaj i macOS/BlackHole routing još nisu testirani.

Za dodatni browser smoke potrebno je pokrenuti server i imati Playwright razvojni paket te Chrome:

```sh
npm install --no-save playwright
BROWSER_CHANNEL=chrome node browser-smoke.mjs
BROWSER_CHANNEL=chrome node browser-audio.mjs
```

Ako Playwright već postoji u zajedničkom razvojnom okruženju, `PLAYWRIGHT_MODULE` može sadržavati njegovu apsolutnu putanju. To je opcionalni testni alat; aplikacija ga ne treba za rad.

## Fizički commissioning prije konačne instalacije

1. Na jednoj traci potvrditi cut marks, adresabilne grupe i red/green/blue/white test.
2. Potvrditi stvarni WLED firmware, dva C3 izlaza, redoslijed kanala i white-channel ponašanje.
3. Izmjeriti potrošnju i pad napona; završiti kablove, osigurače, uzemljenje i ventilaciju kutije.
4. Za svaki bar testirati oznaku, smjer, početnu adresu i ukupni broj grupa.
5. Testirati BlackHole uz YouTube, pause, govor, oglase i promjenu audio uređaja.
6. Izmjeriti offset latencije uz stvarne zvučnike; provjeriti manual TAP i auto procjenu na više stilova glazbe.
7. Isključiti Wi-Fi, ugasiti server i zatvoriti browser; provjeriti stvarni WLED tamni fallback.
8. Testirati svih devet barova najmanje sat vremena i pratiti temperaturu, stabilnost mreže i frameove.

Do prolaska tih koraka status je **softverski testirano; fizička instalacija i audio sinkronizacija čekaju provjeru**.

MADRIX usporedba i službeni izvori: [MADRIX_RESEARCH.md](../MADRIX_RESEARCH.md).

## DAW radni prostor

`index.html` otvara FL-Studio-like sučelje (`daw.mjs`, `daw.css`, `daw-*.mjs`): playlist s trakama, alati (crtaj/odaberi/siječi/briši), obvojnice keyframeova, parametarski EQ audio driver, 3×3 birač barova, mikser, live i output dock, browser pjesama/efekata/auto showa, undo/redo, autosave. Pomoć: tipka `?`. Staro sučelje ostaje na `/classic.html`.

### Live board za izvedbu

Gumb **LIVE BOARD** ili tipka `P` otvara izvedbeni panel. Mreža ima 12 jednakih kvadratnih mjesta s tipkama `Q W E R / A S D F / Z X C V`; četiri su početno prazna. Te tipke pokreću padove iz bilo kojeg panela, čak i dok je fokus na klizaču ili polju postavki, bez promjene odabranog pada u editoru. Gornji gumb Live Boarda pokazuje broj aktivnih efekata i kad je otvoren drugi panel. Ikona ✦ označuje **Udar**, a ↻ **Petlju**. Kratki pritisak Udar svira jednom; držanje ga neprekidno ponavlja do otpuštanja. Kratki pritisak Petlje pali ili gasi efekt; držanje je trenutno i gasi ga pri otpuštanju. Isto vrijedi za miš i tipkovnicu, uz vidljivo stanje pritisnutog pada. Način se bira istaknutim prekidačem na vrhu editora. **Stop FX** gasi izvedbene efekte, dok **Esc / BLACKOUT** gasi i izlaz te čisti padove. Padovi se dodaju preko spremljenog showa, ali ne mijenjaju njegov timeline. Njihove postavke spremaju se lokalno u browseru. Efekt se može povući iz kataloga na bilo koje mjesto ili se odabrano mjesto može popuniti klikom na efekt u katalogu. Za premještanje primi neobrubljenu ručicu sa šest točaka u kutu pada: cijeli pad slijedi pokazivač. Spuštanje na zauzeto mjesto animirano zamjenjuje padove, a na prazno ih premješta. Ručica prima i strelice tipkovnice.

Editor prikazuje **3 × 3 izbor devet barova** za svaki pad zasebno, s brzim odabirom lijeve, srednje i desne strane, križa i ruba. Šest većih tipki zona uvijek stoji u mreži 3 × 2, a odabir zone ne obnavlja cijeli editor ni ne pomiče ostale kontrole. Svi izbori u Live editoru su izravne tipke; izbor efekta je vizualna paleta, a izbor boje je paleta s potenciometrom nijanse i klizačima zasićenosti i svjetline, bez sistemskog prozora za boju ili padajućih izbornika. Tipka **Dupliciraj u prazno** kopira efekt za drugu zonu; **Isprazni polje** stvara slobodno mjesto. Svih 16 efekata ima namjenski opis i vlastite kontrole. Trkač ima smjer, jedan prolaz ili više sinkronih putanja, oblik zrake, ponašanje ugašenih barova, ritmički korak, sjaj i duljinu putanje pri udaru. Spirala ima smjer, rep, središte, preskakanje ugašenih barova i duljinu rotacije. Ostali efekti imaju odgovarajuće oblike, rasporede i prijelaze. Svaki pad ima zasebne RGBW boje, jačinu i brzinu preko tri izvedbena potenciometra. Petlje mogu pratiti lokalno analizirane bubnjeve, bas, vokal, ostalo ili podesivi frekvencijski pojas; audio driver koristi poziciju pjesme, dok se animacija pokreće po live satu.

Waveform i dionice ostaju na postojećem timelineu iznad; Live Board ih ne duplicira. Sažeta traka pokazuje trenutnu i sljedeću dionicu, odbrojavanje, sugeriranu tipku i indikator beata. Tipke **4 takta**, **8 taktova** i **Dionica** brzo postavljaju petlju. **Beat sync** priprema novi pad za sljedeći beat iz analizirane ili ručno postavljene mreže; pri pauzi se neodigrana naredba otkazuje. Razdjelnici glavnog radnog prostora i razdjelnik između boarda i kontrola mogu se povlačiti, uz tipke strelica za fino namještanje. Na uskim širinama board i kontrole se slažu vertikalno, a katalog se privremeno skriva kako bi board i pozornica ostali čitljivi; ponovno se pojavljuje izlaskom iz Live boarda ili širenjem prozora.

Izvedbeni efekti koriste isti završni RGBW renderer i postojeći master, preview, Bluetooth pomak, izlaz i blackout. Simulacijski testovi potvrđuju deterministički overlay i ograničenja kanala; stvarna latencija Bluetootha i ponašanje fizičkih RGBW traka i dalje čekaju opremu i mjerenje.

### Parametarski EQ audio driver i spektrogram (`audio-spectrum.mjs`, `daw-driver.mjs`)
- **Vizualni kontroler (Maxon-style):** Logaritamski spektrogram u stvarnom vremenu (25 Hz – 18 kHz, 96 pojasa, FFT s +3 dB/oktavi tiltom).
- **Interaktivni pravokutnik:** Povlačenje po spektru postavlja donju i gornju frekvenciju (`lowHz`, `highHz`), donji rub određuje prag okidanja (`threshold`), a gornji punu jačinu (`ceiling`).
- **Načini rada:** `Prati razinu` (dinamičko praćenje amplitude) ili `Okidač / Gate` (skok na 100% kad signal prijeđe prag, uz podesivo ispuštanje `releaseSec`).
- **Prikaz kroz clip:** Tri usporedne krivulje kroz cijelo trajanje clipa — razina odabranog frekvencijskog pojasa, izlaz drivera i konačni rezultat (obvojnica × driver).
- **Auto prag i brzi predlošci:** Kick (40–110 Hz), Bas (30–180 Hz), Snare (160–400 Hz), Vokal, Hi-hat i Sve, plus gumb `Auto prag` koji računa prag iz stvarne dinamike clipa.
- **Jačina drivera:** Klizač 0–200% za pojačavanje ili stišavanje utjecaja glazbe.

### Odabir barova (3 × 3 raspored)
- **Prostorni raspored:** Mreža odgovara stvarnom rasporedu na stageu (`L1 C1 R1 / L2 C2 R2 / L3 C3 R3`).
- **Brzi odabir:** Zaglavlja za stupce (`L`, `C`, `R`) i redove (`1`, `2`, `3`), kutni gumb `svi`. Shift dodaje u postojeći odabir.
- **Bojanje:** Prelazak mišem s pritisnutom tipkom preko barova pali ili gasi barove u nizu.
- **Geometrijski predlošci:** Svi, Obrni, Sredina, Kutovi, Križ, Šahovnica, Lijevo-desno.

### Izolacija za uštimavanje (gornja traka docka)
- **Solo clip:** Svijetli isključivo odabrani clip na simulaciji i fizičkom izlazu, bez utjecaja ostalih slojeva.
- **Bez drivera (Bypass):** Privremeno gasi audio reaktivnost radi provjere same animacije i obvojnice.
- **Petlja clip:** Postavlja petlju točno na granice clipa i pokreće reprodukciju za fino podešavanje.

### Položaj i trajanje clipa
- Jasno razdvojeni pojmovi: **Počinje** (trenutak u pjesmi u sekundama i taktovima/dobima gdje clip kreće) i **Traje** (trajanje aktivnosti u sekundama, dobima i taktovima).
- Vizualna traka položaja unutar cijele duljine pjesme.
- Brze tipke za trajanje: 1 beat, 1, 2, 4, 8, 16 taktova te do kraja pjesme.

### Stemovi i analiza strukture pjesme (`audio-analysis.mjs`, `audio-sections.mjs`)
- **4 frekvencijska stema:** Zasebna ekstrakcija i prikaz energije za bubnjeve (kick/snare pojas), bas, vokalni pojas i ostale visoke instrumente. Prikazani su u 4 obojene mikro-trake neposredno ispod glavnog valnog oblika (narančasta, ljubičasta, cijan, zelena).
- **Makro dionice pjesme (Sections):** Automatska detekcija strukture pjesme na temelju RMS dinamike, ritmičkog uzorka i glazbenih fraza od 8/16 taktova. Prepoznaje dionice: `Uvod (Intro)`, `Strofa (Verse)`, `Gradnja (Build)`, `Drop`, `Predah (Breakdown)` i `Kraj (Outro)`.
- **Prikaz na ravnalu:** Dionice su prikazane kao obojeni bedževi s nazivom i trajanjem izravno na ravnalu.
- **Interakcija s dionicama:** Klik na dionicu postavlja playhead i petlju (loop) točno na tu dionicu. Desni klik otvara izbornik za odabir svih clipova unutar dionice ili dodavanje novog clipa preko cijele dionice.
- **Strukturni auto show (5 slojeva):** Generator auto showa koristi detektirane dionice pjesme te postavlja dinamične, slojevite efekte kroz 5 namjenskih traka (`Atmosfera`, `Sub i bas`, `Sint i vokal`, `Ritam i kretanje`, `Akcenti i stroboskop`). Uključuje udare stroboskopa s punim bijelim (W) kanalom na dropovima i pre-drop rolama, rotirajuće spirale na perimetru, usmjerene zrake i vokalne reflektore na centru C2 te organsku vatru i valove.

### 16 efekata i preseta (`timeline.mjs`, `daw-editor.mjs`, `daw-browser.mjs`)
- **Proširena paleta efekata (16 ukupno):**
  1. `Wash` (≋) — mirna pozadina koja diše preko svih barova
  2. `Puls` (◉) — svi barovi pulsiraju na beat
  3. `Stupci` (▥) — stupac po stupac na svakom beatu
  4. `Trkač` (➤) — svjetlo putuje kroz svih devet barova
  5. `Flash` (✦) — jaki naglasak s fokusom u sredini
  6. `Val` (∿) — prostorni val kroz cijelu sobu
  7. `Stroboskop` (⚡) — brzi oštri bljeskovi za dropove i vrhunce
  8. `Iskre` (✧) — nasumične svjetlucave iskre na višim frekvencijama
  9. `Spirala` (◎) — kružna rotacija svjetla po vanjskim barovima
  10. `Valići` (≈) — koncentrični valovi iz središta C2 prema van
  11. `Kiša` (⤓) — kapi svjetla koje padaju odozgo prema dolje
  12. `Odskok` (⇅) — vertikalni odskok svjetla gore-dolje
  13. `Vatra` (🔥) — organski plameni uzorak s titranjem
  14. `Izmjena` (⇋) — naizmjenično titranje parnih i neparnih barova
  15. `Središte` (⊕) — fokusirana radijalna eksplozija iz centra C2
  16. `Zamah` (◫) — horizontalni radarski zamašaj slijeva nadesno
- Svi efekti su dostupni u pregledniku (mogu se povući u traku), u editoru clipa i u generatoru auto showa.

### Provjera i status
- Testovi: `npm test` pokreće **99 testova** (renderer, 16 preseta, stemovi, detekcija dionica, spektrogram, band driver, live padovi, odvojene zone Flasheva, putanja Trkača, preskakanje ugašenih barova, audio driver petlje, state operacije, DDP transport).
- Build: `npm run build` provjerava sintaksu izvršnih modula, uključujući Live board.
- Postojeći smoke test `daw-smoke.mjs` provjerava DAW alate. Live board je dodatno ručno provjeren u lokalnom browseru na širokoj i uskoj širini: tipkovni pad, preview, blackout, jednake dimenzije svih 12 mjesta, premještanje i zamjena, dodavanje efekta iz kataloga, zasebni 3 × 3 odabiri za dva Flasha, kopiranje, kontrole Trkača, audio driver petlje i razdjelnici. Automatizirani browser smoke za novi panel još nije dodan.
- Fizičke provjere i dalje čekaju opremu: RGBW redoslijed WS2814 traka, snaga, Bluetooth sinkronizacija, stvarni broj LED-ica/grupa po baru.
