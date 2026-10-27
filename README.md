# LEDicated – High-Performance DAW-Grade LED Light Show Controller

Modularna macOS / cross-platform aplikacija za profesionalnu kontrolu 3×3 RGBW LED matrice (9 barova × 12 adresabilnih grupa = 108 RGBW piksela / 648 fizičkih dioda), s lokalnom analizom 4 stema, višekanalnim timelineom, WebGL2 3×3 simulatorom, dijeljenjem showova i višekorisničkim LAN radom u uredu.

---

## Brzi početak (Quick Start za kloniranje i programiranje doma)

Aplikacija nema vanjskih `npm` ovisnosti (čisti Node.js `>= 20` + nativni ES moduli) i radi odmah nakon kloniranja — čak i kad nemaš fizičke LED barove spojene (u **SIMULACIJA** načinu rada s punim 3×3 WebGL2 prikazom).

```bash
git clone https://github.com/timon2200/LEDicated.git
cd LEDicated
npm start
```

Nakon pokretanja otvori **[http://127.0.0.1:8787](http://127.0.0.1:8787)** u pregledniku (ili pokreni `npm run open` na macOS-u).

- **Preduvjeti:** Node.js `>= 20` i `ffmpeg` (za dekodiranje MP3/M4A/FLAC pri uvozu; na macOS-u `brew install ffmpeg`, opcijski `brew install yt-dlp` za automatsko preuzimanje audia iz dijeljenih Git showova).
- **Provjera i testovi:** `npm run build && npm test`

---

## Kako programirati pjesme i showove

1. **Uvoz glazbe ili gotovih showova:**
   - Povuci bilo koju `.mp3`, `.wav`, `.m4a` ili `.flac` datoteku izravno u prozor preglednika.
   - Aplikacija lokalno izračunava **BPM**, **4 frekvencijska stema** (`drums`, `bass`, `vocals`, `other`), **dionice pjesme** (Intro, Verse, Buildup, Drop, Breakdown, Outro) i generira klupski **Auto Show**.
   - Za pregled već pripremljenih showova iz Git repozitorija klikni **Galerija & Launcher (`⌘O`) → 🌐 Dijeljeni showovi (Git)** i klikni **📥 Preuzmi pjesmu + show** ili **✦ Učitaj / Sinkroniziraj show**.
2. **Uređivanje na vremenskoj traci (Timeline):**
   - Alati: `1` Crtaj, `2` Odaberi, `3` Podijeli (Slice), `4` Briši.
   - Svaki clip može ciljati bilo koju kombinaciju 3×3 barova (`L1 C1 R1 / L2 C2 R2 / L3 C3 R3`), koristiti jedan od 16 efekata (`pulse`, `chase`, `sweep`, `strobe`, `flash`, `wash`, `sparkle`, `wave`, `ripple`, `rain`, `spiral`, `fire`, `columns`, `bounce`, `alternate`, `center`) i biti vođen audio stemom (`drums`, `bass`, `vocals`, `other`, `band`).
3. **Live Performance Board (`P`):**
   - Tipke `Q W E R / A S D F / Z X C V` okidaju live efekte u stvarnom vremenu, a `⇧R` snima tvoju izvedbu izravno u clipove na vremenskoj traci.

---

## Dijeljenje pjesama i showova među prijateljima

Klikni gumb **🌐 LAN** u gornjoj traci (ili `•••` na bilo kojoj pjesmi u katalogu):

1. **📦 `.ledpack` paket (Sve u 1 datoteci — Audio + Analiza + Show):**
   - Klikni **📦 Izvezi .ledpack (Pjesma + Show)**.
   - Dobivaš jednu prijenosnu `.ledpack` datoteku koju možeš poslati preko Slacka, Discorda, WhatsAppa ili AirDropa.
   - Prijatelj samo povuče `.ledpack` u svoj LEDicated prozor i odmah dobiva audio, analizu i tvoj programirani show.
2. **🌐 Git `shared-shows/` (`.ledshow.json`):**
   - Klikni **🌐 Spremi u Git (shared-shows)** — show i analiza spremaju se u `studio-light-baseline/app/shared-shows/<Naziv>.ledshow.json` (bez velikih audio datoteka).
   - Napravi `git add studio-light-baseline/app/shared-shows && git commit -m "Add show" && git push` kako bi svi prijatelji dobili tvoj show u **Galerija & Launcher → 🌐 Dijeljeni showovi (Git)**.
3. **🚀 Izravni LAN Push / Pull (od laptopa do laptopa u uredu):**
   - Kad dođeš u ured s vlastitim laptopom na kojem si doma programirao showove, otvori **🌐 LAN**, upiši LAN adresu uredskog Maca (npr. `http://192.168.1.50:8787`) i klikni **🚀 Pošalji aktivnu pjesmu + show na uredski LAN** (ili **📥 Dohvati katalog s drugog LAN uređaja**).

---

## Više ljudi u uredu na istom LAN-u (Multi-User LAN & Stage Handover)

Kad ste u uredu na istom Wi-Fi / LAN-u, poslužitelj automatski sluša na svim lokalnim mrežnim sučeljima (`0.0.0.0:8787`), ispisuje LAN adresu u terminalu (npr. `http://192.168.1.50:8787`) i sinkronizira stanje s drugim pokrenutim laptopima preko UDP LAN koordinatora (`lan-coordinator.mjs`, port `4049`).

- **Polite Handover — Stage Owner (`🟢 ON AIR`) vs. Solo Preview (`🎧 SOLO`):**
  - Kako se DDP UDP paketi prema fizičkim WLED kontrolerima nikada ne bi sudarali kad više ljudi ima otvoren DAW ili YouTube ekstenziju, uvijek **točno jedan korisnik drži Stage (`🟢 ON AIR`)**.
  - **Automatsko preuzimanje kad je Stage slobodan (`⚪ SLOBODAN`):** Prvi korisnik koji pritisne **Play** u DAW-u ili pokrene YouTube video s uključenim Light Showom automatski preuzima Stage.
  - **Zaštita aktivnog DJ-a (`🎧 SOLO`):** Dok netko već pušta glazbu (`🟢 ON AIR`), svi ostali koji pritisnu Play ostaju u **`🎧 SOLO PREVIEW`** modu — čuju glazbu i vide puni 3×3 WebGL2 simulator na svom ekranu bez prekidanja rasvjete na fizičkom zidu.
  - **Automatsko otpuštanje nakon 20s pauze (`🟡 PAUZA`):** Kad aktivni DJ pauzira glazbu, Stage mu čuva rezervaciju 20 sekundi (uz odbrojavanje uživo), a zatim se automatski oslobađa u `⚪ SLOBODAN` kako bi sljedeća osoba mogla preuzeti zid čim stisne Play.
  - **1-Click Preuzimanje (`⚡ Preuzmi Stage`) i Prepuštanje (`Prepusti Stage`):** Na desnom **Stage** panelu (i u YouTube ekstenziji) nalazi se **Now Playing** traka uživo koja prikazuje tko je na stageu, izvor (`🎹 DAW` ili `🎬 YouTube`), naziv pjesme/videa, vremenski kod i gumb za trenutno preuzimanje ili prepuštanje kontrole.
- **Zajedničko uređivanje uživo (Live Timeline Sync):**
  - U prozoru **🌐 LAN** (ili klikom na **🎵 Otvori** na Stage traci) vidiš tko je sve spojen na mrežu i koju pjesmu trenutno uređuje ili pušta. Klikom na **Otvori istu pjesmu** promjene na timelineu sinkroniziraju se uživo između vaših preglednika.

---

## YouTube Chrome Ekstenzija (`chrome-extension/`)

Repozitorij sadrži i Chrome ekstenziju (**YouTube Plus Downloader + LEDicated Live Light Show Bridge**) u mapi [`chrome-extension/`](chrome-extension/).

### Instalacija u Chrome / Brave / Arc:
1. Otvori `chrome://extensions/` u pregledniku.
2. Uključi **Developer mode** (gornji desni kut).
3. Klikni **Load unpacked** i odaberi mapu `chrome-extension/` iz kloniranog repozitorija.

### Što sve radi na YouTubeu:
- Na svakom YouTube videu pojavljuje se gumb **Light Show** (uz **Download**).
- **Automatska sinkronizacija s Git showovima:** Ako je pjesma već u lokalnoj bazi ili u `studio-light-baseline/app/shared-shows/` (22+ gotovih showova u Gitu), ekstenzija se odmah prebacuje u **Sync · ON (`Sinkronizirano s bazom`)** i vrti točan programirani timeline u savršenoj sinkronizaciji s YouTube videom!
- **Uživo 4-Stem Stream (20 Hz):** Za bilo koji drugi YouTube video ekstenzija u stvarnom vremenu izvlači 4 frekvencijska stema (`bass`, `drums`, `vocals`, `other`) izravno iz YouTube playera bez gašenja zvuka i šalje ih u LEDicated Studio.
- **1-Click Kreiranje Showa s YouTubea:** Klikom na **Dodaj pjesmu i kreiraj Show** poslužitelj u pozadini preuzima audio (`yt-dlp`), analizira stemove i generira kompletan timeline show.
- **Lokalno ili Uredski LAN:** U popoveru ekstenzije pod **LEDicated Server (Lokalno ili Ured LAN)** možeš ostaviti `http://127.0.0.1:8787` kad radiš doma ili upisati IP adresu uredskog Maca (npr. `http://192.168.1.50:8787`) kad u uredu puštaš YouTube izravno na fizički 3×3 zid.

---

## Pregled Faze 1 (Istraživanje i Arhitektura)

Cjeloviti nacrt istraživanja i arhitekture dostupan je u [LEDICATED_RESEARCH_BLUEPRINT.md](LEDICATED_RESEARCH_BLUEPRINT.md).

### Ključne komponente sustava:
1. **Desktop Shell:** Tauri v2 (Rust jezgra + React 19 UI) – nativna macOS prozirnost (Apple Glass), jitter < 0.5ms.
2. **Timeline Engine:** 4-slojni HTML5 Canvas 2D s LoD Peak piramidom za instantno skrabanje i snap na BPM/barove.
3. **LED Preview:** WebGL2 / Custom shader za fotorealistični prikaz svake pojedine diode, radijalne difuzije i blooma.
4. **AI Stem Cjevovod:** HTDemucs v4 (ONNX / Metal) za automatsku separaciju na Bubnjeve, Bas, Vokale i Melodiju.
5. **Compositor & Shaders:** Jinx! / Photoshop modovi stapanja slojeva (Add, Screen, Multiply, Stencil) + Pixelblaze normalizirani shaderi $(x,y,z \in [0.0, 1.0])$.
6. **Hardverski odašiljač:** DDP (Distributed Display Protocol, port 4048) + WLED UDP + Art-Net/sACN.


## Stvarno stanje radnog prostora

Ovaj dokument opisuje predloženu Tauri arhitekturu; ona još nije implementirana. Postojeća pokretljiva Node/JS aplikacija, testovi i hardversko mapiranje nalaze se u [studio-light-baseline/app](studio-light-baseline/app/). Drugi, za konkretnih devet barova prilagođen istraživački plan je [RESEARCH_PRODUCT_BLUEPRINT.md](studio-light-baseline/RESEARCH_PRODUCT_BLUEPRINT.md). Pri razvoju usporediti oba nacrta i sačuvati funkcionalni baseline dok se nova arhitektura ne potvrdi mjerenjem.

Za rad s agentima vidi [AGENTS.md](AGENTS.md) i [ORCHESTRATOR_PROMPT.md](ORCHESTRATOR_PROMPT.md).
