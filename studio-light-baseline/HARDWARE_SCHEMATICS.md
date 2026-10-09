# Spojne sheme hardvera — Studio Varaždin 9-Bar Grid

Verzija: 9. listopada 2026.  
Lokacija centralne kutije: iza bara C1.

---

## 1. Temeljna električna pravila

1. **Zabrana spajanja 24 V na ESP32:**  
   ESP32-C3 radi na 3,3 V interno, a preko pina `5V` podnosi najviše 5,0 V – 5,5 V. Spajanje napona 24 V na bilo koji pin ESP32 nepovratno uništava pločicu.
2. **Zajednička masa (Common GND):**  
   Masa napajanja 24 V (V-), masa ESP32 pločice (G) i masa LED trake (GND) moraju biti fizički spojene. Bez zajedničke mase kontrolni podaci na pinu DI nemaju naponski referentni nivo i traka neće reagirati ili će nekontrolirano treperiti.
3. **Smjer podataka (Data Flow):**  
   WS2814 je jednosmjerna traka. Podaci moraju ulaziti isključivo na oznaku **DI** (Data In) u smjeru strelice otisnute na traci. Spajanje na izlazni kraj (DO - Data Out) ne daje nikakav signal.
4. **Razdvajanje napajanja:**  
   Tri naručena napajanja (100 W, 300 W, 400 W) su zasebne jedinice. Njihovi izlazi +24 V **ne smiju se spajati paralelno**. Za testiranje se koristi 100 W jedinica; za kompletnu instalaciju 9 barova koristi se isključivo 400 W (ili 300 W) jedinica.

---

## 2. Shema 1: Testni stol (Bench Test za 1 bar ili 5 m kolut)

Ova shema služi za trenutnu provjeru jedne ESP32-C3 pločice, 24 V napajanja od 100 W i jedne WS2814 trake.

### Blok dijagram spajanja

```text
 230V AC Mreža
   │  │  │
   L  N  PE (Uzemljenje)
   │  │  │
   ▼  ▼  ▼
┌─────────────────────────┐
│ 24V 100W PSU (Linciaoh) │
│                         │
│  V+ (+24V)     V- (GND) │
└────┬──────────────┬─────┘
     │              │
     │              ├───────────────────────────────────┐
     │              │                                   │ (Zajednički GND)
     ▼              ▼                                   ▼
┌─────────────────────────┐                       ┌───────────┐
│ WS2814 LED Traka (24V)  │                       │ ESP32-C3  │
│                         │                       │ SuperMini │
│ [+24V]    [DI]    [GND] │                       │           │
└────────────▲────────────┘                       │       [G] ◄───┘
             │                                    │           │
             └────────────────────────────────────┤ [GPIO 2]  │
                 Podatkovna linija (Zelena žica)  │           │
                 (preporučeno: otpornik 33-100 Ω) │      [5V] │
                                                  └───────▲───┘
                                                          │
                                                    USB-C kabel
                                                    (s Maca / punjača)
```

### Detaljno ožičenje po točkama:

1. **Mrežno napajanje (230 V AC):**
   - Smeđa (Faza) spojena na stezaljku **L** napajanja.
   - Plava (Nula) spojena na stezaljku **N** napajanja.
   - Žuto-zelena (Uzemljenje) spojena na stezaljku **PE / Earth / Uzemljenje**.
2. **Napajanje LED trake:**
   - Stezaljka **V+** (+24 V) s napajanja ide na **Crvenu žicu (+24 V)** WS2814 trake.
   - Stezaljka **V-** (GND) s napajanja ide na **Bijelu/Crnu žicu (GND)** WS2814 trake.
3. **Referentna masa kontrolera (KLJUČNO):**
   - S iste stezaljke **V-** (GND) vodi se žica na pin označen s **G** na ESP32-C3 ploči.
4. **Upravljački podaci (Data):**
   - Pin **GPIO 2** (oznaka `2` na pločici) spaja se na **Zelenu žicu (DI)** na početku trake.
   - Za kratke spojeve na stolu (< 30 cm) veza radi izravno; za veće udaljenosti postavlja se otpornik od 33 Ω do 100 Ω u seriju s podacima.
5. **Napajanje ESP32-C3:**
   - Tijekom testiranja pločica se napaja putem USB-C kabela spojenog na Mac ili USB punjač.

---

## 3. Shema 2: Puna instalacija za 9 barova (Centralna kutija iza C1)

Kompletna instalacija koristi jedno glavno napajanje od 400 W (ili 300 W), kutiju s rastalnim osiguracima za svaku granu, 24V→5V Step-Down (Buck) pretvarač za logiku te 5 ESP32-C3 čvorova.

### Blok dijagram razvoda

