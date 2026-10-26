# LEDicated — projektne upute

Ovaj folder je jedino sjedište privatne LED aplikacije. Prvo pročitaj `README.md`, oba istraživačka nacrta (`LEDICATED_RESEARCH_BLUEPRINT.md` i `studio-light-baseline/RESEARCH_PRODUCT_BLUEPRINT.md`), `studio-light-baseline/README.md`, `studio-light-baseline/layout.json` i `studio-light-baseline/app/README.md`. Postojeći pokretljivi kod je u `studio-light-baseline/app/`; ne proglasi Tauri/React nacrt implementiranim. Ako ga želiš zamijeniti, prvo dokaži da novi put daje bolji stvarni rezultat i sačuvaj postojeći rad.

Korisnikova namjera: najviše oko 100 lokalnih drag-and-drop pjesama; privatna upotreba na ovom MacBooku Pro (Apple M3 Max, 48 GB); probna datoteka `/Users/timonterzic/Downloads/Sounds.mp3`; Bluetooth zvučnici i kalibracija audio/svjetlosnog pomaka; klupski i energičan prvi auto show; shematski 3 × 3 pregled za početak. Nisu potrebni računi, cloud ili distribucija. Provjera 10. listopada 2026. pokazala je oko 60 GiB slobodnog prostora; ponovno provjeri prije velikih audio cacheova.

Hardver: devet 1,2 m barova `L1 C1 R1 / L2 C2 R2 / L3 C3 R3`; naručene 3 × 5 m 24 V WS2814 RGBWW trake, 24 V napajanja označena 100/300/400 W; planirano pet WLED ESP32-C3 čvorova. Oprema je zadnji put bila u statusu čekanja isporuke. Dvanaest adresabilnih grupa po baru samo je procjena. Fizičko ponašanje, RGBW redoslijed, snaga i Bluetooth sinkronizacija zahtijevaju mjerenje.

Korisnik je naknadno naručio **E8-WiFi Plus V1.01**. Prije promjene topologije, pinova, WLED firmwarea ili napajanja pročitaj [referencu za E8](studio-light-baseline/E8_WIFI_PLUS_V1_01.md). Aplikacija sada ima softverski profil **E8 + jedan C3** za devet neovisnih barova, uz očuvan profil pet C3 čvorova. `layout.json` i stare spojne sheme ostaju C3 baseline. E8 profil je simulacijski testiran, a fizičko ožičenje i prijem čekaju opremu.

Prozor **Postavke kontrolera** koristi Mac Bonjour `_wled._tcp` za lokalno otkrivanje, potvrđuje WLED preko `/json/info`, čuva MAC identitet uz IP i prati DHCP promjene samo dok je izlaz ugašen. Ručni IP ostaje u Napredno. Pojedinačni kratki DDP test jednog bara moguć je bez svih kontrolera; puni show i dalje traži sve. Mrežna dijagnostika, probni UDP paket i simulacijski testovi nisu fizička potvrda trake.

Cilj: projekti pjesama/setova, waveform timeline sa slojevima/keyframeovima/beat snapom, lokalna stem i beat analiza, editabilni auto show, pouzdan deterministički preview koji koristi isti završni RGBW frame kao WLED izlaz, kalibracija Bluetootha i blackout. Dovrši softver i simulacijske testove prije zaključka; jasno navedi fizičke provjere koje čekaju opremu.

Kod rada više agenata orkestrator definira ugovore modula, daje svakom agentu mali brief i ne dopušta paralelno uređivanje istih datoteka. Svaki rezultat se integrira i testira.
