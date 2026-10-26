# LEDicated — upute za rad na projektu

Ovo je samostalni radni prostor za privatnu aplikaciju **Studio Light**. Najprije pročitaj `RESEARCH_PRODUCT_BLUEPRINT.md`, `README.md`, `layout.json` i `app/README.md`. Aplikacija se nalazi u `app/`; pokreće se s `npm start`, a postojeći testovi s `npm test`. Nastavi postojeći kod i očuvaj funkcionalan WLED/DDP izlaz.

Korisnik radi na ovom MacBooku Pro (Apple M3 Max, 48 GB RAM). Glazbu će povlačiti iz vlastite zbirke, najviše oko 100 pjesama. Probna datoteka je `/Users/timonterzic/Downloads/Sounds.mp3`. Aplikacija ostaje privatna; nisu potrebni računi, cloud, javni katalog ni distribucijski workflow. Uredski zvučnici koriste Bluetooth, stoga je potrebna kalibracija audio/svjetlosnog pomaka. Prvi automatski stil je klupski i energičan. Za početni prikaz dovoljan je shematski raspored 3 × 3.

Planirani fizički raspored ima devet barova `L1 C1 R1 / L2 C2 R2 / L3 C3 R3`, svaki duljine 1,2 m. Trake su naručene kao 24 V WS2814 RGBWW, 60 fizičkih LED/m, a napajanja su označena 100 W, 300 W i 400 W. Oprema je pri posljednjoj korisnikovoj obavijesti čekala isporuku. Procjena od 12 zasebno upravljivih grupa po baru nije potvrđena. Ne proglašavaj fizički rad, boje, potrošnju, sigurnost napajanja ili sinkronizaciju potvrđenima bez testa na stvarnom hardveru.

Naknadno je naručen E8-WiFi Plus V1.01. Za njegov GPIO raspored, napajanje, osam izlaza i fizičke provjere pročitaj [E8_WIFI_PLUS_V1_01.md](E8_WIFI_PLUS_V1_01.md). Aplikacija ima simulacijski testiran profil E8 + C3, uz postojeći profil pet C3 čvorova; `layout.json` i stara spojna shema još su C3 baseline. Fizički rad E8 nije potvrđen.

Lokalni setup u `app/wled-discovery.mjs` sluša Mac Bonjour `_wled._tcp`; server provjerava `/json/info`, uz parove IP + MAC identitet. Promjena DHCP IP-a može se automatski spremiti samo kada je izlaz ugašen i WLED jednoznačno pronađen. `app/daw-output.mjs` prikazuje vodič i mrežni status devet barova, dok su IP/GPIO detalji pod Napredno. Gumb za pojedinačni kratki test šalje slab crveni DDP puls samo nakon korisnikova klika i mrežne provjere. Ne označavaj fizički spoj potvrđenim bez promatranja i mjerenja stvarne trake.

Kod razvoja koristi male, jasne module i zajednički deterministički renderer za preview i izlaz. Kritične funkcije su lokalni uvoz glazbe, analiza stemova i ritma, waveform timeline s keyframeovima i slojevima, editabilni auto show, projektna biblioteka, RGBW pregled svih stvarno adresabilnih grupa, Bluetooth offset te pouzdan blackout. Pazi na prostor na disku: provjera 10. listopada 2026. pokazala je oko 60 GiB slobodnog prostora; nemoj trajno duplicirati sve sirove WAV stemove bez potrebe.

Ako radi više agenata, svaki dobiva mali zadatak, precizne datoteke, ugovor modula i kriterij provjere. Paralelni agenti ne uređuju iste datoteke. Orkestrator pregledava i spaja njihove rezultate te pokreće integracijske i korisničke provjere.