```text
       230V AC
          │
          ▼
┌─────────────────────────┐
│ 24V 400W PSU (ZQQBYY)   │
│  V+ (+24V)     V- (GND) │
└───┬───────────────┬─────┘
    │               │
    ▼               │
┌─────────────────┐ │
│ DC Razvod s     │ │
│ osiguračima     │ │
│ (10 pozicija)   │ │
└───┬─────────────┤ │
    │             │ │
    ├─ Osigurač 1 (3A) ─────────────► Bar L1 (+24V)
    ├─ Osigurač 2 (3A) ─────────────► Bar C1 (+24V)
    ├─ Osigurač 3 (3A) ─────────────► Bar R1 (+24V)
    ├─ Osigurač 4 (3A) ─────────────► Bar L2 (+24V)
    ├─ Osigurač 5 (3A) ─────────────► Bar C2 (+24V)
    ├─ Osigurač 6 (3A) ─────────────► Bar R2 (+24V)
    ├─ Osigurač 7 (3A) ─────────────► Bar L3 (+24V)
    ├─ Osigurač 8 (3A) ─────────────► Bar C3 (+24V)
    ├─ Osigurač 9 (3A) ─────────────► Bar R3 (+24V)
    │                                 Svi barovi GND ◄─── Glavna sabirnica GND (V-)
    │
    └─ Osigurač 10 (1A)
          │
          ▼
   ┌─────────────┐
   │ Buck DC-DC  │
   │ 24V -> 5V   │
   │ (3A modul)  │
   └──────┬──────┘
          │ +5V DC Rail
          ├──────────────────────────┬────────────────────────────┐
          ▼                          ▼                            ▼
    ┌───────────┐              ┌───────────┐                ┌───────────┐
    │ 5x ESP32  │              │ 5V Buffer │                │ Ostala    │
    │ [5V] pin  │              │ SN74AHCT  │                │ logika    │
    └─────┬─────┘              └─────┬─────┘                └───────────┘
          │ 3.3V Logic Data          │
          └──────────────────────────┘
                         │
                         ▼ +5V Buffirani Data izlazi (9 linija)
                         ├─────────► Bar L1 Data (DI)
                         ├─────────► Bar C1 Data (DI)
                         └─────────► ... Bar R3 Data (DI)
```

### Raspodjela barova po ESP32-C3 kontrolerima:

WLED na ESP32-C3 čipu pouzdano podržava **2 neovisna izlaza** po ploči:

| Čvor (WLED Node) | IP / Uloga | Izlaz 1 (GPIO 2) | Izlaz 2 (GPIO 3) |
| :--- | :--- | :--- | :--- |
| **Node C3-A** | Centar gornji | Bar C1 (12 piksela) | Bar C2 (12 piksela) |
| **Node C3-B** | Lijevi gornji | Bar L1 (12 piksela) | Bar L2 (12 piksela) |
| **Node C3-C** | Desni gornji | Bar R1 (12 piksela) | Bar R2 (12 piksela) |
| **Node C3-D** | Donji lijevi/centar | Bar L3 (12 piksela) | Bar C3 (12 piksela) |
| **Node C3-E** | Donji desni | Bar R3 (12 piksela) | Rezerva |

---

## 4. Logički prilagodnik nivoa (Level Shifter 3,3 V na 5 V)

ESP32 radi s logičkim razinama od 3,3 V. WS2814 čip zahtijeva minimalni napon logičke jedinice od približno $0,7 \times 5\,\text{V} = 3,5\,\text{V}$. 

Za siguran prijenos podataka kroz kabele dulje od 1 metra koristi se integrirani krug **SN74AHCT125N**:

```text
                 SN74AHCT125N (Pogled odozgo)
                      ┌───∪───┐
      ESP32 GND ─────┤ 1   14 ├───── +5V (s Buck pretvarača)
ESP32 GPIO 2 (3.3V) ─┤ 2   13 ├───── ESP32 GND
   Na Bar DI (5V) ◄──┤ 3   12 ├───── ESP32 GPIO 3 (3.3V)
      ESP32 GND ─────┤ 4   11 ├──►── Na Bar 2 DI (5V)
                     │  ...   │
                     └────────┘
(Pinovi 1, 4, 10, 13 su Output Enable / OE i spajaju se na GND za trajno aktivne izlaze)
```

Između svakog izlaza čipa 74AHCT125 i kabela koji ide na bar postavlja se otpornik od **33 Ω do 68 Ω** radi prigušenja refleksija signala.

---

## 5. Postavke u WLED sučelju (Config -> LED Preferences)

Za WS2814 RGBW traku u WLED-u upisuju se sljedeći parametri:

- **LED Type:** `SK6812 RGBW`
- **Color Order:** `BRG` (kod WS2814 zeleni i bijeli kanal često zamjenjuju mjesta; potvrditi testom)
- **Swap W and G:** Označiti kvačicom ako bijela pali zelenu i obrnuto
- **Length:**
  - Za jedan bar duljine 1,2 m: `12` (jer 6 fizičkih LED-ica čini 1 adresabilnu grupu, 10 grupa po metru)
  - Za cijeli nerazrezani kolut od 5 m: `50`
- **GPIO:**
  - Izlaz 1: `2`
  - Izlaz 2: `3`
- **Make a segment for each output:** Označiti po želji radi lakšeg testiranja

---

## 6. Kontrolna lista prije puštanja napona

1. Multimetrom u modu zujalice (kontinuitet) provjeriti da nema kratkog spoja između stezaljki +24 V i GND.
2. Provjeriti da +24 V ide isključivo na traku i na ulaz Buck pretvarača, a nikada na pinove ESP32 pločice.
3. Provjeriti da je masa (GND) napajanja spojena na pin G na ESP32.
4. Prije spajanja ESP32 na izlaz Buck pretvarača, multimetrom izmjeriti izlaz Buck pretvarača i podesiti potenciometar točno na 5,0 V.
