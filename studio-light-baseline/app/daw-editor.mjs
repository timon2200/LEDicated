/** Clip editor (bottom dock): effect, bar targets, colour, audio driver and an
 * interactive envelope editor (the "piano roll" of this app). Edits apply to
 * all selected clips except envelope and timing, which belong to the primary clip.
 */
import { TIMELINE_PRESETS } from './timeline.mjs';
import { BAR_IDS } from './engine.mjs';
import {
  MIN_CLIP_SEC, addKeyframe, beatPosition, clamp, clipEnd, deleteClips, duplicateClips, findClip, moveKeyframe, moveKeyframes, patchClips, removeKeyframe, removeKeyframes, snapTime, splitClip, timeAtBeat,
  toggleTarget
} from './daw-state.mjs';
import { clipUiColor, h, hexToRgb, rgbToHex } from './daw-ui.mjs';
import { PRESET_LABELS } from './daw-playlist.mjs';
import { formatBBT } from './daw-state.mjs';

const GLYPH = {
  wash: '≋', pulse: '◉', columns: '▥', chase: '➤', flash: '✦', wave: '∿',
  strobe: '⚡', sparkle: '✧', spiral: '◎', ripple: '≈', rain: '⤓',
  bounce: '⇅', fire: '🔥', alternate: '⇋', center: '⊕', sweep: '◫'
};
export const PALETTE_SWATCHES = [
  ['Klub', [[.03, .02, .42, 0], [.62, .01, .46, 0], [.02, .62, .85, 0], [0, 0, 0, .48]]],
  ['Žar', [[.45, .02, 0, 0], [.9, .18, .01, 0], [.95, .04, .12, 0], [0, 0, 0, .35]]],
  ['Led', [[0, .18, .55, 0], [0, .52, .8, 0], [.15, .3, .9, 0], [0, 0, 0, .5]]]
];
const SHAPES = {
  flat: { label: 'Ravno', make: d => [[0, 1], [d, 1]] },
  fadeIn: { label: 'Fade in', make: d => [[0, 0], [d, 1]] },
  fadeOut: { label: 'Fade out', make: d => [[0, 1], [d, 0]] },
  triangle: { label: 'Trokut', make: d => [[0, 0], [d / 2, 1], [d, 0]] },
  swell: { label: 'Gradnja', make: d => [[0, .1], [d * .85, 1], [d * .85 + Math.min(.04, d * .05), .15], [d, .15]] }
};

