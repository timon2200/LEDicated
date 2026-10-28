/** WLED output and hardware setup. Preview and DDP share the final RGBW frame. */
import { BAR_IDS } from './engine.mjs';
import { HARDWARE_PROFILES, hardwareProfile, routesWithOffsets } from './hardware-topology.mjs';
import { clamp, h, toast } from './daw-ui.mjs';

const call = async (path, value) => {
  const response = await fetch(`/api/${path}`, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Veza nije uspjela');
  return result;
};

const routeName = route => route.node.startsWith('E8-')
  ? `${route.node} · O${route.port}${route.chain ? ` (#${route.chain} u seriji)` : ''} · GPIO ${route.gpio}`
  : `${route.node} · izlaz ${route.port} · GPIO provjeriti`;

function template(id, old) {
  const profile = hardwareProfile(id);
  const oldBars = new Map((old?.bars || []).map(bar => [bar.id, bar]));
  return { profile: id, transport: old?.transport || 'rgbw',
    nodes: profile.nodes.map(nodeId => {
      const previous = (old?.nodes || []).find(node => node.id === nodeId);
      return { id: nodeId, host: previous?.host || '', ...(previous?.mac ? { mac: previous.mac } : {}) };
    }),
    bars: BAR_IDS.map(barId => {
      const previous = oldBars.get(barId);
      return { id: barId, node: profile.routes.find(route => route.bar === barId).node,
        pixels: previous?.pixels ?? 12, physicalLeds: previous?.physicalLeds ?? 72, reverse: previous?.reverse ?? false };
    }) };
}

export function createOutput(host, { badge, status, isBlackout, onConfig }) {
  const s = { config: null, draft: null, armed: false, outputMode: 'show', dirty: false, probes: new Map(), discovery: { loading: false, devices: [], error: null, ever: false }, lastTest: null, testRunning: false,
    lastSent: 0, sending: false, failed: false, offsetSec: 0, calibrateFrom: 0, calibrateUntil: 0, manualDisarm: false, autoConnecting: false };
  const note = h('p', { class: 'out-status', 'aria-live': 'polite' }, 'Izlaz nije uključen.');
  const compact = h('div', { class: 'hardware-compact' });
  const arm = h('button', { type: 'button', class: 'primary', onClick: toggleArm }, 'Uključi izlaz');
  const dialog = h('dialog', { class: 'hardware-dialog', 'aria-label': 'Postavke LED kontrolera' });
  const offset = h('input', { type: 'number', min: -2000, max: 2000, step: 10, value: 0, 'aria-label': 'Bluetooth pomak u ms' });
  const gridHint = h('small', { class: 'live-hint' }, 'Detalji rasporeda izlaza su u postavkama.');
  host.append(
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'WLED IZLAZ (DDP)'), compact,
      h('div', { class: 'live-row' }, h('button', { type: 'button', onClick: openSettings }, 'Postavke i dijagnostika'), arm), note,
      h('small', { class: 'live-hint' }, 'WLED odgovor potvrđuje mrežu i konfiguraciju, ne fizički spoj trake.')),
    h('div', { class: 'live-col wide' }, h('div', { class: 'dock-title' }, 'INSTALACIJA 3 × 3'),
      h('div', { class: 'hardware-compact-grid' }, ...BAR_IDS.map(id => h('span', { dataset: { compactBar: id } }, id))),
      gridHint),
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'BLUETOOTH KALIBRACIJA'),
      h('label', {}, 'Pomak (ms; negativno = kasnije svjetlo)', offset),
      h('button', { type: 'button', onClick: runCalibration }, 'Kalibracijski klik + bljesak'),
      h('small', { class: 'live-hint' }, 'Usporedi klik i bljesak na stvarnim zvučnicima i traci.')));
  document.body.append(dialog);
  dialog.addEventListener('close', () => { if (s.dirty) readInputs(); });

  const updateOffset = () => { s.offsetSec = clamp(Number(offset.value) || 0, -2000, 2000) / 1000; localStorage.setItem('ledicated-bluetooth-offset-ms', String(Math.round(s.offsetSec * 1000))); };
  offset.addEventListener('change', updateOffset);
  offset.value = localStorage.getItem('ledicated-bluetooth-offset-ms') || '0'; updateOffset();

  function updateBadge() {
    if (s.outputMode === 'ambient' && !s.armed) {
      badge.textContent = '💡 MENU BAR';
      badge.classList.remove('live');
    } else if (s.yieldedToRemote && !s.armed) {
      badge.textContent = 'NA STAGEU: LAN';
      badge.classList.remove('live');
    } else {
      badge.textContent = s.armed ? 'IZLAZ UKLJUČEN' : 'SIMULACIJA';
      badge.classList.toggle('live', s.armed);
    }
    arm.textContent = s.armed ? 'Isključi izlaz' : 'Uključi izlaz'; arm.classList.toggle('on', s.armed);
    const activeCount = s.config?.nodes.filter(node => node.host).length || 0;
    const totalNodes = s.config?.nodes.length || 0;
    const unavailable = !s.armed && (s.dirty || s.discovery.loading || s.testRunning || isBlackout() || activeCount === 0);
    arm.disabled = unavailable;
    arm.title = unavailable ? 'Spremi postavke, dodijeli barem jedan kontroler i otpusti BLACKOUT.' : '';
    const modalArm = dialog.querySelector('[data-modal-arm]');
    if (modalArm) { modalArm.textContent = arm.textContent; modalArm.disabled = unavailable; modalArm.title = arm.title; }
    note.textContent = s.armed
      ? `DDP ${(s.config?.transport || 'rgb').toUpperCase()} slanje uključeno (${activeCount}/${totalNodes} kontrolera) · prijem na trakama nije potvrđen.`
      : (s.outputMode === 'ambient' ? 'Menu Bar (Uredska rasvjeta) trenutno upravlja EO8+ kontrolerom.' : (s.yieldedToRemote ? (s.reason || 'Drugi laptop na LAN-u trenutno upravlja EO8+ kontrolerom.') : 'Izlaz nije uključen.'));
  }

  function readInputs() {
    if (!s.draft) return;
    const find = (key, id) => [...dialog.querySelectorAll(`[data-${key}]`)].find(el => el.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === id);
    s.draft.transport = dialog.querySelector('[data-transport]')?.value || s.draft.transport;
    for (const node of s.draft.nodes) {
      const input = find('node-host', node.id);
      if (input && node.host !== input.value.trim()) { node.host = input.value.trim(); delete node.mac; }
    }
    for (const bar of s.draft.bars) {
      const count = find('bar-count', bar.id), physical = find('bar-physical', bar.id), reverse = find('bar-reverse', bar.id);
      if (count) bar.pixels = Number(count.value);
      if (physical) bar.physicalLeds = Number(physical.value);
      if (reverse) bar.reverse = reverse.checked;
    }
  }

  function markDirty() {
    s.dirty = true; s.probes.clear();
    const flag = dialog.querySelector('[data-save-state]'); if (flag) flag.textContent = 'Promjene nisu spremljene';
    dialog.querySelector('[data-probe-all]')?.setAttribute('disabled', '');
    dialog.querySelectorAll('[data-probe-node]').forEach(button => button.disabled = true);
    dialog.querySelector('[data-discover]')?.setAttribute('disabled', '');
    updateBadge();
  }

  function render() {
    if (!s.config || !s.draft) return;
    const advancedOpen = dialog.querySelector('details.hardware-advanced')?.open ?? false;
    const profile = hardwareProfile(s.draft.profile), routes = routesWithOffsets(s.draft);
    const total = s.draft.bars.reduce((sum, bar) => sum + bar.pixels, 0);
    const checked = [...s.probes.values()].filter(value => value.reachable && value.countMatches && value.identityMatches !== false && value.busesMatch !== false && (s.draft.transport !== 'rgbw' || value.rgbw === true)).length;
    const pairedCount = s.draft.nodes.filter(node => node.host).length;
    const activeProfile = hardwareProfile(s.config.profile);
    compact.replaceChildren(h('strong', {}, activeProfile.label), h('span', {}, `${s.config.nodes.length} ${s.config.nodes.length === 1 ? 'kontroler' : 'kontrolera'} · 9 barova · ${s.config.bars.reduce((sum, bar) => sum + bar.pixels, 0)} grupa`));
    gridHint.textContent = `${activeProfile.description} Detalji su u postavkama.`;
    host.querySelectorAll('[data-compact-bar]').forEach(el => {
      const route = routes.find(item => item.bar === el.dataset.compactBar);
      el.textContent = `${route.bar} · ${route.node.startsWith('E8-') ? `O${route.port}` : route.node}`;
    });

    const profileSelect = h('select', { 'aria-label': 'Raspored kontrolera', disabled: s.discovery.loading, onChange: event => {
      readInputs(); s.draft = template(event.target.value, s.draft); markDirty(); render();
    } }, ...HARDWARE_PROFILES.map(item => h('option', { value: item.id, selected: item.id === profile.id }, item.label)));
    const modeSelect = h('select', { dataset: { transport: '' }, 'aria-label': 'Način DDP izlaza', disabled: s.discovery.loading, onChange: markDirty },
      h('option', { value: 'rgbw', selected: s.draft.transport === 'rgbw' }, 'RGBW · zaseban bijeli kanal'),
      h('option', { value: 'rgb', selected: s.draft.transport === 'rgb' }, 'RGB · približna bijela'));
    const foundDevices = s.discovery.devices.map(device => {
      const paired = s.draft.nodes.find(node => device.mac ? node.mac === device.mac : node.host === device.host);
      const ambiguous = Boolean(device.mac && s.discovery.devices.filter(item => item.mac === device.mac).length > 1);
      return h('article', { class: 'hardware-found-device' },
        h('div', { class: 'hardware-found-icon' }, 'W'),
        h('div', { class: 'hardware-found-copy' }, h('strong', {}, device.name || device.service),
          h('span', {}, `WLED ${device.version} · ${device.ledCount ?? '?'} grupa · Wi-Fi ${device.signal ?? '?'}%`),
          h('small', {}, `${device.host} · ${device.mac || 'identitet nije dostupan'}`),
          ambiguous && h('small', { class: 'hardware-port-mismatch' }, 'Isti identitet viđen je na više IP adresa; dodjela je zaustavljena.')),
        h('label', {}, 'Uloga', h('select', { 'aria-label': `Uloga za ${device.name || device.service}`, disabled: s.armed || s.discovery.loading || ambiguous,
          onChange: event => pairDevice(device, event.target.value) },
        h('option', { value: '', selected: !paired }, 'Odaberi…'),
        ...s.draft.nodes.map(node => h('option', { value: node.id, selected: paired?.id === node.id }, node.id)))));
    });
    const stageCards = routes.map(route => {
      const node = s.draft.nodes.find(item => item.id === route.node), result = s.probes.get(route.node);
      const mismatch = result?.countMatches === false || result?.identityMatches === false || result?.busesMatch === false || (s.draft.transport === 'rgbw' && result?.rgbw === false);
      const uncertain = Boolean(result?.reachable && (result.countMatches !== true || (s.draft.transport === 'rgbw' && result.rgbw !== true)));
      const ready = Boolean(node?.host && result?.reachable && !mismatch && !uncertain);
      const phase = !node?.host ? 'Čeka kontroler' : !result ? 'Čeka provjeru' : !result.reachable ? 'Nema odgovora' : mismatch ? 'Postavke ne odgovaraju' : uncertain ? 'Provjera nepotpuna' : 'Mreža spremna';
      const kind = !node?.host ? 'missing' : ready ? 'ready' : mismatch || uncertain || result?.reachable === false ? 'warn' : 'pending';
      return h('article', { class: `hardware-stage-bar ${kind}` },
        h('div', { class: 'hardware-stage-top' }, h('strong', {}, route.bar), h('span', {}, route.node.startsWith('E8-') ? `O${route.port}` : route.node)),
        h('small', {}, phase),
        h('button', { type: 'button', disabled: !ready || s.dirty || s.armed || s.testRunning || isBlackout(),
          'aria-label': `Kratki test bara ${route.bar}`, onClick: () => testBar(route.bar) }, s.lastTest === route.bar ? 'Ponovi test' : 'Kratki test'));
    });
    const devices = s.draft.nodes.map(node => {
      const assigned = routes.filter(route => route.node === node.id), expected = assigned.reduce((sum, route) => sum + route.pixels, 0);
      const result = s.probes.get(node.id);
      const state = !result ? 'Nije provjereno' : !result.reachable ? `Nema odgovora: ${result.error}`
        : `${result.name || 'WLED'} · v${result.version || '?'} · ${result.ledCount ?? '?'} / ${expected} grupa · Wi-Fi ${result.signal ?? '?'}% · ${result.responseMs ?? '?'} ms`;
      const quality = !result ? 'unknown' : !result.reachable ? 'bad' : result.countMatches !== true || result.identityMatches === false || result.busesMatch === false || (s.draft.transport === 'rgbw' && result.rgbw !== true) ? 'warn' : 'good';
      const detail = result?.reachable ? `RGBW: ${result.rgbw === null ? 'nepoznato' : result.rgbw ? 'da' : 'ne'} · live prijem: ${result.live ? 'aktivan' : 'nije aktivan'} · ${result.arch || 'platforma nepoznata'}`
        : 'Spremi IP pa provjeri WLED. Fizički spoj ostaje nepotvrđen.';
      const portDetail = !result?.reachable ? '' : result.busesMatch === null
        ? 'Detaljna provjera WLED izlaza nije dostupna za ovaj firmware.'
        : `WLED izlazi ${result.busesMatch ? 'odgovaraju planu' : 'NE odgovaraju planu'}: ${result.buses.map(bus => `GPIO ${bus.pin ?? '?'} · ${bus.start ?? '?'}+${bus.length ?? '?'}`).join(' / ') || 'nema izlaza'}`;
      return h('article', { class: 'hardware-device' },
        h('div', { class: 'hardware-device-head' }, h('strong', {}, node.id), h('span', {}, `${assigned.length} izlaza · ${expected} grupa`)),
        h('label', {}, 'IP adresa na lokalnoj mreži', h('input', { type: 'text', inputMode: 'decimal', placeholder: '192.168.1.50', value: node.host, dataset: { nodeHost: node.id }, disabled: s.discovery.loading, onInput: markDirty })),
        h('p', { class: `hardware-probe ${quality}`, 'aria-live': 'polite' }, state), h('small', {}, detail),
        result?.identityMatches === false && h('small', { class: 'hardware-port-mismatch' }, 'Na toj IP adresi odgovara drugi WLED. Pokreni ponovno traženje.'),
        portDetail && h('small', { class: result.busesMatch === false ? 'hardware-port-mismatch' : '' }, portDetail),
        h('button', { type: 'button', dataset: { probeNode: node.id }, disabled: s.dirty || !node.host, onClick: () => probeOne(node.id) }, 'Provjeri WLED'));
    });
    const bars = routes.map(route => h('article', { class: 'hardware-bar' },
      h('div', { class: 'hardware-bar-head' }, h('strong', {}, route.bar), h('span', {}, `DDP ${route.offset}–${route.offset + route.pixels - 1}`)),
      h('small', {}, routeName(route)),
      h('div', { class: 'hardware-bar-fields' },
        h('label', {}, 'Grupe', h('input', { type: 'number', min: 1, max: 72, value: route.pixels, dataset: { barCount: route.bar }, 'aria-label': `Adresabilne grupe ${route.bar}`, disabled: s.discovery.loading, onInput: markDirty, onChange: () => { readInputs(); render(); } })),
        h('label', {}, 'Diode', h('input', { type: 'number', min: 1, max: 600, value: route.physicalLeds, dataset: { barPhysical: route.bar }, 'aria-label': `Fizičke LED diode ${route.bar}`, disabled: s.discovery.loading, onInput: markDirty })),
        h('label', { class: 'hardware-reverse' }, h('input', { type: 'checkbox', checked: route.reverse, dataset: { barReverse: route.bar }, disabled: s.discovery.loading, onChange: markDirty }), ' Obrni'))));

    dialog.replaceChildren(
      h('div', { class: 'hardware-header' }, h('div', {}, h('span', { class: 'hardware-kicker' }, 'LEDICATED · HARDVER'), h('h2', {}, 'Postavke kontrolera'),
        h('p', {}, 'Plan izlaza, stanje WLED-a i priprema za prvi stvarni test.')),
      h('button', { type: 'button', class: 'hardware-close', 'aria-label': 'Zatvori postavke', onClick: () => dialog.close() }, '×')),
      h('div', { class: 'hardware-scroll' },
        h('div', { class: 'hardware-stats' },
          h('div', {}, h('b', {}, `${pairedCount}/${s.draft.nodes.length}`), h('span', {}, 'kontrolera dodijeljeno')),
          h('div', {}, h('b', {}, '9'), h('span', {}, 'barova')),
          h('div', {}, h('b', {}, String(total)), h('span', {}, 'planiranih grupa')),
          h('div', {}, h('b', {}, `${checked}/${s.draft.nodes.length}`), h('span', {}, 'WLED bez neslaganja'))),
        h('div', { class: 'hardware-steps' },
          h('span', {}, '1 · Ista Wi-Fi mreža'), h('span', {}, '2 · Pronađi'), h('span', {}, '3 · Dodijeli'), h('span', {}, '4 · Testiraj')),
        h('section', { class: 'hardware-section' }, h('h3', {}, '1 · Raspored'), h('p', {}, profile.description),
          h('div', { class: 'hardware-selects' }, h('label', {}, 'Kontroleri', profileSelect), h('label', {}, 'DDP format', modeSelect)),
          profile.id === 'e8-c3' && h('p', { class: 'hardware-caution' }, 'E8 V1.01 ima osam izlaza; R3 koristi C3. Lightish installer nudi WLED 0.12.0, a RGBW DDP treba provjeriti na stvarnoj pločici.')),
        h('section', { class: 'hardware-section' }, h('div', { class: 'hardware-section-title' }, h('div', {}, h('h3', {}, '2 · Pronađeni WLED uređaji'),
          h('p', {}, 'Mac traži WLED na istoj lokalnoj mreži. Sama pojava uređaja ne pali svjetlo.')),
          h('button', { type: 'button', dataset: { discover: '' }, disabled: s.dirty || s.armed || s.discovery.loading, onClick: scan }, s.discovery.loading ? 'Tražim…' : 'Traži ponovno')),
          h('p', { class: `hardware-discovery-state ${s.discovery.error ? 'warn' : ''}`, 'aria-live': 'polite' },
            s.discovery.loading ? 'Tražim WLED preko Bonjoura i provjeravam odgovor…'
              : s.discovery.error ? `${s.discovery.errorKind || 'Bonjour'}: ${s.discovery.error}`
                : s.discovery.ever ? `${s.discovery.devices.length} uređaja potvrđeno na mreži.` : 'Potraga kreće pri otvaranju postavki.'),
          foundDevices.length ? h('div', { class: 'hardware-found-list' }, ...foundDevices)
            : s.discovery.ever && !s.discovery.loading && h('div', { class: 'hardware-empty' },
              h('strong', {}, 'Nema pronađenog WLED-a'),
              h('span', {}, 'Uključi kontroler i spoji ga na istu Wi-Fi mrežu kao Mac. Novi WLED prvo može otvoriti WLED-AP; tamo mu postavi kućnu Wi-Fi mrežu pa se vrati ovamo.'),
              h('a', { href: 'https://kno.wled.ge/basics/getting-started/', target: '_blank', rel: 'noopener noreferrer' }, 'Upute za prvi WLED spoj ↗')),
          h('button', { type: 'button', class: 'hardware-text-button', onClick: () => { const details = dialog.querySelector('details.hardware-advanced'); details.open = true; details.scrollIntoView({ block: 'start' }); } }, 'Unesi IP ručno / napredne postavke')),
        h('section', { class: 'hardware-section' }, h('h3', {}, '3 · Devet barova'),
          h('p', {}, 'Mrežni status nije potvrda fizičkog spoja. Kratki test šalje slab crveni bljesak samo na odabrani bar, nakon što spremiš postavke i provjeriš WLED.'),
          h('div', { class: 'hardware-stage-grid' }, ...stageCards)),
        h('details', { class: 'hardware-section hardware-advanced', open: advancedOpen },
          h('summary', {}, 'Napredno · IP adrese, WLED dijagnostika, GPIO i grupe'),
          h('div', { class: 'hardware-advanced-body' },
            h('div', { class: 'hardware-section-title' }, h('div', {}, h('h3', {}, 'Mrežni kontroleri'),
              h('p', {}, 'Ručno unesi privatnu IP adresu kad Bonjour nije dostupan. Promjena IP-a briše ranije automatsko uparivanje.')),
              h('button', { type: 'button', dataset: { probeAll: '' }, disabled: s.dirty || !s.draft.nodes.some(node => node.host), onClick: probeAll }, 'Provjeri povezane')),
            h('div', { class: 'hardware-devices' }, ...devices),
            h('h3', {}, 'Barovi i izlazi'),
            h('p', {}, 'DDP početak računa se iz duljina prethodnih izlaza istog kontrolera.'),
            h('div', { class: 'hardware-bars' }, ...bars),
            h('p', { class: 'hardware-caution' }, '12 grupa i 72 diode po baru su procjene. Smjer, RGBW redoslijed i struja čekaju mjerenje.'))),
        h('section', { class: 'hardware-section hardware-checklist' }, h('h3', {}, '4 · Prvi stvarni test'),
          h('ul', {}, h('li', {}, 'Potvrdi reviziju E8 i firmware, zatim WLED postavke svakog izlaza.'),
            h('li', {}, 'Na jednom osiguranom baru izmjeri grupe, boje, struju, temperaturu i smjer.'),
            h('li', {}, 'Postavi tamni WLED realtime fallback i provjeri BLACKOUT pri prekidu mreže.'),
            h('li', {}, 'Izmjeri Bluetooth pomak na stvarnom zvučniku i traci.')),
          h('a', { href: 'https://kno.wled.ge/interfaces/ddp/', target: '_blank', rel: 'noopener noreferrer' }, 'WLED DDP upute ↗'))),
      h('div', { class: 'hardware-footer' }, h('span', { dataset: { saveState: '' }, 'aria-live': 'polite' }, s.dirty ? 'Promjene nisu spremljene' : 'Postavke spremljene · fizički spoj nepotvrđen'),
        h('button', { type: 'button', onClick: () => dialog.close() }, 'Zatvori'),
        h('button', { type: 'button', dataset: { saveConfig: '' }, onClick: saveConfig, disabled: s.armed || s.discovery.loading }, 'Spremi postavke'),
        h('button', { type: 'button', class: 'primary', dataset: { modalArm: '' }, disabled: s.discovery.loading, onClick: toggleArm }, s.armed ? 'Isključi izlaz' : 'Uključi izlaz')));
    updateBadge();
  }

  function openSettings() {
    if (!s.config) return;
    render(); dialog.showModal();
    if (!s.dirty && !s.armed) scan();
  }
  async function scan() {
    if (s.dirty || s.armed || s.discovery.loading) return;
    s.discovery.loading = true; s.discovery.error = null; render();
    try {
      const result = await call('discover', {});
      s.discovery = { loading: false, devices: result.devices || [], error: result.error || result.rebindError,
        errorKind: result.rebindError ? 'IP promjena' : 'Bonjour', ever: true };
      if (result.rebound && !s.dirty) {
        s.config = result.config; s.draft = structuredClone(result.config);
        s.probes.clear(); onConfig?.(s.config);
        toast('WLED je pronađen na novoj IP adresi.');
      }
      render();
      if (!s.dirty) await probeAll();
    } catch (error) {
      s.discovery = { ...s.discovery, loading: false, error: error.message, errorKind: 'Traženje', ever: true };
      render();
    }
  }
  function pairDevice(device, nodeId) {
    if (s.armed) return;
    readInputs();
    for (const node of s.draft.nodes) {
      if (nodeId && node.id === nodeId) { node.host = device.host; if (device.mac) node.mac = device.mac; else delete node.mac; }
      else if ((device.mac && node.mac === device.mac) || node.host === device.host) { node.host = ''; delete node.mac; }
    }
    markDirty(); render();
  }
  async function testBar(barId) {
    if (s.dirty || s.armed || s.testRunning) return;
    if (isBlackout()) return toast('Prvo otpusti BLACKOUT.', 'error');
    s.testRunning = true; render();
    try {
      const result = await call('test-bar', { barId, confirm: true });
      if (result.interrupted) toast('Kratki test prekinut BLACKOUT-om.');
      else { s.lastTest = barId; toast(`Kratki crveni test poslan na ${barId}. Provjeri je li zasvijetlio upravo taj bar.`); }
    } catch (error) { toast(error.message, 'error'); }
    finally { s.testRunning = false; render(); }
  }
  async function saveConfig() {
    try {
      readInputs(); const saved = await call('config', s.draft);
      s.config = saved.config; s.draft = structuredClone(saved.config); s.dirty = false; s.probes.clear();
      onConfig?.(s.config); render(); toast('Postavke kontrolera spremljene.');
      await probeAll();
    } catch (error) { const flag = dialog.querySelector('[data-save-state]'); if (flag) flag.textContent = error.message; toast(error.message, 'error'); }
  }
  async function probeOne(nodeId) { if (s.dirty) return; try { s.probes.set(nodeId, await call('probe', { nodeId })); render(); } catch (error) { toast(error.message, 'error'); } }
  async function probeAll() { await Promise.all(s.config.nodes.filter(node => node.host).map(node => probeOne(node.id))); }
  async function autoConnect({ allowDiscovery = true, silent = false } = {}) {
    if (s.armed || s.autoConnecting || s.dirty || s.testRunning || isBlackout?.() || s.manualDisarm || window.ledicatedRemoteStageOwner) return false;
    s.autoConnecting = true;
    if (!silent) note.textContent = 'Automatsko spajanje na EO8+…';
    try {
      const result = await call('auto-connect', { allowDiscovery });
      if (result.config && !s.dirty) {
        s.config = result.config;
        s.draft = structuredClone(result.config);
        onConfig?.(s.config);
      }
      s.yieldedToRemote = Boolean(result.yieldedToRemote);
      if (result.reason) s.reason = result.reason;
      if (result.armed) {
        s.armed = true;
        s.yieldedToRemote = false;
        s.failed = false;
        render();
        const e8 = s.config?.nodes?.find(n => n.id === 'E8-1') || s.config?.nodes?.find(n => n.host);
        const hostInfo = result.host || e8?.host || '';
        const msg = `EO8+ automatski povezan${hostInfo ? ` (${hostInfo})` : ''} · izlaz uključen.`;
        status?.(msg);
        toast(msg);
        probeAll().catch(() => {});
        return true;
      }
      render();
      return false;
    } catch {
      render();
      return false;
    } finally {
      s.autoConnecting = false;
    }
  }
  async function setArmed(armed) {
    if (s.armed === armed) return;
    if (isBlackout() && armed) throw new Error('Prvo otpusti BLACKOUT.');
    if (s.dirty && armed) throw new Error('Najprije spremi promjene u postavkama.');
    if (s.dirty) readInputs();
    if (!armed) s.manualDisarm = true;
    else s.manualDisarm = false;
    const result = await call('arm', { armed, userInitiated: true });
    s.armed = result.armed;
    if (result.outputMode) s.outputMode = result.outputMode;
    s.yieldedToRemote = Boolean(result.yieldedToRemote);
    s.failed = false;
    render();
  }

  async function toggleArm() {
    try {
      const targetArmed = !s.armed;
      if (targetArmed) s.manualDisarm = false;
      else s.manualDisarm = true;
      await setArmed(targetArmed);
    } catch (error) {
      if (!s.armed) {
        const connected = await autoConnect({ allowDiscovery: true, silent: false });
        if (connected) return;
      }
      note.textContent = error.message;
      toast(error.message, 'error');
    }
  }
  async function runCalibration() {
    const audioContext = new AudioContext(), oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), clickAt = audioContext.currentTime + 2.1;
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(.18, clickAt); gain.gain.exponentialRampToValueAtTime(.001, clickAt + .08);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(clickAt); oscillator.stop(clickAt + .08); oscillator.onended = () => audioContext.close();
    s.calibrateFrom = performance.now() + 2100 - s.offsetSec * 1000; s.calibrateUntil = s.calibrateFrom + 120;
    status('Klik i bljesak stižu za oko 2 s. Negativan pomak odgađa svjetlo; usporedi ih na zvučniku i traci.');
  }
  async function blackout() { try { await call('blackout', {}); } catch (error) { toast(error.message, 'error'); } }
  async function init() {
    try {
      const state = await call('state'); s.config = state.config; s.draft = structuredClone(state.config); s.armed = state.armed;
      s.outputMode = state.outputMode || 'show';
      if (state.ambientOverride || s.outputMode === 'ambient') s.manualDisarm = true;
      s.yieldedToRemote = Boolean(state.yieldedToRemote);
      s.reason = state.reason || '';
      render(); onConfig?.(s.config);
      if (!s.armed && s.outputMode !== 'ambient' && !s.manualDisarm && !s.yieldedToRemote && !isBlackout?.()) {
        const fastConnected = await autoConnect({ allowDiscovery: false, silent: true });
        if (!fastConnected) {
          autoConnect({ allowDiscovery: true, silent: true }).catch(() => {});
        }
      } else if (s.armed) {
        probeAll().catch(() => {});
      }
    } catch (error) { toast(`Lokalna veza nije dostupna: ${error.message}`, 'error'); }
    updateBadge();
  }
  setInterval(() => {
    if (!document.hidden && !s.armed && s.outputMode !== 'ambient' && !s.yieldedToRemote && !window.ledicatedRemoteStageOwner && !s.manualDisarm && !s.dirty && !s.testRunning && !isBlackout?.() && !dialog.open) {
      autoConnect({ allowDiscovery: true, silent: true }).catch(() => {});
    }
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !s.armed && s.outputMode !== 'ambient' && !s.yieldedToRemote && !window.ledicatedRemoteStageOwner && !s.manualDisarm && !s.dirty && !s.testRunning && !isBlackout?.()) {
      autoConnect({ allowDiscovery: false, silent: true }).catch(() => {});
    }
  });
  addEventListener('pagehide', () => {
    if (s.armed && window.ledicatedIsStageOwner !== false && (window.ledicatedPeerCount || 1) <= 1) {
      navigator.sendBeacon('/api/blackout', new Blob(['{}'], { type: 'application/json' }));
    }
  });
  return { init, blackout, updateBadge, render, openSettings, setArmed, autoConnect,
    syncServerState(serverState) {
      if (!serverState) return;
      if (serverState.config && !s.dirty) {
        s.config = serverState.config;
        s.draft = structuredClone(serverState.config);
        onConfig?.(s.config);
      }
      if ('yieldedToRemote' in serverState) {
        s.yieldedToRemote = Boolean(serverState.yieldedToRemote);
      }
      if (serverState.reason) s.reason = serverState.reason;
      if (serverState.outputMode) s.outputMode = serverState.outputMode;
      if (serverState.ambientOverride || serverState.outputMode === 'ambient') {
        s.manualDisarm = true;
        s.outputMode = 'ambient';
      }
      if (typeof serverState.armed === 'boolean') {
        if (!serverState.armed && s.armed && !s.yieldedToRemote && s.outputMode !== 'ambient' && !isBlackout?.() && String(serverState.reason || '').startsWith('Prekid veze')) {
          if (!s.rearming && window.ledicatedIsStageOwner !== false && !window.ledicatedRemoteStageOwner) {
            s.rearming = true;
            call('arm', { armed: true })
              .then(st => { s.armed = Boolean(st.armed); if (s.armed) { s.failed = false; s.outputMode = 'show'; s.manualDisarm = false; } render(); })
              .catch(() => { s.armed = false; render(); })
              .finally(() => { s.rearming = false; });
          }
          return;
        }
        s.armed = serverState.armed;
        if (s.armed) {
          s.failed = false;
          s.yieldedToRemote = false;
          s.manualDisarm = false;
          s.outputMode = 'show';
        }
      }
      render();
    },
    get config() { return s.config; }, get armed() { return s.armed; }, get outputMode() { return s.outputMode; }, get offsetSec() { return s.offsetSec; },
    disarm() { s.armed = false; updateBadge(); },
    calibrationFrame(brightnessPct) {
      const t = performance.now(); if (t < s.calibrateFrom || t >= s.calibrateUntil) return null;
      const white = Math.round(100 * clamp(brightnessPct / 100, 0, 1));
      return { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: 12 }, () => [0, 0, 0, white])])) };
    },
    send(frameOrGetter, t = performance.now() / 1000) {
      if (!s.armed || window.ledicatedIsStageOwner === false) { s.pendingFrame = null; return; }
      s.pendingFrame = frameOrGetter;
      if (s.sending || s.flushTimer) return;
      const minInterval = 1 / 65;
      const elapsed = t - s.lastSent;
      if (elapsed < minInterval) {
        s.flushTimer = setTimeout(() => {
          s.flushTimer = 0;
          if (s.armed && s.pendingFrame) this.send(s.pendingFrame, performance.now() / 1000);
        }, Math.max(1, Math.ceil((minInterval - elapsed) * 1000)));
        return;
      }
      const nextSource = s.pendingFrame;
      s.pendingFrame = null;
      const next = typeof nextSource === 'function' ? nextSource(t) : nextSource;
      if (!next?.bars) return;
      s.sending = true; s.lastSent = t;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      fetch('/api/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bars: next.bars,
          clientId: window.ledicatedClientId || undefined,
          clientName: window.ledicatedClientName || undefined
        }),
        signal: controller.signal
      })
        .then(async response => {
          clearTimeout(timeoutId);
          if (response.status === 429) {
            await response.text().catch(() => {});
            s.failCount = 0;
            return;
          }
          if (response.status === 409) {
            await response.text().catch(() => {});
            if (s.armed && !isBlackout?.() && !s.rearming) {
              s.rearming = true;
              try {
                const st = await call('arm', { armed: true });
                s.armed = Boolean(st.armed);
                if (s.armed) { s.failCount = 0; updateBadge(); return; }
              } catch {} finally {
                s.rearming = false;
              }
            }
            s.armed = false; s.pendingFrame = null; updateBadge();
            return;
          }
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Veza nije uspjela');
          }
          await response.text().catch(() => {});
          s.failCount = 0;
        })
        .catch(async error => {
          clearTimeout(timeoutId);
          s.failCount = (s.failCount || 0) + 1;
          if (s.failCount < 10) return; // Ignore transient hiccups
          s.armed = false; s.pendingFrame = null; s.failCount = 0; updateBadge();
          if (!s.failed) { s.failed = true; toast(`Izlaz zaustavljen: ${error.message}`, 'error'); }
          await blackout();
        })
        .finally(() => {
          clearTimeout(timeoutId);
          s.sending = false;
          if (s.armed && s.pendingFrame && !s.flushTimer) {
            this.send(s.pendingFrame, performance.now() / 1000);
          }
        });
    }
  };
}
