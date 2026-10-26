/** LEDicated Studio MCP Tools Definition & Implementation.
 * Exposes full timeline editing, playback control, live performance pads,
 * hardware configuration, and preview frames to AI agents in Antigravity.
 */
import { TIMELINE_PRESETS, TIMELINE_BLENDS } from './timeline.mjs';
import { BAR_IDS } from './engine.mjs';
import { PAD_KEYS } from './live-performance-state.mjs';

export const TOOLS_MANIFEST = [
  {
    name: 'ledicated_get_status',
    description: 'Vraća cjelokupni status LEDicated studija: stanje poslužitelja, je li otvoreno web sučelje, aktivnu pjesmu, poziciju playheada, status reprodukcije i snimanja, BPM, master svjetlinu, blackout, status WLED izlaza i potrošnju struje (W).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ledicated_list_tracks',
    description: 'Vraća popis svih učitanih audio pjesama u lokalnoj biblioteci (naziv, trajanje, BPM, status analize i vremenske trake).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ledicated_get_track_details',
    description: 'Vraća detaljne podatke o pjesmi uključujući stem analizu (dijelove pjesme, energiju, bubnjeve, bas, vokale, beatove) i sažetak slojeva.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'ID pjesme (UUID). Ako se izostavi, koristi se trenutno aktivna pjesma.' }
      }
    }
  },
  {
    name: 'ledicated_select_track',
    description: 'Postavlja aktivnu pjesmu u studiju po ID-ju. Ažurira timeline i učitava audio u sučelju.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'ID pjesme (UUID) koju želimo odabrati.' }
      },
      required: ['trackId']
    }
  },
  {
    name: 'ledicated_get_timeline',
    description: 'Vraća punu vremensku traku (slojeve, clipove, keyframeove, BPM, taktove) za aktivnu ili odabranu pjesmu.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'ID pjesme (opcionalno).' },
        layerId: { type: 'string', description: 'Filtriraj samo na određeni sloj (opcionalno).' },
        summaryOnly: { type: 'boolean', description: 'Ako je true, vraća sažetak slojeva i clipova bez detaljnih keyframeova.' }
      }
    }
  },
  {
    name: 'ledicated_add_layer',
    description: 'Dodaje novi sloj na vremensku traku svjetlosnog showa.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Naziv sloja (npr. "Kicks", "Strobe Glow", "Vocal Sweep").' },
        color: { type: 'string', description: 'Boja sloja u heksadecimalnom obliku (npr. "#3aa0ff", "#ff5c8a").' },
        blend: { type: 'string', enum: ['screen', 'add', 'multiply', 'max', 'replace'], description: 'Način stapanja sloja (default: screen).' },
        opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Prozirnost / intenzitet sloja 0-1 (default: 0.7).' },
        index: { type: 'integer', description: 'Pozicija u poretku slojeva (opcionalno).' },
        trackId: { type: 'string', description: 'ID pjesme (opcionalno).' }
      }
    }
  },
  {
    name: 'ledicated_remove_layer',
    description: 'Briše sloj i sve njegove clipove s vremenske trake.',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'ID sloja koji se briše.' },
        trackId: { type: 'string', description: 'ID pjesme (opcionalno).' }
      },
      required: ['layerId']
    }
  },
  {
    name: 'ledicated_update_layer',
    description: 'Mijenja postavke postojećeg sloja (naziv, boju, blend način, opacity ili uključeno/isključeno).',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'ID sloja.' },
        name: { type: 'string', description: 'Novi naziv.' },
        color: { type: 'string', description: 'Nova boja.' },
        blend: { type: 'string', enum: ['screen', 'add', 'multiply', 'max', 'replace'] },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        enabled: { type: 'boolean', description: 'Uključen ili mutiran.' },
        trackId: { type: 'string' }
      },
      required: ['layerId']
    }
  },
  {
    name: 'ledicated_duplicate_layer',
    description: 'Duplicira sloj sa svim pripadajućim clipovima.',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'ID sloja koji se duplicira.' },
        trackId: { type: 'string' }
      },
      required: ['layerId']
    }
  },
  {
    name: 'ledicated_add_clip',
    description: 'Dodaje novi svjetlosni clip (efekt) na odabrani sloj. Clip se odmah prikazuje na timelineu, previewu i šalje na WLED ako je uključen.',
    inputSchema: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'ID sloja na koji se dodaje clip. Ako se izostavi, koristi se prvi sloj.' },
        preset: {
          type: 'string',
          enum: ['pulse', 'chase', 'sweep', 'strobe', 'flash', 'wash', 'sparkle', 'wave', 'ripple', 'rain', 'spiral', 'fire', 'alternate', 'center', 'columns', 'bounce'],
          description: 'Svjetlosni preset / efekt.'
        },
        startSec: { type: 'number', minimum: 0, description: 'Vrijeme početka u sekundama.' },
        durationSec: { type: 'number', minimum: 0.05, description: 'Trajanje clipa u sekundama.' },
        targets: {
          description: 'Ciljani barovi: "all" za svih 9 barova, ili niz oznaka: ["L1", "C1", "R1", "L2", "C2", "R2", "L3", "C3", "R3"].',
          oneOf: [
            { type: 'string', enum: ['all'] },
            { type: 'array', items: { type: 'string' } }
          ]
        },
        color: {
          description: 'RGBW boja: heksadecimalni string ("#3aa0ff") ili niz od 4 broja [r, g, b, w] u rasponu 0-1.',
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } }
          ]
        },
        driver: {
          type: 'string',
          enum: ['none', 'drums', 'bass', 'vocals', 'other', 'band'],
          description: 'Audio reaktivni izvor: "none", "drums", "bass", "vocals", "other", ili "band" (frekvencijski EQ pojas).'
        },
        driverGain: { type: 'number', minimum: 0, maximum: 3, description: 'Pojačanje audio signala (default: 1).' },
        speed: { type: 'number', minimum: 0.1, maximum: 32, description: 'Brzina animacije efekta (default: 1).' },
        direction: { type: 'string', enum: ['ltr', 'rtl', 'ttb', 'btt', 'center_out', 'edges_in'], description: 'Smjer kretanja efekta.' },
        timing: { type: 'string', enum: ['half', 'beat', 'bar', '2bar', '4bar'], description: 'Glazbeni interval trajanja jednog ciklusa.' },
        motionMode: { type: 'string', enum: ['serial', 'parallel', 'sync'], description: 'Način prostorne animacije.' },
        params: { type: 'object', description: 'Dodatni parametri specifični za preset (npr. breathe: true, rub: true, curve: "punch", beam: "razor").' },
        keyframes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timeSec: { type: 'number' },
              value: { type: 'number', minimum: 0, maximum: 1 },
              ease: { type: 'string', enum: ['linear', 'in', 'out', 'smooth'] }
            },
            required: ['timeSec', 'value']
          },
          description: 'Opcionalna kuverta (envelope) svjetline u clipu.'
        },
        trackId: { type: 'string' }
      },
      required: ['startSec', 'durationSec', 'preset']
    }
  },
  {
    name: 'ledicated_patch_clips',
    description: 'Mijenja svojstva jednog ili više postojećih clipova (npr. boju, brzinu, preset, smjer, ciljane barove, audio driver).',
    inputSchema: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' }, description: 'Popis ID-jeva clipova koje mijenjamo.' },
        clipId: { type: 'string', description: 'Pojedinačni ID clipa (alternativa nizu).' },
        patch: {
          type: 'object',
          description: 'Svojstva koja se ažuriraju (preset, color, targets, driver, driverGain, speed, direction, timing, params, band).'
        },
        trackId: { type: 'string' }
      },
      required: ['patch']
    }
  },
  {
    name: 'ledicated_delete_clips',
    description: 'Briše jedan ili više clipova s vremenske trake.',
    inputSchema: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
        clipId: { type: 'string' },
        trackId: { type: 'string' }
      }
    }
  },
  {
    name: 'ledicated_move_clip',
    description: 'Pomiče clip na novu startnu poziciju (u sekundama) ili na drugi sloj.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'ID clipa.' },
        startSec: { type: 'number', minimum: 0, description: 'Novo vrijeme početka.' },
        targetLayerId: { type: 'string', description: 'ID odredišnog sloja (ako se prebacuje na drugi sloj).' },
        trackId: { type: 'string' }
      },
      required: ['clipId', 'startSec']
    }
  },
  {
    name: 'ledicated_resize_clip',
    description: 'Mijenja veličinu clipa povlačenjem početnog ili završnog ruba.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'ID clipa.' },
        edge: { type: 'string', enum: ['start', 'end'], description: 'Koji rub se pomiče.' },
        newTimeSec: { type: 'number', minimum: 0, description: 'Nova vremenska pozicija ruba.' },
        trackId: { type: 'string' }
      },
      required: ['clipId', 'edge', 'newTimeSec']
    }
  },
  {
    name: 'ledicated_split_clip',
    description: 'Reže (razdvaja) clip na dvije cjeline na navedenoj vremenskoj točki.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'ID clipa koji se reže.' },
        atSec: { type: 'number', minimum: 0, description: 'Točka reza u sekundama pjesme.' },
        trackId: { type: 'string' }
      },
      required: ['clipId', 'atSec']
    }
  },
  {
    name: 'ledicated_duplicate_clips',
    description: 'Duplicira odabrane clipove s vremenskim pomakom i opcionalnim pomakom sloja.',
    inputSchema: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
        offsetSec: { type: 'number', description: 'Vremenski pomak u sekundama (default: 1).' },
        layerOffset: { type: 'integer', description: 'Pomak sloja prema gore/dolje (default: 0).' },
        trackId: { type: 'string' }
      },
      required: ['clipIds']
    }
  },
  {
    name: 'ledicated_add_keyframe',
    description: 'Dodaje keyframe točku u kuvertu (envelope) svjetline clipa za glatke prijelaze i fade efekte.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'ID clipa.' },
        timeSec: { type: 'number', minimum: 0, description: 'Vrijeme unutar clipa (od 0 do durationSec).' },
        value: { type: 'number', minimum: 0, maximum: 1, description: 'Razina svjetline / intenziteta od 0 do 1.' },
        ease: { type: 'string', enum: ['linear', 'in', 'out', 'smooth'], description: 'Vrsta krivulje.' },
        trackId: { type: 'string' }
      },
      required: ['clipId', 'timeSec', 'value']
    }
  },
  {
    name: 'ledicated_remove_keyframe',
    description: 'Briše keyframe točku iz clipa po indeksu.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'ID clipa.' },
        keyframeIndex: { type: 'integer', minimum: 0 },
        trackId: { type: 'string' }
      },
      required: ['clipId', 'keyframeIndex']
    }
  },
  {
    name: 'ledicated_create_auto_show',
    description: 'Automatski generira cjeloviti višeslojni glazbeni svjetlosni show prilagođen dropovima, beatu, basu i vokalima pjesme.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string', description: 'ID pjesme (opcionalno).' },
        style: { type: 'string', enum: ['club', 'ember', 'ice'], description: 'Paleta i stil showa (default: club).' },
        energy: { type: 'number', minimum: 0.1, maximum: 1, description: 'Razina dinamike i gustoće efekata (default: 0.8).' }
      }
    }
  },
  {
    name: 'ledicated_clear_timeline',
    description: 'Čisti sve slojeve i clipove s vremenske trake.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' }
      }
    }
  },
  {
    name: 'ledicated_transport_control',
    description: 'Upravlja reprodukcijom i playheadom poput korisnika u DAW sučelju: pokretanje, pauza, stop, premotavanje, loop, promjena tempa i snimanje.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'stop', 'seek', 'loop', 'record', 'set_tempo', 'tap_tempo'],
          description: 'Radnja reprodukcije.'
        },
        timeSec: { type: 'number', description: 'Vrijeme premotavanja u sekundama (za seek).' },
        beat: { type: 'number', description: 'Takt/beat pozicija (alternativa timeSec za seek).' },
        startSec: { type: 'number', description: 'Početak loop regije (za loop).' },
        endSec: { type: 'number', description: 'Kraj loop regije (za loop).' },
        enabled: { type: 'boolean', description: 'Uključi ili isključi loop.' },
        armed: { type: 'boolean', description: 'Stanje live snimanja (za record).' },
        bpm: { type: 'number', minimum: 40, maximum: 240, description: 'Tempo pjesme u BPM-u (za set_tempo).' }
      },
      required: ['action']
    }
  },
  {
    name: 'ledicated_live_pad_trigger',
    description: 'Opaljuje live performance pad (Q, W, E, R, A, S, D, F, Z, X, C, V ili 0-11). Ako je snimanje aktivno, odmah bilježi clip na timelineu.',
    inputSchema: {
      type: 'object',
      properties: {
        pad: {
          description: 'Broj pada (0-11) ili tipka ("Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V").',
          oneOf: [{ type: 'integer', minimum: 0, maximum: 11 }, { type: 'string' }]
        },
        action: {
          type: 'string',
          enum: ['hit', 'loop', 'release'],
          description: '"hit" za jednokratni udarac/animaciju, "loop" za uključivanje trajnog ponavljanja, "release" za otpuštanje.'
        }
      },
      required: ['pad']
    }
  },
  {
    name: 'ledicated_live_pad_configure',
    description: 'Konfigurira dodijeljeni efekt na live performance padu (preset, boju, barove, brzinu).',
    inputSchema: {
      type: 'object',
      properties: {
        pad: {
          description: 'Broj pada (0-11) ili tipka ("Q".."V").',
          oneOf: [{ type: 'integer', minimum: 0, maximum: 11 }, { type: 'string' }]
        },
        preset: { type: 'string', enum: ['pulse', 'chase', 'sweep', 'strobe', 'flash', 'wash', 'sparkle', 'wave', 'ripple', 'rain', 'spiral', 'fire', 'alternate', 'center', 'columns', 'bounce'] },
        targets: { oneOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] },
        color: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] },
        speed: { type: 'number', minimum: 0.25, maximum: 8 },
        mode: { type: 'string', enum: ['hit', 'loop'] }
      },
      required: ['pad']
    }
  },
  {
    name: 'ledicated_set_master',
    description: 'Postavlja master svjetlinu cijelog studija (od 0 do 100%; crvena zona iznad 70%).',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', minimum: 0, maximum: 100, description: 'Razina svjetline (0-100).' }
      },
      required: ['value']
    }
  },
  {
    name: 'ledicated_blackout',
    description: 'Trenutno gasi sve svjetlo i prekida slanje na fizičke kontrolere (Blackout panic switch).',
    inputSchema: {
      type: 'object',
      properties: {
        active: { type: 'boolean', description: 'Ako se izostavi, mijenja trenutno stanje (toggle).' }
      }
    }
  },
  {
    name: 'ledicated_get_preview_frame',
    description: 'Vraća točne RGBW vrijednosti za svih 9 barova (L1, C1, R1, L2, C2, R2, L3, C3, R3) na zadanom vremenu, te izračunatu potrošnju struje u vatima (W).',
    inputSchema: {
      type: 'object',
      properties: {
        timeSec: { type: 'number', description: 'Vrijeme u sekundama (ako se izostavi, uzima se trenutni playhead).' },
        trackId: { type: 'string', description: 'ID pjesme (opcionalno).' }
      }
    }
  },
  {
    name: 'ledicated_get_hardware_config',
    description: 'Vraća hardversku konfiguraciju: profil (E8+C3 ili 5×C3), WLED IP adrese i MAC identitete kontrolera, transport (RGB / RGBW) i mapiranje barova.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ledicated_update_hardware_config',
    description: 'Ažurira hardversku konfiguraciju (IP adrese kontrolera, transport način, reverziju barova).',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', enum: ['e8-columns', 'e8-c3', 'c3-five'] },
        transport: { type: 'string', enum: ['rgb', 'rgbw'] },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, host: { type: 'string' }, mac: { type: 'string' } },
            required: ['id', 'host']
          }
        },
        bars: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, pixels: { type: 'integer' }, physicalLeds: { type: 'integer' }, reverse: { type: 'boolean' } },
            required: ['id']
          }
        }
      }
    }
  },
  {
    name: 'ledicated_discover_wled',
    description: 'Skenira lokalnu mrežu putem mDNS / Bonjour protokola i traži WLED kontrolere.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ledicated_probe_wled',
    description: 'Šalje WLED /json/info upit na spremljenu IP adresu odabranog kontrolera radi provjere odaziva, verzije, signala i rasporeda pinova.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'ID kontrolera (npr. "E8-1", "C3-R3", "C3-Top").' }
      },
      required: ['nodeId']
    }
  },
  {
    name: 'ledicated_arm_output',
    description: 'Uključuje (arm) ili isključuje slanje DDP UDP paketa na stvarne fizičke LED kontrolere.',
    inputSchema: {
      type: 'object',
      properties: {
        armed: { type: 'boolean', description: 'true za uključivanje izlaza, false za isključivanje.' }
      },
      required: ['armed']
    }
  },
  {
    name: 'ledicated_test_bar',
    description: 'Izvodi kratki, sigurni testni puls (350 ms prigušene svjetlosti) na točno jednom odabranom LED baru radi provjere fizičkog spoja.',
    inputSchema: {
      type: 'object',
      properties: {
        barId: { type: 'string', enum: ['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3'], description: 'Oznaka LED bara.' }
      },
      required: ['barId']
    }
  }
];

