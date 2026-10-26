/** Local Bonjour discovery. A service announcement is only a candidate until /json/info responds. */
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';

export function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[:-]/g, '').toLowerCase();
  return /^[a-f0-9]{12}$/.test(compact) ? compact : null;
}

export function parseBrowse(output) {
  const names = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /\bAdd\s+\d+\s+\d+\s+local\.\s+_wled\._tcp\.\s+(.+?)\s*$/.exec(line);
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names.slice(0, 16);
}

export function parseResolve(output) {
  const match = /can be reached at\s+([a-z0-9.-]+):80\s+\(interface\s+\d+\)/i.exec(output);
  const host = match?.[1]?.replace(/\.$/, '').toLowerCase() || null;
  return host?.endsWith('.local') ? host : null;
}

function captureDnsSd(args, durationMs) {
  return new Promise(resolve => {
    const child = spawn('/usr/bin/dns-sd', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '', done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ output, error }); };
    const timer = setTimeout(() => child.kill('SIGTERM'), durationMs);
    child.stdout.on('data', data => { output = (output + data).slice(0, 65536); });
    child.stderr.on('data', data => { error = (error + data).slice(0, 1024); });
    child.on('error', err => { error = err.message; finish(); });
    child.on('close', finish);
  });
}

export async function browseBonjour() {
  if (process.platform !== 'darwin') return { names: [], error: 'Automatsko Bonjour traženje trenutačno je podržano na Macu.' };
  const { output, error } = await captureDnsSd(['-B', '_wled._tcp', 'local.'], 2600);
  return { names: parseBrowse(output), error: error || null };
}

export async function resolveBonjour(name) {
  const { output } = await captureDnsSd(['-L', name, '_wled._tcp', 'local.'], 1300);
  return parseResolve(output);
}

function within(promise, timeoutMs) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discovery timeout')), timeoutMs); })])
    .finally(() => clearTimeout(timer));
}

export async function discoverWled({ probe, isAllowedHost, browse = browseBonjour, resolve = resolveBonjour, resolveIp = host => lookup(host, { family: 4 }) } = {}) {
  const { names, error } = await browse();
  const attempts = await Promise.all([...new Set(names)].slice(0, 16).map(async service => {
    try {
      const hostname = await resolve(service);
      if (!hostname) return null;
      const { address } = await within(resolveIp(hostname), 1400);
      if (!isAllowedHost(address)) return null;
      const info = await within(probe(address), 2300);
      if (!info?.reachable || !info.version) return null;
      return { service, host: address, name: info.name || service, version: info.version,
        mac: normalizeMac(info.mac), arch: info.arch || '', ledCount: info.ledCount ?? null,
        rgbw: info.rgbw ?? null, signal: info.signal ?? null, responseMs: info.responseMs ?? null,
        buses: info.buses ?? null };
    } catch { return null; }
  }));
  const byEndpoint = new Map();
  for (const device of attempts) if (device) byEndpoint.set(`${device.mac || device.service}@${device.host}`, device);
  return { devices: [...byEndpoint.values()].sort((a, b) => a.name.localeCompare(b.name)), error: error || null };
}
