const explanations = {
  'workspace-help': 'Pregled svih prečaca tipkovnice i gesta na trackpadu.',
  'project-play': 'Reproduciraj ili pauziraj lokalnu pjesmu. Space radi kada ne uređuješ polje.',
  'project-time': 'Točno vrijeme reprodukcije u sekundama. Upiši vrijednost za skok.',
  'beat-snap': 'Poravnaj premještanje clipova i traženje vremena na ritam.',
  'snap-division': 'Odaberi preciznost poravnanja: cijeli beat ili njegov dio.',
  'timeline-zoom': 'Povuci za glatki zoom timelinea, od cijele pjesme do 32×. Pinch zumira oko pokazivača.',
  'zoom-out': 'Umanji timeline za 25% oko trenutnog položaja reprodukcije. Prečac −.',
  'zoom-in': 'Povećaj timeline za 25% oko trenutnog položaja reprodukcije. Prečac +.',
  'zoom-fit': 'Prikaži cijelu pjesmu na timelineu.',
  'timeline-pan': 'Pomakni vidljivi dio pjesme. Dva prsta lijevo/desno rade isto.',
  'song-timeline': 'Klikni ili povuci po waveformu za odabir mjesta reprodukcije; Play kreće odatle. Povuci clip za premještanje; ⌥ + povuci za pomak. Pinch za zoom.',
  'auto-energy': 'Koliko energičan će biti automatski show. Postojeće clipove ne mijenja.',
  'auto-palette': 'Paleta boja za sljedeće generiranje automatskog showa.',
  'generate-show': 'Iz analize pjesme stvori novi editabilni show. Zamjenjuje trenutni raspored clipova.',
  'add-layer': 'Dodaj sloj iznad postojećih slojeva showa.',
  'add-clip': 'Dodaj clip na trenutnu poziciju reprodukcije u odabrani sloj.',
  'project-offset': 'Kompenzacija kašnjenja Bluetooth zvučnika. Negativna vrijednost pomiče svjetlo kasnije.',
  calibrate: 'Pusti kratki klik i bljesak nakon dvije sekunde za ručno podešavanje audio i svjetlosnog pomaka.',
  'settings-open': 'Mrežne adrese kontrolera, RGBW način i broj fizičkih LED dioda.',
  'save-config': 'Spremi mapiranje i mrežne postavke lokalno.',
  arm: 'Uključi ili isključi slanje kadrova prema WLED kontrolerima.',
  brightness: 'Glavna svjetlina. Nula znači potpuno ugašen izlaz.',
  energy: 'Intenzitet live scene.',
  palette: 'Paleta boja za live scene.',
  speed: 'Brzina animacije aktivne live scene.',
  reactive: 'Pojačaj reakciju live scene na analizirani audio ulaz.',
  'cue-length': 'Koliko taktova traje scena prije automatskog prelaska na sljedeću.',
  go: 'Pokreni pripremljenu scenu na sljedećem beatu.',
  bpm: 'Ručni tempo u beatovima po minuti.',
  tap: 'Klikni najmanje četiri puta u ritmu za ručno određivanje tempa.',
  half: 'Prepolovi trenutnu procjenu tempa.',
  double: 'Udvostruči trenutnu procjenu tempa.',
  'nudge-back': 'Pomakni fazu beata malo ranije.',
  'nudge-next': 'Pomakni fazu beata malo kasnije.',
  'reset-beat': 'Postavi početak takta na trenutni trenutak.',
  'auto-tempo': 'Procijeni tempo iz audio ulaza kada je signal dovoljno jasan.',
  'audio-device': 'Odaberi lokalni audio ulaz, primjerice BlackHole.',
  'audio-start': 'Spoji ili zaustavi odabrani audio ulaz.',
  demo: 'Koristi umjetni ritam za pregled bez mikrofona.',
  offset: 'Ručni vremenski pomak svjetla za live scene.',
  'auto-show': 'Automatski mijenjaj live scene nakon izabranog broja taktova.',
  freeze: 'Zadrži trenutni svjetlosni kadar.',
  blackout: 'Odmah ugasi svjetla i zaustavi izlaz. Esc aktivira blackout.',
  'set-save': 'Spremi označene pjesme u lokalni set.',
  'set-update': 'Ažuriraj naziv i pjesme odabranog seta.',
  'set-delete': 'Ukloni odabrani set; pjesme ostaju u biblioteci.'
};

export function installTooltips() {
  for (const [id, description] of Object.entries(explanations)) {
    const element = document.getElementById(id);
    if (element) element.dataset.tip = description;
  }
  const bubble = document.createElement('div');
  bubble.className = 'control-tooltip'; bubble.id = 'control-tooltip'; bubble.setAttribute('role', 'tooltip');
  document.body.append(bubble);
  let current = null;
  const hide = () => { if (current) current.removeAttribute('aria-describedby'); current = null; bubble.classList.remove('visible'); };
  const show = element => {
    if (!element || element === current) return;
    hide(); current = element; bubble.textContent = element.dataset.tip || element.title;
    if (!bubble.textContent) return hide();
    element.setAttribute('aria-describedby', bubble.id); bubble.classList.add('visible');
    const rect = element.getBoundingClientRect(), width = Math.min(320, Math.max(180, bubble.offsetWidth));
    bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    bubble.style.top = `${rect.bottom + 10 + bubble.offsetHeight > window.innerHeight ? Math.max(8, rect.top - bubble.offsetHeight - 10) : rect.bottom + 10}px`;
  };
  const target = event => event.target?.closest?.('[data-tip],[title]');
  document.addEventListener('pointerover', event => show(target(event)));
  document.addEventListener('pointerout', event => { if (current && !current.contains(event.relatedTarget)) hide(); });
  document.addEventListener('focusin', event => show(target(event)));
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
}