export function createMcpClient({ baseUrl = 'http://127.0.0.1:8787' } = {}) {
  const req = async (path, options = {}) => {
    const url = `${baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  };

  return {
    async getStatus() {
      try {
        const live = await req('/api/live/status');
        const tracksData = await req('/api/library/tracks').catch(() => ({ tracks: [] }));
        return {
          online: true,
          browserConnected: live.browserConnected,
          clientCount: live.clientCount,
          activeTrack: live.liveState?.trackId
            ? tracksData.tracks?.find(t => t.id === live.liveState.trackId) || { id: live.liveState.trackId, title: live.liveState.trackTitle }
            : (tracksData.tracks?.[0] || null),
          playhead: {
            timeSec: live.liveState?.timeSec ?? 0,
            isPlaying: Boolean(live.liveState?.isPlaying),
            isRecording: Boolean(live.liveState?.isRecording),
            loop: live.liveState?.loop ?? null,
            bpm: live.liveState?.bpm ?? 120
          },
          controls: {
            master: live.liveState?.master ?? 35,
            blackout: live.serverState?.reason === 'Blackout' || Boolean(live.liveState?.blackout),
            armed: Boolean(live.serverState?.armed)
          },
          summary: {
            layerCount: live.liveState?.layerCount ?? 0,
            clipCount: live.liveState?.clipCount ?? 0,
            activePads: live.liveState?.activePads ?? []
          },
          hardware: {
            profile: live.serverState?.config?.profile,
            transport: live.serverState?.transport,
            nodesCount: live.serverState?.config?.nodes?.length ?? 0
          }
        };
      } catch (err) {
        return {
          online: false,
          error: `LEDicated poslužitelj nije dostupan na ${baseUrl}: ${err.message}. Pokrenite ga s 'npm start'.`
        };
      }
    },

    async listTracks() {
      const data = await req('/api/library/tracks');
      return { tracks: data.tracks || [], sets: data.sets || [] };
    },

    async getTrackDetails(trackId) {
      const tracks = (await req('/api/library/tracks')).tracks || [];
      const id = trackId || (await this.getStatus()).activeTrack?.id || tracks[0]?.id;
      if (!id) throw new Error('Nema dostupnih pjesama.');
      const data = await req(`/api/library/track/${id}`);
      return data;
    },

    async selectTrack(trackId) {
      await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({ type: 'select_track', trackId })
      });
      return { ok: true, selectedTrackId: trackId };
    },

    async getTimeline(trackId, layerId = null, summaryOnly = false) {
      const track = await this.getTrackDetails(trackId);
      let tl = track.timeline;
      if (!tl) throw new Error('Pjesma nema spremljenu vremensku traku.');
      if (layerId) {
        tl = { ...tl, layers: tl.layers.filter(l => l.id === layerId) };
      }
      if (summaryOnly) {
        return {
          version: tl.version,
          durationSec: tl.durationSec,
          bpm: tl.bpm,
          beatOffsetSec: tl.beatOffsetSec,
          layers: tl.layers.map(l => ({
            id: l.id,
            name: l.name,
            color: l.color,
            blend: l.blend,
            opacity: l.opacity,
            clipCount: l.clips.length,
            clips: l.clips.map(c => ({
              id: c.id,
              preset: c.preset,
              startSec: c.startSec,
              durationSec: c.durationSec,
              targets: c.targets,
              driver: c.driver,
              speed: c.speed
            }))
          }))
        };
      }
      return tl;
    },

    async executeTimelineOp(op, args = {}, trackId = null) {
      const res = await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'timeline_op',
          op,
          args,
          trackId
        })
      });
      return res;
    },

    async transport(action, params = {}) {
      const res = await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'transport',
          action,
          ...params
        })
      });
      return res;
    },

    async livePad(pad, action = 'hit', effect = null) {
      const res = await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'live_pad',
          pad,
          action,
          effect
        })
      });
      return res;
    },

    async setMaster(value) {
      const res = await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'master',
          value
        })
      });
      return res;
    },

    async blackout(active) {
      const res = await req('/api/live/command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'blackout',
          value: active
        })
      });
      return res;
    },

    async getPreviewFrame(timeSec, trackId) {
      const params = new URLSearchParams();
      if (timeSec !== undefined) params.set('time', String(timeSec));
      if (trackId) params.set('trackId', trackId);
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await req(`/api/live/frame${query}`);
      return res;
    },

    async getHardwareConfig() {
      const res = await req('/api/state');
      return res;
    },

    async updateHardwareConfig(configPatch) {
      const current = (await req('/api/state')).config;
      const merged = { ...current, ...configPatch };
      const res = await req('/api/config', {
        method: 'POST',
        body: JSON.stringify(merged)
      });
      return res;
    },

    async discoverWled() {
      const res = await req('/api/discover', { method: 'POST' });
      return res;
    },

    async probeWled(nodeId) {
      const res = await req('/api/probe', {
        method: 'POST',
        body: JSON.stringify({ nodeId })
      });
      return res;
    },

    async armOutput(armed) {
      const res = await req('/api/arm', {
        method: 'POST',
        body: JSON.stringify({ armed })
      });
      return res;
    },

    async testBar(barId) {
      const res = await req('/api/test-bar', {
        method: 'POST',
        body: JSON.stringify({ barId, confirm: true })
      });
      return res;
    }
  };
}

export async function handleToolCall(name, args = {}, client = createMcpClient()) {
  try {
    switch (name) {
      case 'ledicated_get_status': {
        const status = await client.getStatus();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }], isError: false };
      }

      case 'ledicated_list_tracks': {
        const tracks = await client.listTracks();
        return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }], isError: false };
      }

      case 'ledicated_get_track_details': {
        const details = await client.getTrackDetails(args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }], isError: false };
      }

      case 'ledicated_select_track': {
        const res = await client.selectTrack(args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_get_timeline': {
        const tl = await client.getTimeline(args.trackId, args.layerId, args.summaryOnly);
        return { content: [{ type: 'text', text: JSON.stringify(tl, null, 2) }], isError: false };
      }

      case 'ledicated_add_layer': {
        const res = await client.executeTimelineOp('add_layer', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_remove_layer': {
        const res = await client.executeTimelineOp('remove_layer', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_update_layer': {
        const res = await client.executeTimelineOp('update_layer', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_duplicate_layer': {
        const res = await client.executeTimelineOp('duplicate_layer', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_add_clip': {
        const res = await client.executeTimelineOp('add_clip', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_patch_clips': {
        const res = await client.executeTimelineOp('patch_clips', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_delete_clips': {
        const res = await client.executeTimelineOp('delete_clips', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_move_clip': {
        const res = await client.executeTimelineOp('move_clip', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_resize_clip': {
        const res = await client.executeTimelineOp('resize_clip', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_split_clip': {
        const res = await client.executeTimelineOp('split_clip', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_duplicate_clips': {
        const res = await client.executeTimelineOp('duplicate_clips', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_add_keyframe': {
        const res = await client.executeTimelineOp('add_keyframe', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_remove_keyframe': {
        const res = await client.executeTimelineOp('remove_keyframe', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_create_auto_show': {
        const res = await client.executeTimelineOp('create_auto_show', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_clear_timeline': {
        const res = await client.executeTimelineOp('clear_timeline', args, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_transport_control': {
        const res = await client.transport(args.action, args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_live_pad_trigger': {
        const res = await client.livePad(args.pad, args.action || 'hit');
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_live_pad_configure': {
        const res = await client.livePad(args.pad, 'set', args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_set_master': {
        const res = await client.setMaster(args.value);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_blackout': {
        const res = await client.blackout(args.active);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_get_preview_frame': {
        const res = await client.getPreviewFrame(args.timeSec, args.trackId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_get_hardware_config': {
        const res = await client.getHardwareConfig();
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_update_hardware_config': {
        const res = await client.updateHardwareConfig(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_discover_wled': {
        const res = await client.discoverWled();
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_probe_wled': {
        const res = await client.probeWled(args.nodeId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_arm_output': {
        const res = await client.armOutput(args.armed);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      case 'ledicated_test_bar': {
        const res = await client.testBar(args.barId);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: false };
      }

      default:
        return { content: [{ type: 'text', text: `Nepoznat alat: ${name}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Greška alata ${name}: ${error.message}` }], isError: true };
  }
}
