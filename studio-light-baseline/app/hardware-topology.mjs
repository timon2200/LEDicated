/** Fixed, reviewable wiring profiles. Port numbers are physical output order. */
export const BAR_IDS = Object.freeze(['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3']);

const c3Routes = [
  ['L1', 'C3-B', 1], ['C1', 'C3-A', 1], ['R1', 'C3-C', 1],
  ['L2', 'C3-B', 2], ['C2', 'C3-A', 2], ['R2', 'C3-C', 2],
  ['L3', 'C3-D', 1], ['C3', 'C3-D', 2], ['R3', 'C3-E', 1]
].map(([bar, node, port]) => ({ bar, node, port, gpio: null }));

const e8Pins = [5, 12, 4, 27, 17, 26, 33, 25];
const e8Routes = BAR_IDS.map((bar, index) => index < 8
  ? { bar, node: 'E8-1', port: index + 1, gpio: e8Pins[index] }
  : { bar, node: 'C3-R3', port: 1, gpio: null });

const e8ColumnRoutes = [
  ['L1', 1, 1, 5], ['L2', 1, 2, 5], ['L3', 1, 3, 5],
  ['R1', 3, 1, 4], ['R2', 3, 2, 4], ['R3', 3, 3, 4],
  ['C2', 5, 1, 17], ['C3', 5, 2, 17], ['C1', 5, 3, 17]
].map(([bar, port, chain, gpio]) => ({ bar, node: 'E8-1', port, chain, gpio }));

export const HARDWARE_PROFILES = Object.freeze([
  { id: 'c3-five', label: '5 × ESP32-C3', description: 'Postojeći softverski baseline: četiri čvora s po dva bara i jedan s jednim.', nodes: ['C3-A', 'C3-B', 'C3-C', 'C3-D', 'C3-E'], routes: c3Routes },
  { id: 'e8-c3', label: 'E8-WiFi Plus + C3', description: 'Plan za naručeni E8 V1.01: O1–O8 za prvih osam barova, C3 za R3.', nodes: ['E8-1', 'C3-R3'], routes: e8Routes },
  { id: 'e8-columns', label: 'E8 · 3 stupca u seriji (O1, O3, O5)', description: 'Jedan E8 kontroler vozi 8 fizičkih barova kroz 3 stupca u seriji: O1 (L1→L2→L3), O3 (R1→R2→R3), O5 (prazno na C1, zatim C2→C3).', nodes: ['E8-1'], routes: e8ColumnRoutes }
]);

export function hardwareProfile(id = 'c3-five') {
  return HARDWARE_PROFILES.find(profile => profile.id === id) || null;
}

export function routesWithOffsets(config) {
  const profile = hardwareProfile(config.profile);
  if (!profile) throw new Error('Nepoznat raspored kontrolera.');
  const bars = new Map(config.bars.map(bar => [bar.id, bar]));
  const offsets = new Map(profile.nodes.map(id => [id, 0]));
  return profile.routes.map(route => {
    const bar = bars.get(route.bar);
    const offset = offsets.get(route.node);
    offsets.set(route.node, offset + bar.pixels);
    return { ...route, pixels: bar.pixels, physicalLeds: bar.physicalLeds, reverse: bar.reverse, offset };
  });
}

export function routesForNode(config, nodeId) {
  return routesWithOffsets(config).filter(route => route.node === nodeId).sort((a, b) => a.port - b.port || (a.chain || 0) - (b.chain || 0));
}