export const BAR_PATTERNS = [
  ['Lijevo', 'Lijeva kolona (L1, L2, L3)', () => ['L1', 'L2', 'L3']],
  ['Centar', 'Srednja kolona (C1, C2, C3)', () => ['C1', 'C2', 'C3']],
  ['Desno', 'Desna kolona (R1, R2, R3)', () => ['R1', 'R2', 'R3']],
  ['Rub', 'Lijevi i desni stupac (I  I)', () => ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']],
  ['Svi', 'Svih 9 barova', () => [...BAR_IDS]],
  ['Križ', 'Centralni križ (C1, L2, C2, R2, C3)', () => ['C1', 'L2', 'C2', 'R2', 'C3']]
];

export const DEVICE_INFO = {
  chase: {
    name: 'Chase Engine',
    tag: 'BEAM & TRAIL',
    glyph: '⚡',
    desc: 'Usmjereni laserski prelet svjetla kroz panele s podesivim profilom zrake i ambijentalnim sjajem.',
    params: [
      {
        key: 'beam',
        title: 'Profil zrake',
        default: 'beam',
        options: [
          ['needle', '⌖ Igla', 'Izrazito tanka točkasta zraka visoke definicije'],
          ['razor', '✦ Žilet', 'Oštar laserski rez srednje širine'],
          ['beam', '━ Zraka', 'Standardni snop s prirodnim padom intenziteta'],
          ['comet', '☄ Komet', 'Dugački kometasti rep s postepenim gašenjem']
        ]
      },
      {
        key: 'glow',
        title: 'Pozadinski sjaj',
        default: 0,
        options: [
          [0, '○ Mrak (0%)', 'Potpuno crna pozadina, samo laser svijetli'],
          [0.15, '◐ Ambijent (15%)', 'Suptilni ambijentalni sjaj neaktivnih segmenata']
        ]
      }
    ]
  },
  strobe: {
    name: 'Strobo Shutter',
    tag: 'HIGH FREQUENCY',
    glyph: '✦',
    desc: 'Visokofrekventni zatvarač za klupski freeze-frame efekt s kontrolom brzine, otvorenosti i simetrije.',
    params: [
      {
        key: 'division',
        title: 'Frekvencija okidanja',
        default: 4,
        options: [
          [2, '½', 'Polovična frekvencija (spori bljesak)'],
          [4, '¼', 'Četvrtinska frekvencija (standardni strobo)'],
          [8, '⅛', 'Osmina (brzi klupski strobo)'],
          [16, '¹/₁₆', 'Šesnaestinka (ekstremna brzina)'],
          [32, '¹/₃₂', 'Ultra blitz frekvencija'],
          ['chaos', '⚡ Kaos', 'Nepravilni aperiodički bljeskovi']
        ]
      },
      {
        key: 'shutter',
        title: 'Otvorenost zatvarača',
        default: 'normal',
        options: [
          ['sharp', '✂ Oštro (15%)', 'Kratki oštri impulsi s dugim crnim intervalima'],
          ['normal', '◒ Balans (25%)', 'Optimalni balans svjetla i tame'],
          ['wide', '◑ Široko (40%)', 'Produženi bljesak za višu percipiranu snagu']
        ]
      },
      {
        key: 'pattern',
        title: 'Raspodjela',
        default: 'all',
        options: [
          ['all', '▦ Svi zajedno', 'Sinkronizirani bljesak svih odabranih panela'],
          ['checker', '⚅ Šahovnica', 'Naizmjenični bljesak parnih i neparnih barova'],
          ['chaos', '🔀 Kaos panela', 'Nasumični raspored bljeskanja po barovima']
        ]
      }
    ]
  },
  fire: {
    name: 'Pyro Flame FX',
    tag: 'TURBULENT DYNAMICS',
    glyph: '🔥',
    desc: 'Fizikalna simulacija organskog plamena s dinamičkim uzgonom i turbulentnim vjetrom.',
    params: [
      {
        key: 'height',
        title: 'Visina plamena',
        default: 'mid',
        options: [
          ['low', ' ▂ Nisko', 'Mali žar i plamičci pri dnu panela'],
          ['mid', ' ▃ Srednje', 'Prirodni plamen do sredine strukture'],
          ['full', ' ▇ Buktinja', 'Visoki jezici vatre koji zahvaćaju cijeli bar']
        ]
      },
      {
        key: 'turbulence',
        title: 'Turbulencija vjetra',
        default: 'normal',
        options: [
          ['calm', '≈ Mirno', 'Stabilno lagano titranje bez jakih udara'],
          ['normal', '∿ Vjetar', 'Prirodni kovitlajući plamen'],
          ['storm', '⚡ Oluja', 'Agresivni udari vatre i pucketanje']
        ]
      }
    ]
  },
  columns: {
    name: 'Column Scan',
    tag: 'MATRIX STEPPER',
    glyph: '▥',
    desc: 'Koračni sekvencer stupaca i redova sinkroniziran s glazbenom mjerom.',
    params: [
      {
        key: 'mode',
        title: 'Način skeniranja',
        default: 'single',
        options: [
          ['single', '▌ Jedan po jedan', 'Svijetli samo trenutno aktivni stupac/red'],
          ['double', '▌▌ Par (dvostruki)', 'Dva susjedna stupca/reda putuju zajedno'],
          ['invert', '░ Inverzno', 'Svi gore osim trenutno odabranog stupca/reda']
        ]
      }
    ]
  },
  wave: {
    name: 'Wave Harmonics',
    tag: 'OSCILLATOR',
    glyph: '∿',
    desc: 'Valni generator harmonijskih oscilacija s promjenom valnog oblika, kuta i gustoće faza.',
    params: [
      {
        key: 'shape',
        title: 'Valni oblik',
        default: 'sine',
        options: [
          ['sine', '∿ Sinus', 'Meki organski harmonijski prijelaz'],
          ['triangle', '⋀ Trokut', 'Linearni uzlaz i silaz s oštrim vrhom'],
          ['saw', '◺ Pila', 'Oštri napad s trenutnim padom intenziteta']
        ]
      },
      {
        key: 'angle',
        title: 'Smjer prostiranja',
        default: 'diag',
        options: [
          ['diag', '⤡ Dijagonala', 'Val putuje dijagonalno kroz matricu'],
          ['horiz', '⇄ Vodoravno', 'Lijevo-desno horizontalno valovanje'],
          ['vert', '⇅ Okomito', 'Gore-dolje vertikalni val']
        ]
      },
      {
        key: 'density',
        title: 'Gustoća vala',
        default: 'med',
        options: [
          ['low', '— Široko', 'Dugački val s jednim vrhom kroz cijelu matricu'],
          ['med', '== Srednje', 'Dvofazni uravnoteženi val'],
          ['high', '≡ Gusto', 'Višestruki zbijeni vrhovi valova']
        ]
      }
    ]
  },
  sparkle: {
    name: 'Sparkle Shimmer',
    tag: 'STOCHASTIC GLINT',
    glyph: '✧',
    desc: 'Stohastičko generiranje svjetlosnih iskri i zvjezdanog sjaja s podesivom gustoćom i oštrinom.',
    params: [
      {
        key: 'density',
        title: 'Gustoća iskri',
        default: 'stars',
        options: [
          ['firefly', '· Krijesnice', 'Rijetke pojedinačne iskre u tami'],
          ['stars', '∴ Zvijezde', 'Prirodno noćno zvjezdano svjetlucanje'],
          ['glitter', '⁙ Svjetlucanje', 'Gusta kiša svjetlosnih kristala']
        ]
      },
      {
        key: 'glint',
        title: 'Oštrina sjaja',
        default: 'crisp',
        options: [
          ['crisp', '✦ Oštro', 'Kristalni trenutni bljesak piksela'],
          ['soft', '✧ Meko', 'Zamućeni topli prijelaz sjaja']
        ]
      }
    ]
  },
  ripple: {
    name: 'Ripple Expander',
    tag: 'RADIAL DISPERSION',
    glyph: '≈',
    desc: 'Radijalni koncentrični valovi koji se šire ili sabijaju iz odabranih žarišnih točaka.',
    params: [
      {
        key: 'origin',
        title: 'Žarište širenja',
        default: 'center',
        options: [
          ['center', '⊙ Sredina (C2)', 'Val izvire iz centralnog panela'],
          ['top', '⊓ Vrh', 'Val izvire iz gornje linije panela'],
          ['bottom', '⊔ Dno', 'Val izvire iz podne linije panela'],
          ['corners', '⛶ Kutovi', 'Valovi istovremeno kreću iz 4 vanjska kuta']
        ]
      },
      {
        key: 'dir',
        title: 'Smjer kretanja',
        default: 'out',
        options: [
          ['out', '↗ Širenje van', 'Val putuje od centra prema rubovima'],
          ['in', '↙ Skupljanje unutra', 'Val se s rubova sabija u centar']
        ]
      },
      {
        key: 'width',
        title: 'Širina fronte',
        default: 'wide',
        options: [
          ['sharp', '━ Oštri brid', 'Tanka precizna laserska fronta'],
          ['wide', '▓ Široki val', 'Duboki difuzni radijalni snop']
        ]
      }
    ]
  },
  rain: {
    name: 'Rain Cascade',
    tag: 'GRAVITY DROPLET',
    glyph: '⤓',
    desc: 'Kaskadni pad svjetlosnih kapljica duž vertikalnih barova s prilagodbom oblika i raspodjele.',
    params: [
      {
        key: 'style',
        title: 'Vrsta kapi',
        default: 'streak',
        options: [
          ['drops', '• Kapi', 'Kratke točkaste kapi s brzim padom'],
          ['streak', '│ Trag', 'Prirodne kišne kapi s rasutim repom'],
          ['beam', '║ Laserski stup', 'Puniji padajući svjetlosni segmenti']
        ]
      },
      {
        key: 'spread',
        title: 'Raspodjela pada',
        default: 'random',
        options: [
          ['random', '∷ Raspršeno', 'Prirodno asinkroni pad po pojedinim barovima'],
          ['sync', '⇉ Sinkronizirano', 'Svi barovi istovremeno propuštaju kapi']
        ]
      }
    ]
  },
  pulse: {
    name: 'Pulse Bio-Rhythm',
    tag: 'MODULATOR',
    glyph: '◉',
    desc: 'Organski i sintetički puls cijelog sustava s kontrolom krivulje napada i noćnog podnožja.',
    params: [
      {
        key: 'curve',
        title: 'Krivulja napada',
        default: 'punch',
        options: [
          ['punch', '⚡ Udarac (Punch)', 'Trenutni oštri skok i eksponencijalni pad'],
          ['breath', '∿ Disanje', 'Simetrični glatki prijelaz poput udaha i izdaha'],
          ['swell', '◢ Nadimanje', 'Polagano dizanje s naglim rezom']
        ]
      },
      {
        key: 'floor',
        title: 'Podnožje (Minimum)',
        default: 0.2,
        options: [
          [0, '○ 0% (Mrak)', 'Potpuno gašenje svjetla u najnižoj točki'],
          [0.2, '◐ 20% (Temelj)', 'Meki noćni sjaj koji održava konturu prostora']
        ]
      }
    ]
  },
  spiral: {
    name: 'Spiral Vortex',
    tag: 'CIRCULAR ROTATION',
    glyph: '◎',
    desc: 'Rotirajući vrtlog duž vanjskog prstena s kontrolom smjera, repa i središnjeg čvorišta.',
    params: [
      {
        key: 'dir',
        title: 'Smjer rotacije',
        default: 'cw',
        options: [
          ['cw', '↻ U smjeru kazaljke', 'Rotacija L1 → C1 → R1 → R3 → L3'],
          ['ccw', '↺ Suprotno od kazaljke', 'Rotacija L1 → L3 → R3 → R1 → C1']
        ]
      },
      {
        key: 'tail',
        title: 'Duljina repa',
        default: 'med',
        options: [
          ['point', '· Točka', 'Jedan svijetli panel koji kruži'],
          ['med', '⤹ Rep', 'Glatki kometasti rep kroz 3-4 panela'],
          ['snake', '〰 Zmija', 'Dugački kontinuirani rotirajući luk']
        ]
      },
      {
        key: 'center',
        title: 'Središnji panel C2',
        default: 'pulse',
        options: [
          ['pulse', '🫀 Pulsira', 'C2 pulsira u ritmu prolaza rotacije'],
          ['off', '○ Ugašen', 'C2 ostaje potpuno taman (oko vrtloga)'],
          ['on', '● Upaljen', 'C2 svijetli kao fiksno sidro u centru']
        ]
      }
    ]
  },
  bounce: {
    name: 'Bounce Kinetic',
    tag: 'BALLISTICS',
    glyph: '⇅',
    desc: 'Kinetičko odbijanje svjetlosnog tijela od rubova instalacije uz odabir osi i fizike gibanja.',
    params: [
      {
        key: 'axis',
        title: 'Os kretanja',
        default: 'horiz',
        options: [
          ['horiz', '⇄ Vodoravno', 'Odbijanje između lijevog (L) i desnog (R) zida'],
          ['vert', '⇅ Okomito', 'Odbijanje između stropa (1) i poda (3)']
        ]
      },
      {
        key: 'physics',
        title: 'Fizika odbijanja',
        default: 'pendulum',
        options: [
          ['pendulum', '⚖ Klatno', 'Glatko usporavanje na rubovima i ubrzanje u sredini'],
          ['elastic', '🎾 Elastično', 'Konstantna brzina s oštrim kinetičkim odskokom']
        ]
      }
    ]
  },
  alternate: {
    name: 'Alternate Matrix',
    tag: 'GEOMETRIC SWITCH',
    glyph: '⇋',
    desc: 'Ritmizirana izmjena komplementarnih geometrijskih uzoraka i vrsta prijelaza.',
    params: [
      {
        key: 'pattern',
        title: 'Uzorak izmjene',
        default: 'checker',
        options: [
          ['checker', '⚅ Šahovnica', 'Kutovi i centar naspram križnih barova'],
          ['rows', '☰ Redovi', 'Izmjena gornjeg, srednjeg i donjeg reda'],
          ['cols', '☱ Stupci', 'Izmjena lijevog, srednjeg i desnog stupca'],
          ['cross', '✚ Križ / Kutovi', 'Izmjena centralnog križa i 4 vanjska kuta']
        ]
      },
      {
        key: 'transition',
        title: 'Prijelaz',
        default: 'cut',
        options: [
          ['cut', '⚡ Oštar rez', 'Trenutni preklop bez među-prijelaza'],
          ['fade', '∿ Meko pretapanje', 'Glatko križno pretapanje svjetla']
        ]
      }
    ]
  },
  flash: {
    name: 'Flash Impact',
    tag: 'TRANSIENT STRIKE',
    glyph: '✦',
    desc: 'Eksplozivni bljesak s podesivim žarištem i fizikalnim vremenom prigušenja.',
    params: [
      {
        key: 'focus',
        title: 'Žarište bljeska',
        default: 'center',
        options: [
          ['center', '🎯 Centar (C2)', 'Glavni udar u sredini s padom prema rubu'],
          ['all', '💥 Svi paneli', 'Istovremeni maksimalni udar na cijeloj sceni'],
          ['edges', '🔲 Rubovi', 'Udar duž vanjskog okvira s tamnim centrom']
        ]
      },
      {
        key: 'decay',
        title: 'Brzina raspada',
        default: 'fast',
        options: [
          ['instant', '⚡ Trenutno (50ms)', 'Nagli laserski udar'],
          ['fast', '◒ Brzo (150ms)', 'Prirodni bljesak stroboskopa'],
          ['slow', '🌘 Polagano (400ms)', 'Topli fosforni pad svjetla']
        ]
      }
    ]
  },
  center: {
    name: 'Center Spot',
    tag: 'FOCUS APERTURE',
    glyph: '⊕',
    desc: 'Središnje žarište pozornice s geometrijskim širenjem na susjedne barove i modulacijom.',
    params: [
      {
        key: 'geometry',
        title: 'Geometrija fokusa',
        default: 'cross',
        options: [
          ['solo', '⊙ Samo centar', 'Svijetli isključivo središnji bar C2'],
          ['cross', '✚ Križ', 'Središnji bar C2 + križ (C1, L2, R2, C3)'],
          ['iris', '🔲 Iris blenda', 'Postepeno prstenasto širenje iz centra']
        ]
      },
      {
        key: 'breathe',
        title: 'Modulacija',
        default: false,
        options: [
          [false, '— Statično', 'Fiksna jačina bez modulacije'],
          [true, '🫀 Pulsirajuće', 'Suptilno pulsiranje svjetla u centru']
        ]
      }
    ]
  },
  sweep: {
    name: 'Radar Sweep',
    tag: 'OPTICAL SCAN',
    glyph: '◫',
    desc: 'Optički snop koji pretražuje prostor poput radara ili reflektora.',
    params: [
      {
        key: 'style',
        title: 'Stil pretraživanja',
        default: 'radar',
        options: [
          ['radar', '🧭 Radar', 'Rotirajući radarski snop oko centra C2'],
          ['horiz', '⇄ Vodoravni snop', 'Linearni prelet s lijeva nadesno'],
          ['vert', '⇅ Vertikalni snop', 'Linearni prelet odozgo prema dolje']
        ]
      },
      {
        key: 'width',
        title: 'Širina snopa',
        default: 'laser',
        options: [
          ['laser', '━ Laserski nož', 'Oštri uski snop visoke definicije'],
          ['fan', '◢ Lepeza', 'Široki difuzni kut osvjetljenja']
        ]
      }
    ]
  },
  wash: {
    name: 'Wash Ambience',
    tag: 'ATMOSPHERIC FIELD',
    glyph: '≋',
    desc: 'Meki atmosferični ambijentalni ton s organskim disanjem i prelijevanjem boja.',
    params: [
      {
        key: 'mood',
        title: 'Karakter ambijenta',
        default: 'drift',
        options: [
          ['drift', '≋ Lebdeći', 'Spora asimetrična dinamika prelijevanja'],
          ['breath', '🫀 Disanje', 'Meko harmonijsko pulsiranje cjelokupnog prostora'],
          ['still', '— Statični sjaj', 'Konstantno mirno osvjetljenje s blagim naglaskom centra']
        ]
      }
    ]
  }
};

export function createClipEditor(host, ctx) {
  const { store } = ctx;
  const s = {
    drag: null,
    hoverKey: -1,
    selectedKeys: new Set(),
    marquee: null,
    pendingExclusiveClick: -1,
    lastClipId: null
  };
  const propsBox = h('div', { class: 'ce-props' });
  const canvas = h('canvas', { class: 'ce-canvas', tabIndex: 0, 'aria-label': 'Envelope clipa: povuci točke, označi pravokutnikom, dvaput klikni za novu, ⌫ ili desni klik za brisanje' });
  const shapeBar = h('div', { class: 'ce-shapes' });
  const info = h('div', { class: 'ce-info' });
  const delKeysBtn = h('button', {
    type: 'button',
    class: 'mini-btn danger ce-del-keys',
    style: { display: 'none' },
    title: 'Obriši odabrane točke (Backspace / Delete)',
    onClick: () => deleteSelected()
  }, 'Obriši točke');
  host.append(propsBox);
  (ctx.envHost || host).append(h('div', { class: 'ce-env' }, h('div', { class: 'ce-env-head' }, h('span', { class: 'ce-title' }, 'ENVELOPE'), shapeBar, delKeysBtn, info), canvas));

  const tl = () => store.timeline;
  const refs = () => ctx.getSelection().filter(ref => findClip(tl(), ref));
  const primary = () => { const ref = refs()[0]; return ref ? findClip(tl(), ref) : null; };
  const ensurePlayheadInClip = clip => {
    if (!ctx.seek || !clip) return;
    const cur = ctx.getTime();
    if (cur < clip.startSec || cur >= clipEnd(clip)) {
      ctx.seek(clip.startSec + Math.min(0.05, clip.durationSec / 2));
    }
  };
  const apply = (label, patch) => {
    const list = refs();
    if (!list.length) return;
    store.commit(label, t => patchClips(t, list, patch));
    const hit = primary();
    if (hit) ensurePlayheadInClip(hit.clip);
  };

  function updateHeader() {
    const count = s.selectedKeys.size;
    if (delKeysBtn) {
      delKeysBtn.style.display = count > 0 ? '' : 'none';
      delKeysBtn.textContent = count > 1 ? `Obriši točke (${count})` : 'Obriši točku';
      delKeysBtn.title = count > 1 ? `Obriši ${count} odabranih točaka (Backspace / Delete)` : 'Obriši odabranu točku (Backspace / Delete)';
    }
    if (count > 0) {
      info.textContent = count > 1 ? `${count} točaka odabrano · ⌫ za brisanje, povuci za pomak` : '1 točka odabrana · ⌫ za brisanje, povuci za pomak';
    } else {
      const list = refs(), hit = primary();
      if (!hit) {
        info.textContent = '';
      } else {
        const multi = list.length > 1;
        info.textContent = multi ? `${list.length} clipova odabrano · envelope se uređuje na prvom` : `${hit.layer.name || hit.layer.id}`;
      }
    }
  }

  function deleteSelected() {
    const hit = primary(); if (!hit || !s.selectedKeys.size) return;
    const ref = refs()[0];
    store.commit('Obriši keyframeove', t => {
      removeKeyframes(findClip(t, ref).clip, [...s.selectedKeys]);
    });
    s.selectedKeys.clear();
    s.hoverKey = -1;
    render();
  }

  /* ---------------------------------------------------------- properties */
  function render() {
    const list = refs(), hit = primary();
    propsBox.replaceChildren(); shapeBar.replaceChildren();
    if (!hit) {
      propsBox.append(h('div', { class: 'empty' }, h('b', {}, 'Nema odabranog clipa'), h('p', {}, 'Klikni clip u playlistu ili ga nacrtaj alatom Crtaj (1). Dvaput klikni prazno mjesto u traci za novi clip.')));
      s.selectedKeys.clear(); s.hoverKey = -1; s.lastClipId = null;
      updateHeader(); draw(); return;
    }
    const clip = hit.clip;
    if (clip.id !== s.lastClipId) {
      s.lastClipId = clip.id;
      s.selectedKeys.clear();
      s.hoverKey = -1;
    } else {
      const maxLen = clip.keyframes.length;
      for (const idx of s.selectedKeys) {
        if (idx >= maxLen) s.selectedKeys.delete(idx);
      }
    }
    const multi = list.length > 1;
    updateHeader();

    // 1. Top bar: Effect Chips (left) + Dedicated Device Rack (right)
    const effectSelector = h('div', { class: 'ce-fx-selector' },
      h('label', {}, 'Efekt'),
      h('div', { class: 'chips' }, TIMELINE_PRESETS.map(p =>
        h('button', {
          type: 'button',
          class: clip.preset === p ? 'chip on' : 'chip',
          'aria-pressed': String(clip.preset === p),
          title: `Efekt: ${PRESET_LABELS[p] || p}`,
          onClick: () => {
            apply('Efekt', { preset: p });
            ensurePlayheadInClip(clip);
          }
        }, h('span', {}, GLYPH[p] || '•'), PRESET_LABELS[p] || p)
      ))
    );
    const topBar = h('div', { class: 'ce-top-bar' }, effectSelector, effectDeviceRack(clip));

    // 2. Bottom Row: 4 modular cards
    const speedCard = h('div', { class: 'ce-card ce-speed-card' }, speedSection(clip, list, multi));
    const barsCard = h('div', { class: 'ce-card ce-bars-card' }, barPicker(clip));

    const color = h('input', { type: 'color', value: rgbToHex(clip.color), 'aria-label': 'Boja clipa' });
    color.addEventListener('input', () => { store.begin(); store.update(t => patchClips(t, refs(), { color: [...hexToRgb(color.value), clip.color[3]] })); store.end('Boja'); });
    const white = h('input', { type: 'range', min: 0, max: 100, value: Math.round(clip.color[3] * 100), 'aria-label': 'Bijeli kanal', title: 'Neovisna jačina toplog bijelog emitera' });
    white.addEventListener('pointerdown', () => store.begin());
    white.addEventListener('input', () => store.update(t => patchClips(t, refs(), { color: [...clip.color.slice(0, 3), Number(white.value) / 100] })));
    white.addEventListener('change', () => store.end('Bijeli kanal'));
    const swatches = h('div', { class: 'swatches' }, PALETTE_SWATCHES.flatMap(([name, colors]) => colors.map((c, i) => {
      const [r, g, b] = clipUiColor(c);
      return h('button', { type: 'button', class: 'swatch', title: `${name} ${i + 1}`, 'aria-label': `Paleta ${name} ${i + 1}`, style: { background: `rgb(${r},${g},${b})` }, onClick: () => apply('Boja', { color: c }) });
    })));
    const colorCard = h('div', { class: 'ce-card ce-color-card' },
      h('div', { class: 'ce-section' }, h('label', {}, 'Boja'), h('div', { class: 'color-row' }, color, h('span', {}, 'W'), white), swatches),
      driverSummary(clip)
    );

    const actionsRow = h('div', { class: 'ce-actions' },
      h('button', { type: 'button', onClick: () => { let created; store.commit('Dupliciraj', t => { const end = Math.max(...list.map(r => clipEnd(findClip(t, r).clip))), start = Math.min(...list.map(r => findClip(t, r).clip.startSec)); created = duplicateClips(t, list, end - start, 0); }); ctx.select(created); } }, 'Dupliciraj ⌘D'),
      h('button', { type: 'button', onClick: () => { let parts; store.commit('Podijeli', t => { parts = splitClip(t, list[0], ctx.getTime()); }); if (parts) ctx.select(parts); else ctx.status('Postavi playhead unutar clipa za podjelu.'); } }, 'Podijeli'),
      h('button', { type: 'button', class: 'danger', onClick: () => { store.commit('Obriši', t => deleteClips(t, list)); ctx.select([]); } }, 'Obriši ⌫')
    );
    const timingCard = h('div', { class: 'ce-card ce-timing-card' },
      timingSection(clip, list, multi),
      actionsRow
    );

    const bottomRow = h('div', { class: 'ce-bottom-row' }, speedCard, barsCard, colorCard, timingCard);

    propsBox.append(topBar, bottomRow);

    for (const [key, shape] of Object.entries(SHAPES)) shapeBar.append(h('button', { type: 'button', class: 'mini-btn', title: `Oblik envelopea: ${shape.label}`, onClick: () => applyShape(shape.make(clip.durationSec)) }, shape.label));
    shapeBar.append(h('button', { type: 'button', class: 'mini-btn', title: 'Pad svjetla na svakom beatu unutar clipa', onClick: () => applyShape(beatPulse(clip)) }, 'Beat puls'));
    draw();
  }

  /* --------------------------------------------------- effect device rack */
  function effectDeviceRack(clip) {
    const info = DEVICE_INFO[clip.preset];
    if (!info) return h('div', { class: 'dev-rack-empty' });

    const curParams = clip.params || {};

    const header = h('div', { class: 'dev-header' },
      h('div', { class: 'dev-title-box' },
        h('span', { class: 'dev-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'dev-glyph' }, info.glyph),
        h('span', { class: 'dev-name' }, info.name),
        h('span', { class: 'dev-badge' }, info.tag),
        h('button', {
          type: 'button',
          class: 'dev-play-btn',
          title: 'Vrti petlju preko odabranog clipa dok namještaš postavke',
          onClick: (e) => {
            e.stopPropagation();
            if (ctx.loopClip) ctx.loopClip(clip);
          }
        }, '▶ Pregledaj clip')
      ),
      h('div', { class: 'dev-desc' }, info.desc)
    );

    const groups = (info.params || []).map(group => {
      const activeVal = curParams[group.key] !== undefined ? curParams[group.key] : group.default;
      const btnRow = h('div', { class: 'dev-btn-row', role: 'group', 'aria-label': group.title },
        group.options.map(([optVal, optLabel, optTip]) => {
          const isSelected = activeVal === optVal;
          return h('button', {
            type: 'button',
            class: `dev-btn${isSelected ? ' on' : ''}`,
            'aria-pressed': String(isSelected),
            title: optTip,
            onClick: () => {
              apply(`Postavka: ${group.title}`, { params: { [group.key]: optVal } });
              ensurePlayheadInClip(clip);
            }
          }, optLabel);
        })
      );
      return h('div', { class: 'dev-group' },
        h('div', { class: 'dev-group-title' }, group.title),
        btnRow
      );
    });

    const body = h('div', { class: 'dev-body' }, groups);
    return h('div', { class: 'dev-rack', 'data-preset': clip.preset }, header, body);
  }

  /* --------------------------------------------------------- speed / motion */
  function speedSection(clip, list, multi) {
    const curSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
    const isChase = clip.preset === 'chase';

    const fmtSpeed = s => {
      if (s >= 8) return `${s}× ⚡ Blitz`;
      if (s >= 4) return `${s}× ✦ Laser`;
      return `${s}×`;
    };

    const counter = h('span', { class: 'speed-val' }, fmtSpeed(curSpeed));
    const slider = h('input', {
      type: 'range', min: '0.25', max: '16', step: '0.25', value: String(curSpeed),
      'aria-label': 'Brzina efekta', title: 'Brzina efekta (0.25× do 16×)'
    });
    slider.addEventListener('pointerdown', () => store.begin());
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      counter.textContent = fmtSpeed(val);
      store.update(t => patchClips(t, refs(), { speed: val }));
    });
    slider.addEventListener('change', () => store.end('Brzina'));

    const PRESET_SPEEDS = [
      [0.5, '0.5×', 'Sporo (0.5×)'],
      [1, '1×', 'Normalno (1×)'],
      [2, '2×', 'Dvostruko (2×)'],
      [4, '4×', 'Laser brzo (4×)'],
      [8, '⚡ 8× Blitz', 'Blitz laser prelet (8×)'],
      [16, '16×', 'Ultra blitz laser (16×)']
    ];

    const btnRow = h('div', { class: 'sp-btn-row', role: 'group', 'aria-label': 'Predlošci brzine' }, PRESET_SPEEDS.map(([val, lbl, tip]) => {
      const on = Math.abs(curSpeed - val) < 0.05;
      const isBlitz = val >= 8;
      return h('button', {
        type: 'button',
        class: `sp-btn${on ? ' on' : ''}${isBlitz ? ' blitz' : ''}`,
        'aria-pressed': String(on),
        title: tip,
        onClick: () => apply('Brzina', { speed: val })
      }, lbl);
    }));

    const curMode = (clip.motionMode === 'sync' || clip.chaseMode === 'syncRow') ? 'syncRow' :
                    (clip.direction === 'ttb' || clip.chaseMode === 'col') ? 'col' : 'row';

    const chaseWrap = h('div', { class: 'chase-mode-wrap' });
    if (isChase) {
      const CHASE_MODES = [
        ['row', 'Kroz red (L→R)', 'Trkač prolazi vodoravno kroz cijeli red: L → C → R bez praznog hoda'],
        ['syncRow', 'Sinkro redovi', 'Laserski zid: svi odabrani redovi prolaze istovremeno s lijeva nadesno'],
        ['col', 'Kroz stupce', 'Klasični trkač kroz stupce od vrha prema dnu']
      ];
      chaseWrap.append(
        h('span', { class: 'sub-label' }, 'Trasa / Smjer trkača'),
        h('div', { class: 'sp-btn-row', role: 'group', 'aria-label': 'Trasa trkača' }, CHASE_MODES.map(([mId, mLbl, mTip]) =>
          h('button', {
            type: 'button',
            class: `sp-btn${curMode === mId ? ' on' : ''}`,
            'aria-pressed': String(curMode === mId),
            title: mTip,
            onClick: () => {
              if (mId === 'syncRow') apply('Trasa trkača', { chaseMode: 'syncRow', direction: 'ltr', motionMode: 'sync' });
              else if (mId === 'col') apply('Trasa trkača', { chaseMode: 'col', direction: 'ttb', motionMode: 'serial' });
              else apply('Trasa trkača', { chaseMode: 'row', direction: 'ltr', motionMode: 'serial' });
            }
          }, mLbl)
        )),
        h('small', { class: 'drv-note' },
          curMode === 'row' ? 'Laser prolazi redom (L → C → R) glatko kroz cijeli red.' :
          curMode === 'syncRow' ? 'Sinkronizirani laserski prelet kroz sve odabrane redove odjednom.' :
          'Prolaz kroz stupce: L1 → L2 → L3 → C1... od vrha do dna.'
        )
      );
    }

    return h('div', { class: 'ce-section' },
      h('label', {}, 'Brzina ', counter),
      h('div', { class: 'speed-slider-row' }, slider),
      btnRow,
      isChase ? chaseWrap : null
    );
  }

  /* ------------------------------------------------------------ bar picker */
  const TIMING_OPTIONS = [
    ['half', '½', '½ doba', 'Brzi puls: pola beata'],
    ['beat', '♩ 1', '1 doba', 'Svaka doba (1 beat)'],
    ['bar', '| 1', '1 takt', 'Svaki takt (4 dobe)'],
    ['2bar', '|| 2', '2 takta', 'Svaki drugi takt (8 doba)'],
    ['4bar', '|||| 4', '4 takta', 'Svaka 4 takta (16 doba)']
  ];

  const MOTION_MODES = [
    ['serial', '⤳ Pojedinačno', 'Trkač prolazi panel po panel u nizu duž staze'],
    ['sync', '⇉ Svi odjednom', 'Laserski zid: svi odabrani paneli u liniji prolaze istovremeno']
  ];

  function barPicker(clip) {
    const selected = () => clip.targets === 'all' ? [...BAR_IDS] : [...clip.targets];
    const commit = ids => apply('Barovi', { targets: ids.length ? ids : 'all' });
    const [r, g, b] = clipUiColor(clip.color);
    const cells = new Map();
    const COLS = ['L', 'C', 'R'];
    const curDir = clip.direction || (clip.chaseMode === 'col' ? 'ttb' : 'ltr');
    const curTiming = clip.timing || 'beat';
    const curMotion = clip.motionMode || (clip.chaseMode === 'syncRow' ? 'sync' : 'serial');

    const grid = h('div', { class: 'bp-grid', role: 'group', 'aria-label': 'Barovi na koje clip djeluje' });
    grid.append(h('button', { type: 'button', class: 'bp-corner', title: 'Odaberi svih 9 barova', onClick: () => commit([...BAR_IDS]) }, 'svi'));
    COLS.forEach((c, ci) => grid.append(h('button', { type: 'button', class: 'bp-head', title: `Cijela kolona ${c} (Shift dodaje)`, onClick: e => { const col = BAR_IDS.filter((_, i) => i % 3 === ci); commit(e.shiftKey ? [...new Set([...selected(), ...col])] : col); } }, c)));
    let draft = null, paint = true;
    const patternBtns = [];
    const patterns = h('div', { class: 'bp-patterns', role: 'group', 'aria-label': 'Predlošci barova' },
      BAR_PATTERNS.map(([label, title, make]) => {
        const btn = h('button', { type: 'button', class: 'mini-btn', title, onClick: () => commit(make(selected())) }, label);
        patternBtns.push({ make, btn });
        return btn;
      })
    );
    const show = ids => {
      for (const [id, el] of cells) {
        const on = ids.includes(id);
        el.classList.toggle('on', on);
        el.setAttribute('aria-pressed', String(on));
      }
      counter.textContent = `${ids.length}/9`;
      patternBtns.forEach(({ make, btn }) => {
        const target = make(ids);
        const on = Array.isArray(target) && target.length === ids.length && target.every(id => ids.includes(id));
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    const counter = h('span', { class: 'bp-count' }, '');
    for (let row = 0; row < 3; row++) {
      grid.append(h('button', { type: 'button', class: 'bp-head', title: `Cijeli red ${row + 1} (Shift dodaje)`, onClick: e => { const rw = BAR_IDS.filter((_, i) => Math.floor(i / 3) === row); commit(e.shiftKey ? [...new Set([...selected(), ...rw])] : rw); } }, String(row + 1)));
      for (let col = 0; col < 3; col++) {
        const id = BAR_IDS[row * 3 + col];
        const cell = h('button', { type: 'button', class: 'bp-cell', title: `Bar ${id}. Klik = uključi/isključi, Shift+klik = samo ovaj, povuci za bojanje`, style: { '--bar-color': `rgb(${r},${g},${b})` } }, id);
        cell.addEventListener('pointerdown', e => {
          if (e.button !== 0) return; e.preventDefault();
          if (e.shiftKey) { commit([id]); return; }
          draft = selected(); paint = !draft.includes(id);
          draft = paint ? [...draft, id] : draft.filter(x => x !== id); show(draft);
          addEventListener('pointerup', () => { if (!draft) return; const out = BAR_IDS.filter(x => draft.includes(x)); draft = null; commit(out); }, { once: true });
        });
        cell.addEventListener('pointerover', e => {
          if (!draft || e.buttons !== 1) return;
          draft = paint ? [...new Set([...draft, id])] : draft.filter(x => x !== id); show(draft);
        });
        cells.set(id, cell); grid.append(cell);
      }
    }
    show(selected());

    const arrowBtn = (dir, glyph, title, cls) => h('button', {
      type: 'button',
      class: `dir-arrow ${cls}${curDir === dir ? ' on' : ''}`,
      'aria-pressed': String(curDir === dir),
      'aria-label': `Smjer ${title}`,
      title: `Smjer kretanja: ${title}`,
      onClick: () => apply('Smjer animacije', { direction: dir })
    }, glyph);

    const compassBox = h('div', { class: 'bp-compass-box' },
      h('div', { class: 'dir-row-top' }, arrowBtn('btt', '▲', 'Prema gore (odozdo prema vrhu)', 'top')),
      h('div', { class: 'dir-mid-row' },
        arrowBtn('rtl', '◀', 'Ulijevo (zdesna nalijevo)', 'left'),
        grid,
        arrowBtn('ltr', '▶', 'Udesno (slijeva nadesno)', 'right')
      ),
      h('div', { class: 'dir-row-bottom' }, arrowBtn('ttb', '▼', 'Prema dolje (odozgo prema dnu)', 'bottom'))
    );

    const timingGroup = h('div', { class: 'anim-ctl-group' },
      h('span', { class: 'anim-ctl-label' }, 'Tajmiranje'),
      h('div', { class: 'anim-toggle-row timing', role: 'group', 'aria-label': 'Tajmiranje animacije' }, TIMING_OPTIONS.map(([tKey, tIcon, tLbl, tTip]) =>
        h('button', {
          type: 'button',
          class: `anim-toggle${curTiming === tKey ? ' on' : ''}`,
          'aria-pressed': String(curTiming === tKey),
          title: tTip,
          onClick: () => apply('Tajmiranje', { timing: tKey })
        }, tLbl)
      ))
    );

    const motionGroup = h('div', { class: 'anim-ctl-group' },
      h('span', { class: 'anim-ctl-label' }, 'Izvođenje animacije'),
      h('div', { class: 'anim-toggle-row motion', role: 'group', 'aria-label': 'Način izvođenja animacije' }, MOTION_MODES.map(([mKey, mLbl, mTip]) =>
        h('button', {
          type: 'button',
          class: `anim-toggle${curMotion === mKey ? ' on' : ''}`,
          'aria-pressed': String(curMotion === mKey),
          title: mTip,
          onClick: () => apply('Način izvođenja', { motionMode: mKey })
        }, mLbl)
      ))
    );

    const sideControls = h('div', { class: 'bp-side-controls' }, timingGroup, motionGroup);

    return h('div', { class: 'ce-section wide' },
      h('label', {}, 'Barovi i kretanje ', counter),
      h('div', { class: 'bp-stage-wrap' },
        h('div', { class: 'bp-main-col' }, compassBox, patterns),
        sideControls
      )
    );
  }

  /* --------------------------------------------------------- driver summary */
  const STEM_NAMES = { drums: 'Bubnjevi', bass: 'Bas', vocals: 'Vokal', other: 'Ostalo' };
  function driverSummary(clip) {
    const fmt = hz => hz >= 1000 ? `${(hz / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(hz)}`;
    const text = clip.driver === 'none' ? 'Bez drivera: clip svijetli stalno.'
      : clip.driver === 'band' ? `${fmt(clip.band.lowHz)}–${fmt(clip.band.highHz)} Hz · prag ${Math.round(clip.band.threshold * 100)}% · ${clip.band.mode === 'gate' ? 'okidač' : 'prati razinu'} · jačina ${Math.round(clip.driverGain * 100)}%`
        : `${STEM_NAMES[clip.driver] || clip.driver} (stem pojas) · jačina ${Math.round(clip.driverGain * 100)}%`;
    return h('div', { class: 'ce-section' }, h('label', {}, 'Audio driver'), h('div', { class: 'drv-summary' }, text),
      h('div', { class: 'ce-actions' },
        h('button', { type: 'button', class: 'mini-btn primary', onClick: () => { if (clip.driver === 'none') apply('Audio driver', { driver: 'band' }); ctx.openDriver?.(); } }, clip.driver === 'none' ? 'Dodaj EQ driver' : 'Uredi driver (EQ)'),
        clip.driver !== 'none' && h('button', { type: 'button', class: 'mini-btn', onClick: () => apply('Audio driver', { driver: 'none' }) }, 'Ukloni')));
  }

  /* ---------------------------------------------------------------- timing */
  function setDuration(list, d, total) {
    store.commit('Trajanje', t => { const c = findClip(t, list[0]).clip; d = clamp(d, MIN_CLIP_SEC, Math.max(MIN_CLIP_SEC, total - c.startSec)); const last = c.keyframes.at(-1).value; c.keyframes = c.keyframes.filter(k => k.timeSec < d - .005); c.keyframes.push({ timeSec: d, value: last }); c.durationSec = d; });
  }
  function timingSection(clip, list, multi) {
    const total = ctx.duration(), t = tl(), a = ctx.getAnalysis();
    const p0 = beatPosition(clip.startSec, t, a), p1 = beatPosition(clipEnd(clip), t, a), beats = p1 - p0, bars = beats / 4;
    const num = (label, title, value, change) => {
      const input = h('input', { type: 'number', step: .01, min: 0, value: value.toFixed(2), disabled: multi, 'aria-label': label, title });
      input.addEventListener('change', () => change(Number(input.value))); return h('label', { class: 'num', title }, label, input);
    };
    const barsFor = n => () => { const target = timeAtBeat(p0 + 4 * n, t, a) - clip.startSec; setDuration(list, target, total); };
    const strip = h('div', { class: 'pos-strip', title: 'Položaj clipa u cijeloj pjesmi' }, h('i', { style: { left: `${clamp(clip.startSec / total, 0, 1) * 100}%`, width: `${Math.max(0.6, clip.durationSec / total * 100)}%` } }));
    return h('div', { class: 'ce-section wide' }, h('label', {}, 'Položaj u pjesmi'),
      strip,
      h('div', { class: 'ce-section two' },
        num('Počinje (s)', 'Sekunda pjesme u kojoj clip počinje', clip.startSec, v => store.commit('Početak', tt => { findClip(tt, list[0]).clip.startSec = clamp(snapTime(v, ctx.getSnap(), tt, ctx.getAnalysis()), 0, total); })),
        num('Traje (s)', 'Koliko sekundi clip ostaje aktivan', clip.durationSec, v => setDuration(list, v, total))),
      h('div', { class: 'timing-read' }, h('span', {}, `Počinje na ${formatBBT(Math.max(0, p0))}`), h('span', {}, `Traje ${beats.toFixed(beats % 1 ? 1 : 0)} dobi · ${bars.toFixed(bars % 1 ? 2 : 0)} ${bars === 1 ? 'takt' : 'taktova'}`)),
      !multi && h('div', { class: 'bp-patterns' }, h('span', { class: 'mini-label' }, 'Traje:'), [[0.25, '1 beat'], [1, '1 takt'], [2, '2'], [4, '4'], [8, '8'], [16, '16']].map(([n, l]) => h('button', { type: 'button', class: 'mini-btn', title: `Postavi trajanje na ${l === '1 beat' ? '1 beat' : l + ' takta'}`, onClick: barsFor(n) }, l)),
        h('button', { type: 'button', class: 'mini-btn', title: 'Produži do kraja pjesme', onClick: () => setDuration(list, total - clip.startSec, total) }, 'do kraja')));
  }

  function beatPulse(clip) {
    const t = tl(), a = ctx.getAnalysis(), keys = [];
    const p0 = Math.ceil(beatPosition(clip.startSec, t, a) - 1e-6);
    for (let p = p0, n = 0; n < 64; p++, n++) {
      const start = timeAtBeat(p, t, a) - clip.startSec, next = timeAtBeat(p + 1, t, a) - clip.startSec;
      if (start >= clip.durationSec - .02) break;
      keys.push([Math.max(0, start), 1], [Math.min(clip.durationSec - .01, start + (next - start) * .85), .12]);
    }
    return keys.length >= 2 ? [[0, keys[0][0] > 0 ? .12 : 1], ...keys.filter((k, i) => !(i === 0 && k[0] === 0)), [clip.durationSec, .12]] : [[0, 1], [clip.durationSec, 1]];
  }

  function applyShape(points) {
    const ref = refs()[0]; if (!ref) return;
    s.selectedKeys.clear();
    s.hoverKey = -1;
    const clean = []; for (const [timeSec, value] of points) if (!clean.length || timeSec > clean.at(-1).timeSec + .004) clean.push({ timeSec, value }); else clean.at(-1).value = value;
    store.commit('Oblik envelopea', t => { findClip(t, ref).clip.keyframes = clean; });
    updateHeader();
  }

  /* ----------------------------------------------------------- envelope */
  const pad = { l: 34, r: 14, t: 12, b: 20 };
  const geometry = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const toX = (clip, t, w) => pad.l + t / clip.durationSec * (w - pad.l - pad.r);
  const toY = (v, hh) => pad.t + (1 - v) * (hh - pad.t - pad.b);
  const fromX = (clip, x, w) => (x - pad.l) / (w - pad.l - pad.r) * clip.durationSec;
  const fromY = (y, hh) => 1 - (y - pad.t) / (hh - pad.t - pad.b);

  function draw() {
    const { w, h: hh } = geometry(), dpr = devicePixelRatio || 1;
    if (!w || !hh) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b1017'; g.fillRect(0, 0, w, hh);
    const hit = primary();
    if (!hit) { g.fillStyle = '#566474'; g.font = '12px system-ui'; g.fillText('Odaberi clip za uređivanje envelopea.', 18, hh / 2); return; }
    const clip = hit.clip, a = ctx.getAnalysis(), t = tl();
    g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    for (const v of [0, .25, .5, .75, 1]) { const y = toY(v, hh); g.fillStyle = v === 0 || v === 1 ? '#ffffff26' : '#ffffff10'; g.fillRect(pad.l, Math.round(y), w - pad.l - pad.r, 1); g.fillStyle = '#6b7a8a'; g.fillText(`${Math.round(v * 100)}`, 6, y); }
    // beat grid within the clip
    const p0 = Math.floor(beatPosition(clip.startSec, t, a)), p1 = Math.ceil(beatPosition(clipEnd(clip), t, a));
    if (p1 - p0 <= 160) for (let p = p0; p <= p1; p++) {
      const local = timeAtBeat(p, t, a) - clip.startSec; if (local < 0 || local > clip.durationSec) continue;
      const x = Math.round(toX(clip, local, w)), bar = ((p % 4) + 4) % 4 === 0;
      g.fillStyle = bar ? '#ffffff2a' : '#ffffff10'; g.fillRect(x, pad.t, 1, hh - pad.t - pad.b);
      if (bar) { g.fillStyle = '#6b7a8a'; g.fillText(`${Math.floor(p / 4) + 1}`, x + 3, hh - 8); }
    }
    // driver overlay
    if (clip.driver !== 'none' && a?.features?.[clip.driver]) {
      const samples = a.features[clip.driver], hop = a.features.hopSec || .05, start = a.features.startSec || 0, width = w - pad.l - pad.r;
      g.fillStyle = clip.driver === 'drums' ? '#ff9a3a40' : '#b25cff40';
      for (let px = 0; px < width; px++) {
        const sec = clip.startSec + px / width * clip.durationSec, i = clamp(Math.floor((sec - start) / hop), 0, samples.length - 1);
        const v = clamp(samples[i] * clip.driverGain, 0, 1); g.fillRect(pad.l + px, toY(v, hh), 1, toY(0, hh) - toY(v, hh));
      }
    }
    const [r, gg, b] = clipUiColor(clip.color), css = al => `rgba(${r},${gg},${b},${al})`;
    g.beginPath(); g.moveTo(toX(clip, 0, w), toY(0, hh));
    for (const k of clip.keyframes) g.lineTo(toX(clip, k.timeSec, w), toY(k.value, hh));
    g.lineTo(toX(clip, clip.durationSec, w), toY(0, hh)); g.closePath(); g.fillStyle = css(.28); g.fill();
    g.strokeStyle = css(1); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    clip.keyframes.forEach((k, i) => { const x = toX(clip, k.timeSec, w), y = toY(k.value, hh); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();

    // Keyframe dots
    clip.keyframes.forEach((k, i) => {
      const x = toX(clip, k.timeSec, w), y = toY(k.value, hh);
      const isSelected = s.selectedKeys.has(i);
      const isHovered = i === s.hoverKey;
      const isDragAnchor = s.drag?.type === 'points' && s.drag?.anchorIndex === i;

      if (isSelected) {
        g.beginPath();
        g.arc(x, y, 9, 0, Math.PI * 2);
        g.fillStyle = 'rgba(58, 223, 255, 0.35)';
        g.fill();

        g.beginPath();
        g.arc(x, y, isDragAnchor ? 7 : 6, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#3adfff';
        g.stroke();
      } else {
        const active = isHovered;
        g.beginPath();
        g.arc(x, y, active ? 6.5 : 5, 0, Math.PI * 2);
        g.fillStyle = active ? '#ffffff' : css(1);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#0b1017';
        g.stroke();
      }

      if (isDragAnchor || (isSelected && s.selectedKeys.size === 1) || (isHovered && s.selectedKeys.size <= 1)) {
        g.fillStyle = '#ffffff';
        const label = s.selectedKeys.size > 1 && isDragAnchor
          ? `${Math.round(k.value * 100)}% · ${k.timeSec.toFixed(2)}s (${s.selectedKeys.size} toč.)`
          : `${Math.round(k.value * 100)}% · ${k.timeSec.toFixed(2)}s`;
        g.fillText(label, clamp(x + 10, pad.l, w - 120), clamp(y - 12, 10, hh - 24));
      }
    });

    // Marquee rectangle
    if (s.marquee && (Math.abs(s.marquee.x1 - s.marquee.x0) > 2 || Math.abs(s.marquee.y1 - s.marquee.y0) > 2)) {
      const mx0 = Math.min(s.marquee.x0, s.marquee.x1);
      const mx1 = Math.max(s.marquee.x0, s.marquee.x1);
      const my0 = Math.min(s.marquee.y0, s.marquee.y1);
      const my1 = Math.max(s.marquee.y0, s.marquee.y1);
      const mw = mx1 - mx0;
      const mh = my1 - my0;
      g.save();
      g.fillStyle = 'rgba(58, 223, 255, 0.14)';
      g.fillRect(mx0, my0, mw, mh);
      g.strokeStyle = '#3adfff';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeRect(mx0 + 0.5, my0 + 0.5, mw, mh);
      g.restore();
    }

    const now = ctx.getTime() - clip.startSec;
    if (now >= 0 && now <= clip.durationSec) { const x = toX(clip, now, w); g.fillStyle = '#ffd36b'; g.fillRect(Math.round(x), pad.t, 1.5, hh - pad.t - pad.b); }
  }

  const pointer = event => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  const pick = (clip, x, y) => {
    const { w, h: hh } = geometry();
    let best = -1, bestDist = 10;
    clip.keyframes.forEach((k, i) => {
      const d = Math.hypot(toX(clip, k.timeSec, w) - x, toY(k.value, hh) - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };
  const snapLocal = (clip, local, fine) => fine ? local : snapTime(clip.startSec + local, ctx.getSnap(), tl(), ctx.getAnalysis()) - clip.startSec;

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  let lastDown = { t: 0, x: 0, y: 0 };
  const isDouble = event => {
    const d = performance.now() - lastDown.t < 350 && Math.hypot(event.clientX - lastDown.x, event.clientY - lastDown.y) < 6;
    lastDown = d ? { t: 0, x: 0, y: 0 } : { t: performance.now(), x: event.clientX, y: event.clientY };
    return d;
  };

  canvas.addEventListener('pointerdown', event => {
    const hit = primary(); if (!hit) return;
    canvas.focus();
    const { x, y } = pointer(event), { w, h: hh } = geometry(), clip = hit.clip, ref = refs()[0];
    const index = pick(clip, x, y);
    const isShift = event.shiftKey || event.metaKey || event.ctrlKey;

    // Right-click or Alt+click: delete
    if (event.button === 2 || (event.altKey && (index >= 0 || s.selectedKeys.size > 0))) {
      event.preventDefault();
      if (index >= 0 && s.selectedKeys.has(index) && s.selectedKeys.size > 1) {
        store.commit('Obriši keyframeove', t => removeKeyframes(findClip(t, ref).clip, [...s.selectedKeys]));
        s.selectedKeys.clear();
      } else if (index >= 0) {
        store.commit('Obriši keyframe', t => removeKeyframe(findClip(t, ref).clip, index));
        s.selectedKeys.delete(index);
      } else if (s.selectedKeys.size > 0) {
        store.commit('Obriši keyframeove', t => removeKeyframes(findClip(t, ref).clip, [...s.selectedKeys]));
        s.selectedKeys.clear();
      }
      s.hoverKey = -1;
      render();
      return;
    }

    if (event.button !== 0) return;

    // Clicked on a keyframe
    if (index >= 0) {
      if (isShift) {
        if (s.selectedKeys.has(index)) {
          s.selectedKeys.delete(index);
          draw();
          updateHeader();
          return;
        } else {
          s.selectedKeys.add(index);
        }
      } else {
        if (s.selectedKeys.has(index)) {
          s.pendingExclusiveClick = index;
        } else {
          s.selectedKeys = new Set([index]);
          s.pendingExclusiveClick = -1;
        }
      }

      store.begin();
      s.drag = {
        type: 'points',
        anchorIndex: index,
        anchorInitialTimeSec: clip.keyframes[index].timeSec,
        anchorInitialValue: clip.keyframes[index].value,
        startPointer: { x, y },
        initialKeys: clip.keyframes.map(k => ({ ...k })),
        selectedIndices: [...s.selectedKeys].sort((a, b) => a - b),
        ref,
        fine: event.shiftKey,
        moved: false,
        pointerId: event.pointerId
      };
      canvas.setPointerCapture(event.pointerId);
      draw();
      updateHeader();
      return;
    }

    // Clicked in empty space: check double-click
    const dbl = isDouble(event);
    if (dbl) {
      store.begin();
      let newIdx = -1;
      store.update(t => {
        newIdx = addKeyframe(findClip(t, ref).clip, snapLocal(clip, fromX(clip, x, w), event.shiftKey), clamp(fromY(y, hh), 0, 1));
      });
      if (newIdx < 0) {
        store.cancel();
        return;
      }
      store.end('Novi keyframe');
      s.selectedKeys = new Set([newIdx]);
      s.hoverKey = newIdx;
      render();
      return;
    }

    // Start marquee drag-to-select
    if (!isShift) {
      s.selectedKeys.clear();
    }
    s.marquee = {
      x0: x, y0: y,
      x1: x, y1: y,
      shift: isShift,
      initialSelected: new Set(s.selectedKeys),
      pointerId: event.pointerId,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    draw();
    updateHeader();
  });

  canvas.addEventListener('pointermove', event => {
    const hit = primary(); if (!hit) return;
    const { x, y } = pointer(event), { w, h: hh } = geometry();
    const clip = hit.clip;

    if (s.marquee && s.marquee.pointerId === event.pointerId) {
      s.marquee.x1 = x;
      s.marquee.y1 = y;
      if (Math.hypot(x - s.marquee.x0, y - s.marquee.y0) > 3) {
        s.marquee.moved = true;
      }
      const x0 = Math.min(s.marquee.x0, s.marquee.x1);
      const x1 = Math.max(s.marquee.x0, s.marquee.x1);
      const y0 = Math.min(s.marquee.y0, s.marquee.y1);
      const y1 = Math.max(s.marquee.y0, s.marquee.y1);
      const sel = new Set(s.marquee.shift ? s.marquee.initialSelected : []);
      clip.keyframes.forEach((k, i) => {
        const kx = toX(clip, k.timeSec, w);
        const ky = toY(k.value, hh);
        if (kx + 6 >= x0 && kx - 6 <= x1 && ky + 6 >= y0 && ky - 6 <= y1) {
          sel.add(i);
        }
      });
      s.selectedKeys = sel;
      draw();
      updateHeader();
      return;
    }

    if (s.drag && s.drag.pointerId === event.pointerId) {
      if (Math.hypot(x - s.drag.startPointer.x, y - s.drag.startPointer.y) > 3) {
        s.drag.moved = true;
      }
      const fine = event.shiftKey;
      const targetTime = snapLocal(clip, fromX(clip, x, w), fine);
      const targetVal = fine ? clamp(fromY(y, hh), 0, 1) : Math.round(clamp(fromY(y, hh), 0, 1) * 40) / 40;
      const dt = targetTime - s.drag.anchorInitialTimeSec;
      const dv = targetVal - s.drag.anchorInitialValue;

      store.update(t => {
        const c = findClip(t, s.drag.ref).clip;
        moveKeyframes(c, s.drag.initialKeys, s.drag.selectedIndices, dt, dv);
      });
      draw();
      return;
    }

    const index = pick(clip, x, y);
    if (index !== s.hoverKey) {
      s.hoverKey = index;
      canvas.style.cursor = index >= 0 ? (s.selectedKeys.has(index) ? 'grab' : 'pointer') : 'crosshair';
      draw();
    }
  });

  const release = event => {
    if (s.marquee && s.marquee.pointerId === event.pointerId) {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      s.marquee = null;
      draw();
      updateHeader();
      return;
    }

    if (s.drag && s.drag.pointerId === event.pointerId) {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (!s.drag.moved && s.pendingExclusiveClick >= 0) {
        s.selectedKeys = new Set([s.pendingExclusiveClick]);
      }
      s.pendingExclusiveClick = -1;
      const moved = s.drag.moved;
      s.drag = null;
      if (moved) {
        store.end('Envelope');
      } else {
        store.cancel();
      }
      draw();
      updateHeader();
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('keydown', event => {
    const hit = primary(); if (!hit) return;
    const ref = refs()[0];

    // Select all: Cmd+A or Ctrl+A
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      s.selectedKeys = new Set(hit.clip.keyframes.map((_, i) => i));
      draw();
      updateHeader();
      return;
    }

    // Escape: clear selection
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      s.selectedKeys.clear();
      draw();
      updateHeader();
      return;
    }

    // Delete / Backspace: remove selected or hovered keyframe(s)
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      if (s.selectedKeys.size > 0) {
        store.commit('Obriši keyframeove', t => {
          removeKeyframes(findClip(t, ref).clip, [...s.selectedKeys]);
        });
        s.selectedKeys.clear();
        s.hoverKey = -1;
        render();
        return;
      }
      if (s.hoverKey >= 0) {
        store.commit('Obriši keyframe', t => {
          removeKeyframe(findClip(t, ref).clip, s.hoverKey);
        });
        s.hoverKey = -1;
        render();
      }
    }
  });

  canvas.addEventListener('pointerleave', () => { if (!s.drag && !s.marquee && s.hoverKey !== -1) { s.hoverKey = -1; draw(); } });
  new ResizeObserver(draw).observe(canvas);
  render();
  return { render, draw };
}
