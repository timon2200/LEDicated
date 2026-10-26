# E8-WiFi Plus V1.01 — referenca za agente LEDicated

**Status (10. listopada 2026.):** korisnik je naručio E8-WiFi Plus V1.01. Dolazak, revizija stvarne pločice, firmware i rad s kupljenom WS2814 trakom još nisu potvrđeni. Ovo je dokumentacija naručenog kontrolera i plan integracije, ne potvrđena spojna shema.

## Izvori i razina pouzdanosti

- **Datasheet proizvođača:** `/Users/timonterzic/Downloads/E8-WiFi_Plus_V1.01_Datasheet-English.pdf`, 16 stranica, za *V1.01*. Stranice 4–8 pokrivaju napajanje, izlaze i osigurače; 9–13 GPIO dodatke; 14 čip/radio; 15–16 softver i sigurnost. Brojke ispod su tvrdnje proizvođača, ne naša mjerenja.
- [Lightish web installer](https://software.lightish.dk/E8-WiFi_Plus/) nudi odabir **V1.00 & V1.01** ili **V1.02** i oglašava **WLED 0.12.0**. Verziju na isporučenoj pločici treba očitati prije bilo kakvog flashanja. Ne pretpostavljati da je ovaj stari installer prikladan za naš DDP RGBW put.
- [WLED multi-strip](https://kno.wled.ge/features/multi-strip/) potvrđuje više izlaza na klasičnom ESP32; [WLED DDP](https://kno.wled.ge/interfaces/ddp/) navodi UDP port 4048. To ne dokazuje rad svih osam portova, RGBW prijem ili brzinu na ovoj pločici i njezinu firmware buildu.
- Lokalni [layout.json](layout.json) i [postojeće spojne sheme](HARDWARE_SCHEMATICS.md) opisuju **postojeći C3 plan**. [Aplikacija](app/README.md) sada dodatno podržava softverski E8 + C3 profil.

## Što je E8 u našem sustavu

E8 ima klasični **ESP32-WROOM-32UE** (nije ESP32-C3), 8 MB flasha, vanjsku Wi-Fi antenu i **osam neovisnih podatkovnih izlaza** za trožične adresabilne trake. Datasheet navodi Wi-Fi 2,4 GHz; žični Ethernet ne opisuje. Svaki podatkovni izlaz je prema datasheetu bufferiran na **5 V TTL**. To može ukloniti zasebne AHCT buffere na osam E8 linija; valni oblik i kompatibilnost s naručenom 24 V WS2814 RGBW trakom ipak treba testirati. Datasheetova granica od **4800 piksela ukupno** i navod o **10 m udaljenosti podataka** nisu jamstvo željenog frameratea ili stabilnosti u našoj sobi. Bluetooth oznaka u specifikaciji ESP32 ne znači da je E8 izlaz za zvuk na Macovim Bluetooth zvučnicima.

Naš raspored ima **devet** zasebno upravljanih barova (`L1 C1 R1 / L2 C2 R2 / L3 C3 R3`). Jedan E8 ima **samo osam** fizičkih izlaza. Za neovisnih devet barova potreban je još barem jedan izlaz na drugom kontroleru, primjerice postojeći ESP32-C3, ili drugi E8. Spajanje dva bara na isti podatkovni izlaz bez zasebne adresabilne putanje mijenja zahtjev i ne smije se prešutno proglasiti devetim izlazom.

## Pinout V1.01

Brojevi GPIO su **GPIO klasičnog ESP32**, ne oznake na ESP32-C3 SuperMini. `O1`–`O8` su oznake fizičkih E8 izlaza; u WLED-u upisati odgovarajuće GPIO brojeve tek nakon provjere firmwarea i pločice.

| E8 port / funkcija | ESP32 GPIO | Značenje za LEDicated |
| --- | ---: | --- |
| O1 Data | 5 | LED podatkovni izlaz 1 |
| O2 Data | 12 | LED podatkovni izlaz 2 |
| O3 Data | 4 | LED podatkovni izlaz 3 |
| O4 Data | 27 | LED podatkovni izlaz 4 |
| O5 Data | 17 | LED podatkovni izlaz 5 |
| O6 Data | 26 | LED podatkovni izlaz 6 |
| O7 Data | 33 | LED podatkovni izlaz 7 |
| O8 Data | 25 | LED podatkovni izlaz 8 |
| I1 external button | 34 | Mogući fizički okidač/blackout; firmware ponašanje treba provjeriti; input-only GPIO |
| I2 external button | 35 | Drugi mogući fizički okidač; input-only GPIO |
| Relay output | 23 | Signal za vanjski relej, **nije** potvrđena sklopka za 24 V snagu |
| IR receiver | 2 | Ugrađeni IR prijamnik; nije potreban za prvi show |
| I2C SDA | 32 | Rezervirano za I2C dodatke |
| I2C clock, u datasheetu `SCK` | 13 | Rezervirano za I2C; datasheetova oznaka je `SCK`, funkcija je I2C clock |
| DMX output | 18 | DMX nije potreban za početni WLED/DDP put |
| SD CLK / MOSI / CS / MISO | 14 / 15 / 16 / 36 | microSD; **stock WLED za standalone playback zahtijeva izmjene**, prema datasheetu str. 11; GPIO36 je input-only |
| Serial TX / RX | 1 / 3 | Serijski port i USB programiranje; ne koristiti kao LED izlaze u ovom planu |
| Spare IO21 / IO22 | 21 / 22 | Rezervni GPIO, bez zadane LEDicated namjene |

Prema [WLED dokumentaciji](https://kno.wled.ge/features/multi-strip/) GPIO34–39 na klasičnom ESP32 služe samo kao ulazi. Ne zamijeniti funkcije I1/I2/SD MISO s LED data izlazima.
Datasheet navodi namjenu tipki, ali ne daje potpunu električnu shemu njihova spajanja; pinout sam po sebi nije uputa za ožičenje fizičke blackout tipke.

## Napajanje i priključci — granice iz datasheeta

| Priključak | Uloga | Navedena granica |
| --- | --- | --- |
| `X5` glavni ulaz | Napaja kontrolni sklop **i** osam izlaznih power grana | 5–24 V DC ±5%; maksimalna struja opterećenja **30 A**; datasheet također navodi „minimum available current 10 A” za izvor |
| `X1`–`X4` | Po dva izlaza po bloku, svaki s `+`, `Data`, `−` | Izlazni napon jednak X5; maksimalno **5 A po izlazu** |
| `F1`–`F8` | Osigurač power grane O1–O8 | Najviše **5 A**, 32 V automobilski osigurač po izlazu; odgovarajući zeleni LED pokazuje stanje prema datasheetu |
| `X6 EXT PWR` | Napaja **samo kontrolni sklop** kada X5 nema napona | 5–24 V DC ±5%, maksimalno 1,1 A; nije zamjenski ulaz za napajanje LED barova |
| `USB-C` | Programiranje i kontrolni sklop kada X5/X6 nisu napajani | 5 V, maksimalno 500 mA; nije napajanje LED barova |

Ako E8 preko X1–X4 napaja naše 24 V trake, X5 mora dobiti ispravno provjerenih **24 V**, jer datasheet traži ulazni napon jednak nazivnom naponu piksela. E8 interno prihvaća 24 V na namjenskom X5/X6 ulazu; to **ne** znači da 24 V smije na GPIO, USB ili C3 pločicu. Ne spajati pozitivne izlaze različitih 24 V napajanja paralelno. Osigurači na E8 štite njegove izlazne power grane; izbor napajanja, kabelâ, vanjskih osigurača i zaštite cijelog razvoda još traži mjerenje i projektiranje. Datasheetovih 30 A ukupno i 5 A po izlazu su gornje granice pločice, **ne** izmjerena potrošnja naših barova ni preporučene vrijednosti osigurača. Oznake 100/300/400 W na kupljenim napajanjima također nisu potvrda stvarnog kontinuiranog kapaciteta. Posebno, napajanje s oznakom **100 W pri 24 V** nominalno daje oko **4,2 A**, manje od datasheetove stavke „minimum available current 10 A” za X5; ne tretirati ga kao potvrđen E8 X5 izvor za bench test bez razjašnjenja te stavke i mjerenja.

Datasheet navodi i **10 W potrošnje kontrolera**, bez razrade radnih uvjeta; uključiti je u početni proračun, zatim izmjeriti. Wi-Fi pouzdanost i prijam antene treba provjeriti u stvarnoj sobi, osobito uz Bluetooth zvučnike na 2,4 GHz.

Datasheet str. 16 traži da tijekom programiranja drugi izvori napajanja budu odspojeni i da se pločica ne stavlja na vodljivu ili mokru površinu. To su proizvođačeve sigurnosne upute za fizički rad, a ne dokaz da je naš sklop već validiran.

## Privremeni plan mapiranja za 3 × 3

Ovo je **prijedlog za implementaciju i simulacijske testove**, ne postojeća konfiguracija aplikacije ili potvrđeno ožičenje. Poredak prati vizualne redove i jedan uzastopni DDP niz po uređaju:

| Bar | Predloženi uređaj | Fizički izlaz | GPIO | Početni DDP indeks ako je 12 grupa/bar |
| --- | --- | --- | ---: | ---: |
| L1 | E8 | O1 | 5 | 0 |
| C1 | E8 | O2 | 12 | 12 |
| R1 | E8 | O3 | 4 | 24 |
| L2 | E8 | O4 | 27 | 36 |
| C2 | E8 | O5 | 17 | 48 |
| R2 | E8 | O6 | 26 | 60 |
| L3 | E8 | O7 | 33 | 72 |
| C3 | E8 | O8 | 25 | 84 |
| R3 | C3 rezervni izlaz | prema reviziji C3 pločice | potvrditi | 0 na drugom DDP odredištu |

Indeksi su u **adresabilnim grupama**, ne fizičkim diodama ni bajtovima; svaki sljedeći početak mora biti zbroj stvarno izmjerenih duljina prethodnih barova. `12` grupa i `72` fizičke diode po baru samo su projektne procjene. Smjer svake trake ostaje zasebna postavka. Za C3 podatkovnu liniju i dalje vrijedi provjera prikladnog 5 V buffera; E8 buffer se na nju ne prenosi.

**Softverski status:** `app/hardware-topology.mjs` i `app/server.mjs` podržavaju ovaj profil s dva stvarna mrežna odredišta i zasebnim DDP nizom po uređaju. Postojeći profil pet C3 čvorova ostaje dostupan. Prozor **Postavke kontrolera** automatski traži WLED preko Bonjoura, dopušta jednokratno uparivanje po MAC identitetu, prati promjenu IP adrese i prikazuje svih devet barova. IP/GPIO/DDP detalji i read-only WLED dijagnostika su pod **Napredno**. Kratki, ručno pokrenuti test pojedinog E8 bara dopušten je i prije dolaska C3; puni izlaz traži oba kontrolera. Simulacijski UDP test potvrđuje redoslijed, testni puls i blackout. `layout.json` i stara spojna shema ostaju C3 baseline; fizički E8 prijem, RGBW kanali i napajanje još nisu potvrđeni. Ne upisivati E8 kao pet virtualnih C3 uređaja.

## Provjere prije označavanja E8 kao spremnog

1. Na pristigloj pločici potvrditi natpis **V1.01**, portove/polaritet `X5`, `X1`–`X4`, osigurače, antenu i stvarni WLED build. Ne flashati naslijepo: ponuđeni V1.01 installer oglašava WLED 0.12.0, dok [postojeća aplikacija](app/README.md#rgbw-i-zaštita-izlaza) za svoj DDP RGBW put traži provjereni noviji build.
2. Na jednom osiguranom baru izmjeriti broj adresabilnih grupa, smjer, R/G/B/W kanale, maksimum struje, napon na udaljenom kraju i grijanje. Provjeriti radi li E8 5 V podatkovni izlaz s konkretnom trakom. Ne prepisivati samo naziv „RGBWW” u pet neovisnih kanala: sadašnji projekt modelira **RGBW**.
3. Konfigurirati jedan E8 izlaz pa svih osam s različitim testnim bojama; provjeriti da WLED portovi O1–O8 i kumulativni DDP indeksi odgovaraju dokumentiranoj mapi. Potvrditi RGBW DDP, framerate i stabilnost Wi-Fi-ja. Dodati C3 deveti bar i provjeriti sinkronizaciju dva odredišta.
4. Simulacijskim testovima potvrditi da preview i oba transporta koriste isti završni RGBW frame nakon mastera, reverse mapiranja i blackouta. Na hardveru provjeriti zamrzavanje/prekid paketa, WLED realtime timeout i tamni fallback, kao i Bluetooth audio/svjetlosni pomak. USB ili mrežna potvrda slanja nije dokaz fizičkog blackouta.

SD playback, DMX, IR, I2C, relej i tipke nisu potrebni za prvi show. Fizička tipka za blackout može biti korisna kasnije, ali tek nakon provjere WLED ponašanja i neovisnog sigurnog načina isključenja napajanja.
