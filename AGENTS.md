# LEDicated — projektne upute

Ovaj folder je jedino sjedište privatne LED aplikacije. Prvo pročitaj `README.md`, oba istraživačka nacrta (`LEDICATED_RESEARCH_BLUEPRINT.md` i `studio-light-baseline/RESEARCH_PRODUCT_BLUEPRINT.md`), `studio-light-baseline/README.md`, `studio-light-baseline/layout.json` i `studio-light-baseline/app/README.md`. Postojeći pokretljivi kod je u `studio-light-baseline/app/`; ne proglasi Tauri/React nacrt implementiranim. Ako ga želiš zamijeniti, prvo dokaži da novi put daje bolji stvarni rezultat i sačuvaj postojeći rad.

Korisnikova namjera: najviše oko 100 lokalnih drag-and-drop pjesama; privatna upotreba na ovom MacBooku Pro (Apple M3 Max, 48 GB); probna datoteka `/Users/timonterzic/Downloads/Sounds.mp3`; Bluetooth zvučnici i kalibracija audio/svjetlosnog pomaka; klupski i energičan prvi auto show; shematski 3 × 3 pregled za početak. Nisu potrebni računi, cloud ili distribucija. Zadnja provjera pokazala je oko 18 GiB slobodnog prostora, pa ponovno provjeri prije stvaranja velikih audio cacheova.

Hardver: devet 1,2 m barova `L1 C1 R1 / L2 C2 R2 / L3 C3 R3`; naručene 3 × 5 m 24 V WS2814 RGBWW trake, 24 V napajanja označena 100/300/400 W; planirano pet WLED ESP32-C3 čvorova. Oprema je zadnji put bila u statusu čekanja isporuke. Dvanaest adresabilnih grupa po baru samo je procjena. Fizičko ponašanje, RGBW redoslijed, snaga i Bluetooth sinkronizacija zahtijevaju mjerenje.

Cilj: projekti pjesama/setova, waveform timeline sa slojevima/keyframeovima/beat snapom, lokalna stem i beat analiza, editabilni auto show, pouzdan deterministički preview koji koristi isti završni RGBW frame kao WLED izlaz, kalibracija Bluetootha i blackout. Dovrši softver i simulacijske testove prije zaključka; jasno navedi fizičke provjere koje čekaju opremu.

Kod rada više agenata orkestrator definira ugovore modula, daje svakom agentu mali brief i ne dopušta paralelno uređivanje istih datoteka. Svaki rezultat se integrira i testira.
