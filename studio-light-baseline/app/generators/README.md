# LEDicated Show Generators (`generators/`)

Ovaj direktorij služi za **modularno dijeljenje algoritama i pipeline preseta preko GitHuba**.
Svaka datoteka s nastavkom `.generator.json` u ovom folderu automatski se učitava u **Auto Show & Pipeline Studio** panelu unutar LEDicated DAW-a.

## Kako napraviti i podijeliti vlastiti algoritam (Vibecoding)

1. Otvori **LEDicated DAW** i u donjem docku (ili gornjoj traci) klikni na **`✦ Auto Show`**.
2. Podesi parametre pipelinea:
   - **Detekcija dionica (`detectSections`)**: duljina fraze, RMS/Bass pragovi za Drop, Build nagib, 1-Beat Drop Snap.
   - **Dramaturgija i kontrast (`createAutoShow`)**: strop svjetline izvan dropa (`nonDropCeiling`), W-kanalna disciplina (`drop-only`, `accents-and-drop`, `always`, `never`), Pre-Drop Blackout (`1` ili `2` beata), Beat-1 Blinder, trajanje i brzina stroboskopa, akceleracija spirale u buildu.
   - **Frekvencijski gateovi i 3×3 zone**: Kick Gate (`40–110 Hz`), Snare Gate (`180–450 Hz`), Vocal Follow (`350–3400 Hz`), mapiranje 3×3 zona i 5 slojeva.
3. *(Opcionalno)* Uključi **Vibecode JS Editor**, klikni **`📋 Kopiraj AI Vibecode Prompt`** ili izravno napiši vlastitu funkciju `generateShow(analysis, config, api)`.
4. Klikni **`🌐 Spremi u Git (generators/)`** — aplikacija će spremiti `.generator.json` u ovaj folder, spremno za `git commit` i `git push` ili Pull Request!
