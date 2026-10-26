#!/usr/bin/env node
/** LEDicated Studio Command Line Interface (CLI).
 * Enables agents, scripts, and terminal users to interactively inspect and live-edit
 * the timeline, show settings, playback, and live performance.
 */
import { createMcpClient, handleToolCall } from './mcp-tools.mjs';

const client = createMcpClient({ baseUrl: process.env.LEDICATED_URL || 'http://127.0.0.1:8787' });
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(`LEDicated Studio CLI

Korištenje:
  node cli.mjs status                              Prikaz cjelokupnog stanja studija
  node cli.mjs tracks                              Popis pjesama u biblioteci
  node cli.mjs track [id]                          Detalji pjesme i stem analize
  node cli.mjs select <trackId>                    Odabir aktivne pjesme
  node cli.mjs timeline [trackId] [--summary]      Prikaz vremenske trake
  node cli.mjs add-layer <name> [--color #hex]     Dodavanje sloja
  node cli.mjs remove-layer <layerId>              Brisanje sloja
  node cli.mjs add-clip <layerId> <preset> <start> <duration> [options]
  node cli.mjs patch-clip <clipId> '<jsonPatch>'   Izmjena svojstava clipa
  node cli.mjs delete-clip <clipId>                Brisanje clipa
  node cli.mjs move-clip <clipId> <startSec>       Pomicanje clipa
  node cli.mjs resize-clip <clipId> <edge> <sec>   Promjena duljine clipa (start|end)
  node cli.mjs split-clip <clipId> <atSec>         Rezanje clipa
  node cli.mjs auto-show [trackId] [--style club]  Generiranje auto showa
  node cli.mjs play | pause | stop                 Upravljanje reprodukcijom
  node cli.mjs seek <timeSec>                      Premotavanje playheada
  node cli.mjs loop <startSec> <endSec>            Postavljanje loop regije
  node cli.mjs pad <Q..V|0..11> [hit|loop|release] Live performance padovi
  node cli.mjs master <0-100>                      Master svjetlina (crveno > 70%)
  node cli.mjs blackout [on|off]                   Blackout prekidač
  node cli.mjs frame [timeSec]                     RGBW pregled kadra i snaga (W)
  node cli.mjs config                              Hardverske postavke
  node cli.mjs arm <on|off>                        Uključivanje WLED DDP izlaza
  node cli.mjs test-bar <barId>                    Sigurni test jednog bara (L1..R3)
`);
    return;
  }

  const flags = parseFlags(args.slice(1));
  const pos = args.slice(1).filter(a => !a.startsWith('--'));

  switch (command) {
    case 'status': {
      const res = await client.getStatus();
      printJson(res);
      break;
    }

    case 'tracks': {
      const res = await client.listTracks();
      printJson(res);
      break;
    }

    case 'track': {
      const res = await client.getTrackDetails(pos[0]);
      printJson(res);
      break;
    }

    case 'select': {
      if (!pos[0]) throw new Error('Potreban je trackId.');
      const res = await client.selectTrack(pos[0]);
      printJson(res);
      break;
    }

    case 'timeline': {
      const res = await client.getTimeline(pos[0], flags.layer, Boolean(flags.summary));
      printJson(res);
      break;
    }

    case 'add-layer': {
      const name = pos[0] || 'Novi sloj';
      const res = await client.executeTimelineOp('add_layer', {
        name,
        color: flags.color || '#3aa0ff',
        blend: flags.blend || 'screen',
        opacity: flags.opacity ? Number(flags.opacity) : 0.7
      }, flags.track);
      printJson(res);
      break;
    }

    case 'remove-layer': {
      if (!pos[0]) throw new Error('Potreban je layerId.');
      const res = await client.executeTimelineOp('remove_layer', { layerId: pos[0] }, flags.track);
      printJson(res);
      break;
    }

    case 'add-clip': {
      const layerId = pos[0];
      const preset = pos[1] || 'pulse';
      const startSec = Number(pos[2] ?? 0);
      const durationSec = Number(pos[3] ?? 2);
      let targets = 'all';
      if (flags.targets) targets = flags.targets === 'all' ? 'all' : flags.targets.split(',').map(s => s.trim());
      const res = await client.executeTimelineOp('add_clip', {
        layerId,
        preset,
        startSec,
        durationSec,
        targets,
        color: flags.color || '#ffffff',
        speed: flags.speed ? Number(flags.speed) : 1,
        driver: flags.driver || 'none',
        direction: flags.dir || 'ltr',
        timing: flags.timing || 'beat'
      }, flags.track);
      printJson(res);
      break;
    }

    case 'patch-clip': {
      const clipId = pos[0];
      const patch = JSON.parse(pos[1] || '{}');
      const res = await client.executeTimelineOp('patch_clips', { clipId, patch }, flags.track);
      printJson(res);
      break;
    }

    case 'delete-clip': {
      const clipId = pos[0];
      const res = await client.executeTimelineOp('delete_clips', { clipId }, flags.track);
      printJson(res);
      break;
    }

    case 'move-clip': {
      const clipId = pos[0];
      const startSec = Number(pos[1]);
      const res = await client.executeTimelineOp('move_clip', { clipId, startSec, targetLayerId: flags.layer }, flags.track);
      printJson(res);
      break;
    }

    case 'resize-clip': {
      const clipId = pos[0];
      const edge = pos[1] || 'end';
      const newTimeSec = Number(pos[2]);
      const res = await client.executeTimelineOp('resize_clip', { clipId, edge, newTimeSec }, flags.track);
      printJson(res);
      break;
    }

    case 'split-clip': {
      const clipId = pos[0];
      const atSec = Number(pos[1]);
      const res = await client.executeTimelineOp('split_clip', { clipId, atSec }, flags.track);
      printJson(res);
      break;
    }

    case 'auto-show': {
      const res = await client.executeTimelineOp('create_auto_show', {
        style: flags.style || 'club',
        energy: flags.energy ? Number(flags.energy) : 0.8
      }, pos[0] || flags.track);
      printJson(res);
      break;
    }

    case 'play': {
      const res = await client.transport('play');
      printJson(res);
      break;
    }

    case 'pause': {
      const res = await client.transport('pause');
      printJson(res);
      break;
    }

    case 'stop': {
      const res = await client.transport('stop');
      printJson(res);
      break;
    }

    case 'seek': {
      const timeSec = Number(pos[0] || 0);
      const res = await client.transport('seek', { timeSec });
      printJson(res);
      break;
    }

    case 'loop': {
      const startSec = Number(pos[0]);
      const endSec = Number(pos[1]);
      const enabled = pos[2] !== 'off';
      const res = await client.transport('loop', { startSec, endSec, enabled });
      printJson(res);
      break;
    }

    case 'pad': {
      const pad = pos[0] || 'Q';
      const action = pos[1] || 'hit';
      const res = await client.livePad(pad, action);
      printJson(res);
      break;
    }

    case 'master': {
      const value = Number(pos[0] ?? 35);
      const res = await client.setMaster(value);
      printJson(res);
      break;
    }

    case 'blackout': {
      const active = pos[0] === 'off' ? false : pos[0] === 'on' ? true : undefined;
      const res = await client.blackout(active);
      printJson(res);
      break;
    }

    case 'frame': {
      const timeSec = pos[0] !== undefined ? Number(pos[0]) : undefined;
      const res = await client.getPreviewFrame(timeSec, flags.track);
      printJson(res);
      break;
    }

    case 'config': {
      const res = await client.getHardwareConfig();
      printJson(res);
      break;
    }

    case 'arm': {
      const armed = pos[0] !== 'off';
      const res = await client.armOutput(armed);
      printJson(res);
      break;
    }

    case 'test-bar': {
      const barId = pos[0] || 'C2';
      const res = await client.testBar(barId);
      printJson(res);
      break;
    }

    default: {
      throw new Error(`Nepoznata naredba: ${command}. Pokrenite 'node cli.mjs help' za popis.`);
    }
  }
}

main().catch(err => {
  process.stderr.write(`Greška: ${err.message}\n`);
  process.exit(1);
});
