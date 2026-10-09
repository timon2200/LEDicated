# Studio Light: istraživanje i nacrt proizvoda

**Stanje istraživanja:** 8. listopada 2026.  
**Opseg:** prva faza, analiza postojećih rješenja i prijedlog privatne aplikacije za devet LED barova u rasporedu 3 × 3. Nije potvrda rada na stvarnoj instalaciji. Korisnik je potvrdio da se aplikacija neće distribuirati i da će lokalna biblioteka imati najviše oko 100 pjesama, koje će sam povlačiti u aplikaciju.

## 1. Sažetak odluke

Najbliži gotovi alati imaju različite jake strane, ali pregledani izvori nisu potvrdili jedan Mac program koji istodobno daje naš jednostavan 3 × 3 workflow, WLED izlaz na postojećih pet C3 kontrolera, precizan višeslojni timeline, automatske i ručne stem animacije te pregled koji se uvijek podudara s izlaznim frameom.

**Preporuka:** zadržati postojeći Studio Light kao jezgru i WLED/DDP transport. U njega postupno ugraditi editor pjesama, offline analizu i jednu zajedničku determinističku render funkciju za scrub, reprodukciju i izlaz. Prije veće izgradnje usporediti jedan isti kratki glazbeni isječak u xLights, MadMapperu i LED Strip Studiju 4. LED Strip Studio 4 je osobito dobar UX uzor, ali [službeni popis podržanog hardvera](https://www.ledstripstudio.com/manuallss4/introduction/supported-hardware/) zasad navodi samo njihove kontrolere. Novije [bilješke verzija](https://www.ledstripstudio.com/products/led_strip_studio_4_changelog/) spominju Art-Net izlaz/licencu, pa kompatibilnost s našim WLED čvorovima traži praktičnu probu ili potvrdu proizvođača.

Ovo je sinteza istraživanja, ne tvrdnja proizvođača. Ni jedan automatski beat/stem algoritam ne može jamčiti točan rezultat na svakoj pjesmi. Pouzdan proizvod treba korisniku omogućiti brzu korekciju i imati provjerljiv preview i izlaz.

## 2. Što već imamo i što je fizički moguće

Lokalni [opis instalacije](README.md), [mapa barova](layout.json) i [opis aplikacije](app/README.md) navode devet barova duljine 120 cm, raspored `L1 C1 R1 / L2 C2 R2 / L3 C3 R3`, pet planiranih ESP32-C3 WLED čvorova i RGBW WS2814 trake. Sadašnji `engine.mjs` renderira 12 logičkih grupa po baru, osam scena, palete, beat clock i prijelaze; browser prikazuje istih devet barova, a lokalni server šalje DDP RGBW/RGB. Postoje demo, blackout i osnovni watchdog.

**Važna granica:** procjena od 12 upravljivih grupa po baru (108 ukupno) tek treba biti izmjerena na isporučenoj traci. Ako šest fizičkih LED-ova dijeli jednu adresu, softver ne može neovisno animirati svaku od približno 648 dioda. Editor zato mora govoriti o **adresabilnim grupama** i pokazivati stvarnu rezoluciju, ne crtati prividnu kontrolu nad svakom diodom. Smjer, broj grupa i RGBW redoslijed također čekaju test.

Korisnik je potvrdio narudžbu **3 × 5 m 24 V WS2814 RGBWW (60 fizičkih LED/m, IP30)** te 24 V napajanja označena **100 W, 300 W i 400 W**; status je još „Awaiting delivery”. To potvrđuje odabrane varijante, ne stvarnu potrošnju ni pojedinačnu adresabilnost. [Popis naručenih dijelova](ORDERED_PARTS.md) ostaje mjerodavan za prvi test jedne trake. Napajanja se ne zbrajaju u jedan zajednički izvor.

Trenutačni pregled koristi DOM elemente i aproksimaciju bijelog emitera na RGB monitoru. Dobar je za raspored i ritam, ali nije kalibrirani prikaz svjetline/difuzora u prostoriji. Reprodukcija ovisi o otvorenoj browser kartici; realni BlackHole → glazba → WLED put i fizički fallback još nisu potvrđeni. [Postojeći testni izvještaj](app/README.md) to jasno razlikuje. U ovoj reviziji sam pokrenuo postojeće testove: 21 prolazi; server test se ne može izvršiti u ograničenom radnom okruženju jer je lokalno otvaranje porta odbijeno (`EPERM 127.0.0.1`). To nije provjera fizičkog sustava niti dokaz kvara aplikacije.

| Zahtjev | Sadašnje stanje | Ciljana promjena |
| --- | --- | --- |
| Devet barova i RGBW frame | Postoji u prototipu | Potvrditi fizičko mapiranje i boje. |
| Live audio reakcija | Jedan bass/level signal i procjena tempa | Više frekvencijskih pojaseva i pouzdan fallback. |
| Projekt = pjesma ili set | Ne postoji | Biblioteka, media manifest, verzije i povezani show. |
| Waveform i glazbeni timeline | Ne postoji | Zoom, scrub, višestruke staze, keyframeovi, undo/redo. |
| Stemovi | Ne postoje | Offline odvajanje, pregled stemova i kontrolni signali. |
| Više efekata odjednom | Samo prijelaz između scena | Slojevi, maske, blend, prioritet, plafon svjetline. |
| Auto mod | Jednostavan slijed scena | Generiranje aranžmana iz analizirane pjesme; odvojeni live fallback. |
| Preview identičan izlazu | Zajednički osnovni frame, ali posebna ekranizacija | Jedan finalni RGBW frame buffer, usporedba i mjerenje latencije. |

## 3. Katalog postojećih programa

Oznake: **gotovo** = može se isprobati kao cijeli alat; **uzor** = funkcionalnost ili UX za proučavanje; **integracija** = javni API, format ili biblioteka. Oznake licenci služe usporedbi izvora, a nisu kriterij za komercijalnu distribuciju jer će aplikacija ostati privatna.

| Program | Najjača značajka za nas | Uklapanje u Mac + WLED | Status |
| --- | --- | --- | --- |
| [WLED](https://kno.wled.ge/) | Fizički izlaz, segmenti, mapiranje, DDP/Art-Net/sACN, preset/playlist i WebSocket live stanje. | Već planirani firmware; ostaje izlazni sloj. | Integracija; [EUPL-1.2](https://github.com/wled/WLED). |
| [LedFx](https://docs.ledfx.app/en/latest/) | Audio reaktivni efekti, virtualne zone, frekvencijski rasponi, sinkronizacija više uređaja i pregled. | DDP prema WLED-u; zaseban proces i jedan vlasnik izlaza. | Gotovo/uzor; [GPL-3.0](https://github.com/LedFx/LedFx). |
| [xLights](https://xlights.org/) | Pjesme, precizno sekvenciranje, timing markeri, slojevi, model i prostorni pregled. | macOS; [DDP i drugi izlazi](https://github.com/xLightsSequencer/xLights/blob/master/AGENTS.md); složeniji UI. | Gotovo/uzor; GPL-3.0. |
| [QLC+ 5](https://www.qlcplus.org/discover/features) | Show Manager timeline, RGB Matrix, fixture/DMX, Virtual Console. | macOS i Art-Net/sACN prema WLED-u; više DMX usmjeren. | Gotovo/uzor; [Apache-2.0](https://github.com/mcallegari/qlcplus). |
| [LED Strip Studio 4](https://www.ledstripstudio.com/led-strip-studio-software-4/) | Nativni Mac, waveform, više timeline staza, alpha keyframeovi, preview i mapiranje. | [Manual navodi njihove kontrolere](https://www.ledstripstudio.com/manuallss4/introduction/supported-hardware/); [noviji changelog](https://www.ledstripstudio.com/products/led_strip_studio_4_changelog/) spominje Art-Net izlaz, pa WLED treba probati. | Vrlo važan UX uzor/probni alat; vlasnički. |
| [MADRIX 5](https://www.madrix.com/products/madrix-5) | 55+ efekata, audio S2L/M2L, layer/mix, waveform timeline i cue lista. | Windows 11 i licencni ključ; teško za naš Mac workflow. | Profesionalni uzor; vlasnički. |
| [MadMapper 6](https://madmapper.com/madmapper/features) | Mapiranje linija/geometrije, LED Scanner, cueovi, timeline, markeri, audio i preview. | macOS; Art-Net/sACN su mogući interop put za WLED. | Najvažniji komercijalni pilot; vlasnički. |
| [Resolume Arena](https://resolume.com/software/avenue-arena) | Live klipovi, slojevi, video/FFT, fixture mapping, Art-Net. | macOS i Art-Net; Arena, ne Avenue, za fixture izlaz. | Uzor za live izvedbu; vlasnički. |
| [TouchDesigner](https://derivative.ca/UserGuide) | Generativni node graf, audio, proceduralna logika, vizualizacija i kontrolni protokoli. | macOS; velika sloboda i veća krivulja učenja. | Uzor/prototipiranje efekata; vlasnički. |
| [ENTTEC ELM 2026](https://www.enttec.com/es/product/dmx-lighting-control-software/pixel-mapping-software/) | 2D/3D LED mapping, live blend slojevi, shaderi, audio/beat i Art-Net/sACN. | Windows-only prema službenoj stranici. | Uzor za compositing i monitoring; vlasnički. |
| [Lightjams LED Mapper](https://www.lightjams.com/ljlm/) | Geometrija linija/krivulja, 2D/3D pregled, audio i shaderi. | Windows-only; Art-Net/sACN. | Uzor za mapping; vlasnički. |
| [Lightjams](https://www.lightjams.com/) | Live generativni DMX, senzori, MIDI/OSC/Link, glazbena reakcija. | Windows-only. | Uzor za live auto; vlasnički. |
| [Jinx!](https://live-leds.de/features/) | Jednostavan matrični patch, generatori, audio i show mode. | Windows-only; Art-Net/sACN/tpm2. | Uzor za jednostavnost; zatvoren kod. |
| [Vixen Lights](https://www.vixenlights.com/) | Glazbene sekvence i preview sezonskih instalacija. | Primarno Windows. | Usporedba timeline UX-a. |
| [Falcon Player / FPP](https://github.com/FalconChristmas/fpp) | Reproduciranje gotovih sekvenci, setovi i rasporedi. | Nije glavni editor; koristan otvoren [FSEQ format](https://github.com/FalconChristmas/fpp/blob/master/docs/FSEQ_Sequence_File_Format.txt). | Integracija za uvoz/izvoz ili zaseban player. |
| [Hyperion](https://github.com/hyperion-project/hyperion.ng) | Video/ambient capture, efekti, prioritetni izvori. | WLED podržan; nema traženi DAW timeline. | Uzor za priority routing; MIT. |
| [Pixelblaze](https://electromage.com/) | Programabilni LED uzorci u uređaju. | Traži drugi kontrolerski ekosustav. | Uzor za kolekciju efekata. |
| [FastLED](https://github.com/FastLED/FastLED) | LED matematika, noise i primjeri na mikrokontroleru. | Nije desktop editor; provjeriti aktualnu licencu prije ugradnje. | Uzor za algoritme. |
| [Lightkey](https://www.lightkeyapp.com/en/specs) | Pristupačan Mac UI, 2D preview, editabilni efekti, Ableton sinkronizacija. | Za puni glazbeni timeline oslanja se na Ableton. | Uzor za lakoću uporabe; vlasnički. |
| [Synesthesia](https://app.synesthesia.live/docs/) | Audio-reaktivni shaderi i OSC vrijednosti analize. | Može hraniti drugi renderer preko OSC/Syphon, nema puni LED timeline. | Uzor za live vizualizacije; vlasnički. |
| [L.E.D. Lab](https://apps.apple.com/us/app/l-e-d-lab/id832042156) | Pjesme kao projekti, scene i frekvencijsko mapiranje parametara. | iPad aplikacija, zatvoren kod. | Izravni funkcionalni uzor za song workflow. |
| [Notch](https://www.notch.one/features/working-in-notch) | Real-time viewport, waveform, keyframeovi i node graf. | Builder samo na Windowsu; Art-Net izlaz piksela nije potvrđen. | Uzor za motion editor; vlasnički. |

**Razlika između kategorija:** WLED prima frameove; LedFx računa reakciju u stvarnom vremenu; xLights/QLC+/LSS4 sekvenciraju pjesme; MadMapper/ELM mapiraju geometriju; Resolume je jak u live clip workflowu. Njihov naziv „timeline” ne znači uvijek isto. Posebno [MADRIX](https://help.madrix.com/tutorials/m5/HTML/hidd_how_to_create_timelines.html) i [LSS4](https://www.ledstripstudio.com/manuallss4/shows/synchronization/) imaju waveform uz glazbu, dok TouchDesignerova opća vremenska traka sama po sebi nije DAW editor pjesme.

### Kratka usporedba najbližih opcija

| Alat | Precizna pjesma/timeline | Live audio i efekti | Geometrija i preview | Glavni razlog da nije konačno rješenje |
| --- | --- | --- | --- | --- |
| xLights | Vrlo snažno | Djelomično | Snažno | Previše koraka za mali 3 × 3 studio i nema traženi stem workflow u jednom jednostavnom UI-ju. |
| LSS4 | Snažno, [više staza i alpha keyframeovi](https://www.ledstripstudio.com/manuallss4/shows/editingevents/) | Scene/efekti | Snažno | WLED kompatibilnost i Art-Net pixel izlaz u aktualnoj verziji treba potvrditi probom. |
| MadMapper | Snažno | Snažno | Vrlo snažno | Vlasnički alat; nije potvrđen namjenski stem-driven editor po našem modelu. |
| MADRIX 5 | Snažno | Vrlo snažno | Snažno | Windows + licencni ključ. |
| LedFx | Slabo za precizni timeline | Vrlo snažno | Dovoljno za zone | Live audio alat, ne editor cijele pjesme. |
| Studio Light danas | Nema timeline | Osnovno | Točno prilagođen 3 × 3 | Treba izgraditi ključne autorske funkcije. |

Za pilot nije potrebna kupnja: [MadMapperova besplatna proba](https://madmapper.com/madmapper/software) uključuje funkcije, ali prekida DMX svakih 30 sekundi; trajna licenca počinje na **399 € bez poreza**, najam na **39 €/mj. bez poreza**. [Resolume Arena](https://resolume.com/shop/) stoji **799 €** i ima probnu verziju s vodenim žigom/robotiziranim zvukom. Cijene su provjerene na službenim stranicama na datum ovog dokumenta i mogu se promijeniti. Za LSS4 Art-Net licencu i kompatibilnost na macOS-u ne bih odlučivao na temelju starih prodajnih stranica bez probe.

## 4. Što se smije i isplati preuzeti

1. **Fizički sloj:** postojeći WLED i naš DDP sender. [WLED podržava DDP](https://kno.wled.ge/interfaces/ddp/), a WebSocket može slati stanje i pregled fizičkih piksela. DDP timecode WLED ne koristi kao clock, pa sinkronizacija mora nastati u show engineu.
2. **Valni oblik:** [wavesurfer.js](https://wavesurfer.xyz/docs/plugins/) za waveform, regije, timeline i spektrogram; [BSD-3 licenca](https://github.com/katspaugh/wavesurfer.js/blob/main/LICENSE). Za duge pjesme unaprijed izračunati peaks i dijeliti istu audio vremensku bazu.
   Za sam blokovski editor vrijedi prototipirati [React Timeline Editor](https://github.com/xzdarcy/react-timeline-editor) (MIT), ali postojeći Studio Light nema React, pa prelazak ima smisla samo ako doista ubrza razvoj i bude gladak pri zoomu i povlačenju. [PixiJS](https://github.com/pixijs/pixijs) (MIT) može ubrzati 2D prikaz LED piksela; najprije izmjeriti sadašnji prikaz na stvarnih 108 grupa.
3. **Stemovi:** [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) kao zaseban lokalni Python posao, s MDX/MDXC/Demucs izborom; kod je [MIT](https://github.com/nomadkaraoke/python-audio-separator/blob/main/LICENSE). Licenca konkretnog modela/utega provjerava se posebno. [Demucs v4](https://github.com/facebookresearch/demucs) je dobar 4-stem početni izbor, ali autor navodi da izvorni repozitorij nije aktivno održavan. Razdvajanje je postupak **pri uvozu**, ne pretpostavka za nultu latenciju tijekom live sviranja.
4. **Ritam:** [Beat This!](https://github.com/CPJKU/beat_this) vraća beat i downbeat markere i objavljuje kod i utege pod MIT licencom. [librosa](https://librosa.org/doc/0.11.0/tutorial.html) računa onset, RMS, spektar, kromu i druge offline značajke. Autori beat modela sami opisuju pogreške na teškoj ili nedovoljno zastupljenoj glazbi, pa markeri moraju biti ručno pomični.
5. **Vanjski alati kao procesi/format:** LedFx se može kontrolirati [REST API-jem](https://docs.ledfx.app/en/latest/apis/api.html) i može služiti za A/B provjeru audio efekata; xLights može izvesti FSEQ frameove prema [otvorenom opisu formata](https://github.com/FalconChristmas/fpp/blob/master/docs/FSEQ_Sequence_File_Format.txt). Za privatnu lokalnu aplikaciju biramo integraciju koja je najjednostavnija za održavanje; LedFx i vlastiti app ne smiju istodobno slati različite frameove na isti WLED čvor.
6. **Vizualna inspiracija:** preuzeti principe rada, ne tuđi zatvoreni kod ili grafiku: LSS4 waveform/trackovi/alpha, MadMapper prostorno mapiranje, MADRIX slojevi i A/B pregled, xLights timing markeri.

Za ovu privatnu upotrebu [Essentia](https://github.com/MTG/essentia) i [aubio](https://github.com/aubio/aubio) nisu isključeni zbog distribucije. Ipak, jednostavniji lokalni audio pipeline s manje procesa i ovisnosti ima prednost. Komercijalni [AudioShake](https://www.audioshake.ai/developer-home) ili [LALAL.AI API](https://www.lalal.ai/api/v1/docs/) nisu potrebni za početnu verziju; lokalni import radi bez mreže i bez troška po pjesmi.

## 5. Predloženi proizvod: način rada

**Tri prostora u jednom sučelju:**

- **Library:** projekt je pjesma s audiom, analizom, stemovima, showom i verzijom mapiranja ili set koji uređuje redoslijed pjesama, prijelaze i fallback. Korisnik povuče MP3/WAV/FLAC iz svoje zbirke; aplikacija lokalno pohrani datoteku ili pouzdanu referencu te izračunate značajke stemova. Biblioteka cilja najviše oko 100 pjesama, pa nisu potrebni cloud katalog, korisnički računi ni serverska baza. Trenutačno je na Macovu podatkovnom volumenu oko **18 GiB slobodno**; zbog toga trajno spremanje svih sirovih WAV stemova za stotinu pjesama nije dobar zadani izbor. Nakon analize zadržati male feature cacheove, a stem audio čuvati samo po izboru ili u komprimiranom obliku uz pregled zauzeća.
- **Create:** u sredini veliki 3 × 3 preview; ispod valni oblik miksa i po izboru drum/bass/vocal/other; staze za `Base`, `Rhythm`, `Voice`, `Accents`, `Manual`. Desno samo parametri označenog efekta. Korisnik može povući preset na stazu, skratiti ga, mijenjati opacity/parametre keyframeovima, maskirati barove i preslušati odmah.
- **Perform:** puna reprodukcija pjesme i rasvjete iz iste vremenske baze, set lista, jednostavni intenzitet/energija/kontrast, naredba GO i uvijek vidljiv blackout. Auto mod ima 2–3 makro kontrole; napredne postavke se otvaraju tek u Create prostoru. Prvi zadani stil za `Sounds.mp3` je **klupski i energičan**.

Za korisnika koji želi početi za jednu minutu: `Uvezi pjesmu → analiziraj → odaberi stil → Preview → Spremi`. Automatski show je **editabilan prijedlog**: generira klipove i markere na timelineu, pa korisnik može promijeniti pogrešan beat, smiriti refren ili dodati precizan akcent. Time se spajaju brzina i granularna kontrola.

### Glazba kao kontrolni signal

```
lokalni audio → hash + PCM vremenska baza
             → waveform peaks
             → beat/downbeat + opcionalni markeri strukture
             → 4 stema (drums, bass, vocals, other)
             → za svaki stem: RMS, onset, frekvencijski pojasevi, pouzdanost
             → mapping signal → parametar efekta → timeline sloj
             → kompozitor → 9 × N RGBW frame → preview i WLED
```

Primjer: kick onset na drum stemu pokreće kratki val od C2 prema rubovima; bass energija mijenja širinu i sjaj baznog svjetla; vocal RMS pokreće topao uzlazni trag na vanjskim barovima. U istom trenutku rade sva tri sloja. Korisnik može za svaki izvor otvoriti jednostavan parametarski frekvencijski graf: `low/high cut`, prag, gain, attack/release i mapa na intenzitet, boju, brzinu ili položaj. Za vokalnu visinu tona ponuditi opciju samo kad je signal dovoljno monofon i pouzdan; nota nije obvezan driver.

**Live Auto** iz proizvoljnog YouTube/BlackHole ulaza reagira na pojas, onset i procijenjeni tempo, uz TAP/HOLD. Bez prethodnog uvoza pjesme nema pouzdanih stemova ni točnog budućeg refrena. **Prepared Auto** nakon offline analize smije koristiti stemove, downbeat i strukturu cijele pjesme, pa kvaliteta može biti znatno bolja.

### Pravila miksanja efekata

Svaki efekt vraća vlastiti RGBA/RGBW frame i masku nad stvarnim adresabilnim grupama. Slojevi se spajaju stabilnim redoslijedom: `Base → stem driven layers → manual accents → master`. Za svaki sloj biraju se `Normal`, `Add`, `Screen`, `Max` ili `Multiply`, opacity, prioritet i eventualno ducking (npr. kick priguši osnovni sloj na 180 ms). Boje treba spajati u linearnom svjetlu, zatim primijeniti ograničenje ukupne svjetline, RGBW politiku i kalibraciju prije slanja. [W3C compositing model](https://www.w3.org/TR/compositing-1/) daje referentne formule; vlastiti RGBW izlaz zahtijeva mjerenje na stvarnoj traci.

"Pametan" rezultat proizlazi iz aranžmana: vizualna hijerarhija, razmak između akcenata, maksimalna gustoća događaja, kontrast između strofe i refrena, kontrola dugih bijelih bljeskova i konzistentan prostorni smjer. Samo zbrajanje svih audio signala proizvelo bi zasićenu, stalno aktivnu rasvjetu. Zato auto generator prvo bira osnovnu scenu za glazbenu sekciju, zatim dodaje malobrojne akcentne slojeve i ograničava ukupnu energiju framea.

**Plan zbirke preseta (40 vlastitih varijanti, bez kopiranja tuđih grafika/koda):**

| Obitelj | Deset preseta za naš raspored 3 × 3 |
| --- | --- |
| Prostorni pokret | Stupac lijevo–desno; stupac desno–lijevo; red gore–dolje; dijagonala; zrcalni ulaz; zrcalni izlaz; C2 puls prema rubovima; spiralni obilazak barova; vertikalni trkač; kiša odozgo. |
| Ritam | Kick cijeli pod; kick samo C2; snare vanjski stupci; hi-hat kratke iskre; downbeat svih devet; osmina izmjenično; sinkopa lijevo/desno; tripletni val; 4-taktni naglasak; ritam s namjernim prazninama. |
| Stem/ton | Vokalni topli uspon; vokalni call-and-response; bas donje grupe; bas širina vala; drum udarac s repom; pad lagano disanje; melodija prati ton boje; spektralni stupci; vokal i bas komplementarno; instrumentalni ambijent iza glasa. |
| Dramaturgija | Uvod iz tame; spora gradnja; ubrzana gradnja; pred-drop tišina; kontrolirani drop; eho zadnjeg udarca; prijelaz palete; refren u širokom prostoru; stanka u crnilu; završno gašenje. |

Svaki preset je konfiguracija istih malobrojnih generatora, maski i kontrolnih signala. Korisnik vidi trajanje, ciljane barove i tri najvažnije kontrole, a u naprednom prikazu može uređivati sve parametre. Na traci od približno 12 grupa po baru treba izbjegavati efekte koji ovise o sitnim tekstovima ili gustoj 2D slici; prednost imaju jasni prostorni potezi i vremenski kontrast.

### Preview kao mjerljiva funkcija

`render(project, audioTime, topology)` mora dati isti **finalni** RGBW frame pri reprodukciji, pauzi, skoku na 37,4 s i offline izvozu. Preview i mrežni izlaz dobivaju taj isti buffer nakon mapiranja, mastera i blackouta. Ekranski prikaz W kanala bit će posebno označena simulacija; nakon jednokratnog foto/kolorimetrijskog testa može se dodati profil difuzora i kamere za uvjerljiviji room view. Drugi pregled prikazuje sirove grupe i njihove ID-ove radi dijagnostike. **Preview ne smije izmišljati dodatne piksele**.

Audio playback mora biti glavni sat; ne oslanjati se na browser `setInterval` ili animacijski frame za glazbenu poziciju. Render pri skoku na timelineu ne smije ovisiti o prethodno prikazanim frameovima: trail/particle efekti koriste zatvoreni oblik, snapshotove ili deterministički replay od obližnje kontrolne točke. Time scrub ostaje brz i ponovljiv. Za nisku latenciju audio obrade postoji [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet); mrežno slanje i UI rade izvan audio niti.

**Bluetooth sinkronizacija:** uredski zvučnici će primati zvuk Bluetoothom. [Procjena `AudioContext.outputLatency`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency) može dati početnu vrijednost, ali ovisi o platformi i uređaju; doživljaj u sobi treba kalibrirati. U sučelju je potreban jednostavan „pomak svjetlo ↔ zvuk” s ponovljivim metronomskim testom i spremanjem vrijednosti za taj izlazni uređaj. Pri promjeni zvučnika ili ponovnom povezivanju aplikacija treba zatražiti brzu provjeru pomaka. Sadašnji 3 × 3 shematski prikaz dovoljan je za prvu verziju; fotografija prostora nije uvjet.

## 6. Prioriteti za tri faze

### Faza 1 — istraživanje i odluka (ovaj dokument)

Ispitati isti 45–60 sekundni isječak iz korisnikove datoteke `Sounds.mp3` i raspored 3 × 3 u xLights, MadMapperu i LSS4: vrijeme do prvog dobrog showa, preciznost scruba, kvaliteta pregleda, broj radnji za dodavanje dva istodobna efekta, rad na Macu i stvarni izlaz na WLED. LSS4 treba posebno provjeriti na njihovom demo modu, jer dokumentacija ograničava hardver. LedFx koristiti za usporedbu audio reakcije, ne za timeline. Zabilježiti snimke zaslona, kratki video, latenciju i sve prepreke. Ovaj terenski pilot još nije proveden.

### Faza 2 — funkcionalni prototip

1. Uvoz lokalne pjesme, waveform s unaprijed izračunatim peaks, jedna audio vremenska baza, play/pause/seek.
2. Staze, klipovi, beat/downbeat snap, keyframeovi, undo/redo i lokalno spremanje projekta.
3. Deterministički multi-layer RGBW renderer za devet barova; isti frame u pixel previewu i DDP izlazu.
4. Offline 4-stem analiza te `drums onset` i `vocals RMS` kao dva neovisna drivera, s frekvencijskim editorom.
5. Prvih 12–20 kuriranih preseta: ambient, breathing, column/row chase, vertical runner, mirror, wave, sparkle, beat pulse, vocal bloom, bass swell, build, drop, blackout transition. Svaki ima pregled, nekoliko smislenih makro kontrola i sigurnu početnu vrijednost. U trećoj fazi zbirka može narasti na 40–60 kvalitetno podešenih varijanti kroz prostorni smjer, ritam, stem i paletu; broj sam po sebi nije kriterij kvalitete.

### Faza 3 — poliranje i produkcijska provjera

Auto aranžiranje cijele pjesme, set lista, preset browser s kratkim video/pixel prikazima, spremanje/verzioniranje, automatska obnova nakon pada, status svakog WLED čvora, mrežna dijagnostika i sigurni fallback. UI dobiva Mac osjećaj i diskretno prozirne plohe, ali najvažniji elementi ostaju čitljivi: waveform, playhead, status izlaza i blackout. Zatim testovi na jednoj traci i svih devet barova, uključujući RGBW kalibraciju, latenciju, gubitak Wi-Fi-ja, skrivanje kartice, promjenu audio uređaja, seek usred refrena i višesatni rad.

### Mjerljivi uvjeti prihvaćanja

| Područje | Dokaz prolaska |
| --- | --- |
| Mapiranje | Svaka stvarna adresabilna grupa ima jedinstveni ID; redoslijed, reverse i W kanal potvrđeni fizičkim testom. |
| Reprodukcija | Pjesma i show ostaju u dogovorenoj toleranciji latencije nakon pauze, seeka i prijelaza na iduću pjesmu; toleranciju zadati nakon mjerenja zvučnika i mreže. |
| Preview | Hash finalnog RGBW framea u previewu i transportu odgovara za nasumične vremenske točke, sve blend načine, master i blackout. |
| Timeline | Klipovi/keyframeovi ostaju na istim audio timestampima nakon zooma, spremanja/otvaranja i promjene tempa; undo/redo vraća stanje. |
| Stem/beat | Poznate test pjesme pokazuju odvojene kontrolne signale; korisnik može ispraviti pogrešan marker u nekoliko radnji. |
| Robusnost | Gubitak browsera/servera/mreže završava tamnim stanjem na stvarnom WLED-u; duga reprodukcija bez vidljivih preskoka. |

## 7. Otvorene odluke prije izrade

- Stvarna adresabilna gustoća i maksimalna struja/temperatura kupljene WS2814 RGBW trake; pregled na stvarnom difuzoru.
- Točan Mac i verzija sustava za desktop paket. Postojeći web UI daje najkraći put; nativni omotač može doći poslije, uz isti engine.
- Probna pjesma je [`Sounds.mp3`](/Users/timonterzic/Downloads/Sounds.mp3): MP3, 48 kHz stereo, 320 kb/s, trajanje 5:11.226. Za prvi usporedni test odabrati 45–60 sekundi s različitim dijelovima nakon slušne provjere.
- Mac je sadašnji MacBook Pro s Apple M3 Max čipom i 48 GB memorije. Stem obrada može se planirati lokalno; stvarno trajanje ovisit će o izabranom modelu i izmjerit će se na ovoj pjesmi.
- Biblioteka popularnih pjesama, javni katalog, cloud sinkronizacija i distribucija aplikacije nisu dio ovog projekta. Do najviše oko 100 lokalnih pjesama sve se dodaje povlačenjem iz korisnikove zbirke.

## 8. Izvori za daljnji detaljni pregled

- [LSS4: show](https://www.ledstripstudio.com/lss4/manual/shows/index.php), [sinkronizacija i waveform](https://www.ledstripstudio.com/manuallss4/shows/synchronization/), [uređivanje događaja i alpha](https://www.ledstripstudio.com/manuallss4/shows/editingevents/), [hardver](https://www.ledstripstudio.com/manuallss4/introduction/supported-hardware/).
- [MADRIX: efekti i timeline](https://www.madrix.com/products/madrix-5), [slojevi](https://help.madrix.com/m5/html/madrix/hidd_user_interface_layer_array_.html).
- [MadMapper: mogućnosti](https://madmapper.com/madmapper/features), [službena dokumentacija](https://docs.madmapper.com/).
- [LedFx virtuals](https://docs.ledfx.app/en/latest/howto/virtuals.html), [API](https://docs.ledfx.app/en/latest/apis/api.html), [WLED DDP](https://kno.wled.ge/interfaces/ddp/).
- [xLights izvorni repozitorij](https://github.com/xLightsSequencer/xLights), [FSEQ specifikacija](https://github.com/FalconChristmas/fpp/blob/master/docs/FSEQ_Sequence_File_Format.txt).
- [audio-separator](https://github.com/nomadkaraoke/python-audio-separator), [Demucs](https://github.com/facebookresearch/demucs), [Beat This!](https://github.com/CPJKU/beat_this), [librosa](https://librosa.org/doc/0.11.0/tutorial.html), [wavesurfer.js](https://wavesurfer.xyz/).
