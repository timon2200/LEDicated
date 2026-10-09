# LEDicated – High-Performance DAW-Grade LED Light Show Controller

Modularna macOS / cross-platform aplikacija za profesionalnu kontrolu LED matrica i traka, s naprednom AI separacijom stemova, višekanalnim timelineom, fotorealističnim previewom i ultra-niskom latencijom.

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

Ovaj dokument opisuje predloženu Tauri arhitekturu; ona još nije implementirana. Postojeća pokretljiva Node/JS aplikacija, testovi i hardversko mapiranje premješteni su u [studio-light-baseline](studio-light-baseline/). Drugi, za konkretnih devet barova prilagođen istraživački plan je [RESEARCH_PRODUCT_BLUEPRINT.md](studio-light-baseline/RESEARCH_PRODUCT_BLUEPRINT.md). Pri razvoju usporediti oba nacrta i sačuvati funkcionalni baseline dok se nova arhitektura ne potvrdi mjerenjem.

Za rad s agentima vidi [AGENTS.md](AGENTS.md) i [ORCHESTRATOR_PROMPT.md](ORCHESTRATOR_PROMPT.md).
