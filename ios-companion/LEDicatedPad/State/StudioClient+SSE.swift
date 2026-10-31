import Foundation

@MainActor
public extension StudioClient {
    // MARK: - Live SSE Stream & Remote Payload Applicators

    internal func connectSSEStream() async {
        let encodedId = clientId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? clientId
        guard let url = URL(string: "\(studioHost)/api/live/stream?clientId=\(encodedId)&name=iPhone%20Live%20Pad&role=companion") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3600
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            isConnected = true
            sseStreamingActive = true
            defer { sseStreamingActive = false }

            for try await line in bytes.lines {
                if Task.isCancelled { break }
                guard line.hasPrefix("data:") else { continue }
                let rawJson = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                guard let data = rawJson.data(using: .utf8),
                      let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                if (cmd["clientId"] as? String) == clientId { continue }
                handleSSECommand(cmd)
            }
        } catch {
            isConnected = false
            sseStreamingActive = false
        }
    }

    internal func handleSSECommand(_ cmd: [String: Any]) {
        guard let type = cmd["type"] as? String else { return }
        let now = ProcessInfo.processInfo.systemUptime

        switch type {
        case "frame_sync":
            if let m = (cmd["master"] as? NSNumber)?.doubleValue, abs(masterBrightness - m) > 0.05 { masterBrightness = m }
            let isUnscaled = (cmd["unscaled"] as? Bool) ?? false
            if let barsObj = cmd["bars"] as? [String: Any] {
                frameStore.parseBarsObject(
                    barsObj,
                    unscaled: isUnscaled,
                    masterBrightness: masterBrightness,
                    now: now
                )
            }
            applyServerActivePadIndices(cmd)
            if let playing = cmd["isPlaying"] as? Bool, isPlaying != playing { isPlaying = playing }
            if let t = (cmd["timeSec"] as? NSNumber)?.doubleValue { frameStore.updateTime(t, now: now) }
            if let b = (cmd["bpm"] as? NSNumber)?.doubleValue, b > 0, abs(bpm - b) > 0.05 { bpm = b }
            if let bo = cmd["blackout"] as? Bool, blackout != bo { blackout = bo }
            if let q = cmd["quantize"] as? Bool, quantize != q { quantize = q }

        case "lan_presence":
            applyLanPayload(cmd)

        case "pads_sync":
            applyServerPadsPayload(cmd)

        case "live_pad":
            handleSSELivePadCommand(cmd, now: now)

        case "transport":
            let action = (cmd["action"] as? String) ?? ""
            if action == "play" {
                isPlaying = true
                frameStore.lastSyncUptime = now
            } else if action == "pause" {
                isPlaying = false
            } else if action == "stop" {
                isPlaying = false
                frameStore.updateTime(0, now: now)
            } else if action == "seek", let t = (cmd["timeSec"] as? NSNumber)?.doubleValue {
                frameStore.updateTime(t, now: now)
            }

        case "select_track", "play_show":
            if let tid = cmd["trackId"] as? String, !tid.isEmpty {
                trackId = tid
                if let match = libraryTracks.first(where: { $0.effectiveTrackId == tid || $0.id == tid }) {
                    trackTitle = match.displayTitle
                    if let b = match.bpm, b > 0 { bpm = b }
                    if let d = match.durationSec, d > 0 { durationSec = d }
                }
                if (cmd["autoPlay"] as? Bool) == true || type == "play_show" {
                    isPlaying = true
                    frameStore.updateTime(0, now: now)
                }
            }

        case "play":
            isPlaying = true
            frameStore.lastSyncUptime = now

        case "pause":
            isPlaying = false

        case "seek":
            if let t = (cmd["timeSec"] as? NSNumber)?.doubleValue {
                frameStore.updateTime(t, now: now)
            }

        case "blackout":
            if let b = cmd["value"] as? Bool {
                blackout = b
                if b {
                    activePads.removeAll()
                    heldPads.removeAll()
                }
            }

        case "ambient_light_sync":
            if let amb = cmd["ambientLight"] as? [String: Any] {
                roomLight.applyRemoteSync(amb)
            }

        case "dev_reload":
            Task { await fetchInitialPadsAndStatus() }

        default:
            break
        }
    }

    private func handleSSELivePadCommand(_ cmd: [String: Any], now: TimeInterval) {
        let action = (cmd["action"] as? String) ?? "trigger"
        let idx = (cmd["index"] as? NSNumber)?.intValue ?? (cmd["pad"] as? NSNumber)?.intValue ?? -1
        if action == "clear" || action == "stop_all" {
            activePads.removeAll()
            queuedPads.removeAll()
            heldPads.removeAll()
        } else if action == "release_all" {
            for k in heldPads.keys {
                if pads.indices.contains(k), !pads[k].isLoop {
                    activePads.removeValue(forKey: k)
                }
            }
            heldPads.removeAll()
        } else if action == "quantize", let val = cmd["value"] as? Bool {
            quantize = val
        } else if pads.indices.contains(idx) {
            let padObj = (cmd["effect"] as? [String: Any])
                ?? (cmd["patch"] as? [String: Any])
                ?? (cmd["pad"] as? [String: Any])
            if action == "set", let padObj {
                pads[idx] = PadConfig.fromServerDictionary(padObj, index: idx, fallback: pads[idx])
                savePadsToCache(pads)
            } else if action == "remove" {
                pads[idx] = PadConfig.emptySlot(index: idx)
                activePads.removeValue(forKey: idx)
                savePadsToCache(pads)
            } else if action == "press" {
                let p = pads[idx]
                let wasAct = activePads[idx] != nil
                heldPads[idx] = HeldPadRun(downAt: now, wasActive: wasAct, mode: p.mode)
                if !(p.isLoop && wasAct) {
                    let until = p.isLoop ? .infinity : (now + p.hitDuration(bpm: bpm))
                    activePads[idx] = ActivePadRun(startedAt: now, until: until, held: true)
                }
            } else if action == "release" {
                let p = pads[idx]
                if let hRun = heldPads.removeValue(forKey: idx) {
                    let longPress = (now - hRun.downAt) >= AppConfiguration.holdThresholdSec
                    if hRun.mode == "loop" {
                        if longPress || hRun.wasActive {
                            activePads.removeValue(forKey: idx)
                        } else if var r = activePads[idx] {
                            r.held = false
                            r.until = .infinity
                            activePads[idx] = r
                        }
                    } else {
                        if longPress {
                            activePads.removeValue(forKey: idx)
                        } else if var r = activePads[idx] {
                            r.held = false
                            r.oneShot = true
                            activePads[idx] = r
                        }
                    }
                } else if !p.isLoop {
                    activePads.removeValue(forKey: idx)
                }
            } else if action == "trigger" || action == "hit" || action == "loop" {
                let p = pads[idx]
                if p.isLoop && activePads[idx] != nil {
                    activePads.removeValue(forKey: idx)
                } else {
                    let until = p.isLoop ? .infinity : (now + p.hitDuration(bpm: bpm))
                    activePads[idx] = ActivePadRun(startedAt: now, until: until, held: false)
                }
            }
        }
    }

    internal func applyServerPadsPayload(_ json: [String: Any]) {
        if let q = json["quantize"] as? Bool, quantize != q {
            quantize = q
        }
        applyServerActivePadIndices(json)
        guard let rawPads = json["pads"] as? [Any] else { return }
        var updated = pads
        var changed = false
        for i in 0..<min(AppConfiguration.totalPadSlots, rawPads.count) {
            if let dict = rawPads[i] as? [String: Any] {
                let fallback = i < PadConfig.defaultPads.count ? PadConfig.defaultPads[i] : updated[i]
                let parsed = PadConfig.fromServerDictionary(dict, index: i, fallback: fallback)
                if updated[i] != parsed {
                    updated[i] = parsed
                    changed = true
                }
            } else {
                let empty = PadConfig.emptySlot(index: i)
                if updated[i] != empty {
                    updated[i] = empty
                    activePads.removeValue(forKey: i)
                    changed = true
                }
            }
        }
        if changed {
            pads = updated
            savePadsToCache(updated)
        }
    }

    private static func extractIntArray(_ anyVal: Any?) -> [Int]? {
        if let ints = anyVal as? [Int] { return ints }
        if let nums = anyVal as? [NSNumber] { return nums.map(\.intValue) }
        if let arr = anyVal as? [Any] {
            return arr.compactMap { ($0 as? NSNumber)?.intValue ?? ($0 as? Int) }
        }
        return nil
    }

    internal func applyServerActivePadIndices(_ json: [String: Any]) {
        guard let activeArr = Self.extractIntArray(json["activePads"]) else { return }
        let heldArr = Self.extractIntArray(json["heldPads"]) ?? []
        let now = ProcessInfo.processInfo.systemUptime
        let heldSet = Set(heldArr)
        let serverSet = Set(activeArr)

        for idx in serverSet where pads.indices.contains(idx) {
            if now - (lastLocalActionUptime[idx] ?? 0) < 0.35 { continue }
            if activePads[idx] == nil {
                let pad = pads[idx]
                let until = pad.isLoop ? .infinity : (now + pad.hitDuration(bpm: bpm))
                activePads[idx] = ActivePadRun(startedAt: now, until: until, held: heldSet.contains(idx))
            }
        }

        for (idx, _) in activePads {
            if now - (lastLocalActionUptime[idx] ?? 0) < 0.35 { continue }
            if heldPads[idx] != nil { continue }
            if !serverSet.contains(idx) {
                activePads.removeValue(forKey: idx)
            }
        }
    }

    internal func applyRemoteLiveState(_ live: [String: Any]) {
        if let tid = live["trackId"] as? String, trackId != tid { trackId = tid }
        if let title = live["trackTitle"] as? String, !title.isEmpty, trackTitle != title { trackTitle = title }
        if let sec = live["sectionName"] as? String, !sec.isEmpty, sectionName != sec { sectionName = sec }
        if let playing = live["isPlaying"] as? Bool, isPlaying != playing { isPlaying = playing }
        if let t = (live["timeSec"] as? NSNumber)?.doubleValue {
            frameStore.updateTime(t)
        }
        if let dur = (live["durationSec"] as? NSNumber)?.doubleValue, dur > 0, abs(durationSec - dur) > 0.05 { durationSec = dur }
        if let b = (live["bpm"] as? NSNumber)?.doubleValue, b > 0, abs(bpm - b) > 0.05 { bpm = b }
        if let m = (live["master"] as? NSNumber)?.doubleValue, abs(masterBrightness - m) > 0.05 { masterBrightness = m }
        if let bo = live["blackout"] as? Bool, blackout != bo { blackout = bo }
        if let amb = live["ambientLight"] as? [String: Any] {
            roomLight.applyRemoteSync(amb)
        }
        if live["pads"] != nil {
            applyServerPadsPayload(live)
        } else {
            applyServerActivePadIndices(live)
        }
    }

    internal func applyLanPayload(_ lan: [String: Any]) {
        if let host = lan["hostname"] as? String, !host.isEmpty, serverHostname != host {
            serverHostname = host
        }
        if let ips = lan["ips"] as? [String], let firstIp = ips.first, !firstIp.isEmpty, serverIp != firstIp {
            serverIp = firstIp
        }
        if let urls = lan["lanUrls"] as? [String], !urls.isEmpty {
            for u in urls where !discoveredHosts.contains(u) {
                discoveredHosts.append(u)
            }
        }
        if let st = lan["stageState"] as? String, stageState != st {
            stageState = st
        }
        if let ownerName = lan["stageOwnerName"] as? String, stageOwnerName != ownerName {
            stageOwnerName = ownerName
        }
        isStageOwner = true
    }
}
