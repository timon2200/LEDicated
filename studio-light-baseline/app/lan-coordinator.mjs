import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

export const LAN_PROTOCOL = 'ledicated-lan-v1';
export const DEFAULT_LAN_BUS_PORT = 4049;
export const DEFAULT_MULTICAST_ADDR = '239.255.40.48';

// In-process loopback fanout by port so same-host / multi-instance tests
// do not depend on OS UDP unicast reuseAddr routing quirks on macOS.
const localLoopbackBus = new Map(); // port -> Set<{ serverId, deliver }>

/**
 * Peer-to-peer UDP LAN Stage Coordinator.
 * Coordinates multiple LEDicated server instances running on different laptops
 * on the same LAN so that:
 * 1. Only ONE server/user holds the physical WLED stage lock (ON AIR) at a time.
 * 2. All instances see all connected peers and what song/YouTube video is ON AIR.
 * 3. Handover (Take Over Stage / Auto-Claim on Idle) propagates across the LAN in <5ms.
 */
export function createLanCoordinator({
  serverId = `srv-${randomUUID().slice(0, 8)}`,
  port = 0,
  multicastAddr = DEFAULT_MULTICAST_ADDR,
  broadcastAddrs = ['255.255.255.255', '127.0.0.1'],
  heartbeatMs = 1500,
  peerTtlMs = 6000,
  getLocalState,
  onRemoteClaim,
  onRemoteRelease,
  onRemoteStateChanged
} = {}) {
  let socket = null;
  let closed = false;
  let heartbeatTimer = null;
  const remoteServers = new Map(); // serverId -> { serverId, hostname, lanUrls, httpPort, stageState, claimEpoch, stageOwner, peers, lastSeenAt }

  function pruneStaleRemotes(nowMs = Date.now()) {
    let changed = false;
    for (const [sid, info] of remoteServers.entries()) {
      if (nowMs - info.lastSeenAt > peerTtlMs) {
        remoteServers.delete(sid);
        changed = true;
      }
    }
    return changed;
  }

  function handleMessage(rawBuffer, rinfo) {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(rawBuffer.toString('utf8'));
    } catch {
      return;
    }
    if (!msg || msg.protocol !== LAN_PROTOCOL || !msg.serverId || msg.serverId === serverId) {
      return;
    }

    const nowMs = Date.now();
    const senderIp = rinfo?.address ? String(rinfo.address).replace(/^::ffff:/, '') : '';

    if (msg.type === 'release') {
      const existing = remoteServers.get(msg.serverId);
      if (existing) {
        existing.stageOwner = null;
        existing.stageState = 'idle';
        existing.claimEpoch = Number(msg.claimEpoch) || existing.claimEpoch || 0;
        existing.lastSeenAt = nowMs;
      }
      onRemoteRelease?.({
        serverId: msg.serverId,
        claimEpoch: Number(msg.claimEpoch) || 0,
        clientId: msg.clientId || null
      });
      onRemoteStateChanged?.();
      return;
    }

    if (msg.type === 'claim' || msg.type === 'state') {
      const prev = remoteServers.get(msg.serverId);
      const record = {
        serverId: String(msg.serverId).slice(0, 64),
        hostname: String(msg.hostname || '').slice(0, 80),
        httpPort: Number(msg.httpPort) || 8787,
        lanUrls: Array.isArray(msg.lanUrls) ? msg.lanUrls.slice(0, 6) : [],
        ip: senderIp || prev?.ip || '',
        claimEpoch: Number(msg.claimEpoch) || 0,
        stageState: msg.stageState || (msg.stageOwner ? 'on_air' : 'idle'),
        stageOwner: msg.stageOwner && typeof msg.stageOwner === 'object' ? {
          ...msg.stageOwner,
          serverId: String(msg.serverId).slice(0, 64),
          ip: msg.stageOwner.ip || senderIp || ''
        } : null,
        peers: Array.isArray(msg.peers) ? msg.peers.slice(0, 32).map(p => ({
          ...p,
          serverId: String(msg.serverId).slice(0, 64),
          ip: p.ip === '127.0.0.1' && senderIp ? senderIp : (p.ip || senderIp || '')
        })) : [],
        lastSeenAt: nowMs
      };
      remoteServers.set(record.serverId, record);

      if (record.stageOwner && record.claimEpoch > 0) {
        onRemoteClaim?.({
          serverId: record.serverId,
          claimEpoch: record.claimEpoch,
          stageState: record.stageState,
          stageOwner: record.stageOwner
        });
      }

      const prevSnap = prev ? `${prev.claimEpoch}|${prev.stageState}|${prev.stageOwner?.clientId || ''}|${prev.stageOwner?.trackTitle || ''}|${prev.stageOwner?.isPlaying}|${prev.peers?.length || 0}` : '';
      const nextSnap = `${record.claimEpoch}|${record.stageState}|${record.stageOwner?.clientId || ''}|${record.stageOwner?.trackTitle || ''}|${record.stageOwner?.isPlaying}|${record.peers?.length || 0}`;
      if (prevSnap !== nextSnap || msg.type === 'claim') {
        onRemoteStateChanged?.();
      }
    }
  }

  function sendPacket(payload) {
    if (closed || !socket || !port) return;
    const data = Buffer.from(JSON.stringify({
      protocol: LAN_PROTOCOL,
      serverId,
      timestamp: Date.now(),
      ...payload
    }), 'utf8');

    const targets = new Set([...broadcastAddrs]);
    if (multicastAddr) targets.add(multicastAddr);
    for (const addr of targets) {
      try {
        socket.send(data, 0, data.length, port, addr, () => {});
      } catch {}
    }

    const peersOnPort = localLoopbackBus.get(port);
    if (peersOnPort) {
      for (const peer of peersOnPort) {
        if (peer.serverId !== serverId) {
          queueMicrotask(() => peer.deliver(data, { address: '127.0.0.1', port }));
        }
      }
    }
  }

  function broadcastState(type = 'state', extra = {}) {
    if (closed || !socket || !port || typeof getLocalState !== 'function') return;
    try {
      const local = getLocalState();
      if (!local) return;
      sendPacket({
        type,
        hostname: local.hostname,
        httpPort: local.port,
        lanUrls: local.lanUrls,
        claimEpoch: extra.claimEpoch || local.claimEpoch || 0,
        stageState: local.stageState || 'idle',
        stageOwner: local.localStageOwner || null,
        peers: local.localPeers || []
      });
    } catch {}
  }

  function broadcastClaim(claimData = {}) {
    broadcastState('claim', claimData);
  }

  function broadcastRelease(releaseData = {}) {
    sendPacket({
      type: 'release',
      claimEpoch: releaseData.claimEpoch || Date.now(),
      clientId: releaseData.clientId || null
    });
  }

  const busEntry = { serverId, deliver: (buf, rinfo) => handleMessage(buf, rinfo) };

  async function start() {
    if (!port || port <= 0 || socket || closed) return false;
    return new Promise(resolveStart => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => {
        try { sock.close(); } catch {}
        if (socket === sock) socket = null;
        resolveStart(false);
      });
      sock.on('message', handleMessage);
      sock.bind(port, '0.0.0.0', () => {
        if (closed) {
          try { sock.close(); } catch {}
          return resolveStart(false);
        }
        socket = sock;
        if (!localLoopbackBus.has(port)) localLoopbackBus.set(port, new Set());
        localLoopbackBus.get(port).add(busEntry);
        try { sock.setBroadcast(true); } catch {}
        if (multicastAddr) {
          try { sock.addMembership(multicastAddr); } catch {}
          try { sock.addMembership(multicastAddr, '127.0.0.1'); } catch {}
          try {
            sock.setMulticastTTL(2);
            sock.setMulticastLoopback(true);
          } catch {}
        }
        sock.unref();
        broadcastState('state');
        heartbeatTimer = setInterval(() => {
          const pruned = pruneStaleRemotes();
          broadcastState('state');
          if (pruned) onRemoteStateChanged?.();
        }, heartbeatMs);
        heartbeatTimer.unref?.();
        resolveStart(true);
      });
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    const peersOnPort = localLoopbackBus.get(port);
    if (peersOnPort) {
      peersOnPort.delete(busEntry);
      if (peersOnPort.size === 0) localLoopbackBus.delete(port);
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (socket) {
      const s = socket;
      socket = null;
      await new Promise(done => {
        try { s.close(() => done()); } catch { done(); }
      });
    }
    remoteServers.clear();
  }

  return {
    serverId,
    start,
    close,
    broadcastState,
    broadcastClaim,
    broadcastRelease,
    getRemoteServers() {
      pruneStaleRemotes();
      return [...remoteServers.values()];
    },
    getRemotePeers() {
      pruneStaleRemotes();
      const list = [];
      for (const srv of remoteServers.values()) {
        for (const p of srv.peers || []) {
          list.push({
            ...p,
            remoteServerId: srv.serverId,
            remoteHostname: srv.hostname,
            remoteUrl: srv.lanUrls?.[0] || null
          });
        }
      }
      return list;
    }
  };
}
