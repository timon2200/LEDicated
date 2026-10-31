import Foundation

@MainActor
public extension StudioClient {
    // MARK: - HTTP Polling, Library Fetch & Command Dispatch

    func startNetworking() {
        sseTask?.cancel()
        pollTask?.cancel()
        localHousekeepingTask?.cancel()

        Task {
            await roomLight.pollDirectE8()
            let ok = await fetchInitialPadsAndStatus()
            if !ok {
                await autoDiscoverStudio(switchOnFind: true)
            } else {
                await fetchLibraryTracks()
            }
        }

        sseTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.connectSSEStream()
                try? await Task.sleep(nanoseconds: 1_200_000_000)
            }
        }

        pollTask = Task { [weak self] in
            guard let self else { return }
            var consecutiveFailures = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                let ok = await self.pollStatusQuietly()
                if ok {
                    consecutiveFailures = 0
                } else {
                    await self.roomLight.pollDirectE8()
                    consecutiveFailures += 1
                    if consecutiveFailures == 2 {
                        await self.autoDiscoverStudio(switchOnFind: true)
                    }
                }
            }
        }

        // Lightweight 30 Hz state housekeeping outside SwiftUI view body rendering
        localHousekeepingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 33_000_000)
                self.housekeepActivePads(now: ProcessInfo.processInfo.systemUptime)
            }
        }
    }

    func reconnect(to newHost: String) {
        let trimmed = newHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var normalized = trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") ? trimmed : "http://\(trimmed)"
        if normalized.hasSuffix("/") {
            normalized = String(normalized.dropLast())
        }
        if let url = URL(string: normalized), url.port == nil {
            normalized += ":\(AppConfiguration.defaultPort)"
        }
        studioHost = normalized
        lastStatusMessage = "Spajam na \(shortHostLabel)…"
        startNetworking()
    }

    func sendCommand(_ payload: [String: Any]) {
        var body = payload
        body["clientId"] = clientId
        body["clientName"] = "iPhone Live Pad"
        body["source"] = "ios-pad"

        let action = (body["action"] as? String) ?? ""
        let touchId = (body["touchId"] as? String) ?? ""
        let isSnap = (body["snap"] as? Bool) == true

        if action == "touch_move" && !isSnap && !touchId.isEmpty {
            if let existingIdx = commandQueue.lastIndex(where: {
                (($0["action"] as? String) == "touch_move") &&
                (($0["touchId"] as? String) == touchId) &&
                (($0["snap"] as? Bool) != true)
            }) {
                commandQueue[existingIdx] = body
            } else {
                commandQueue.append(body)
            }
        } else if action == "touch_up" && !touchId.isEmpty {
            commandQueue.removeAll {
                (($0["action"] as? String) == "touch_move") &&
                (($0["touchId"] as? String) == touchId) &&
                (($0["snap"] as? Bool) != true)
            }
            commandQueue.append(body)
        } else if action == "set_color" || action == "set_intensity" {
            if let existingIdx = commandQueue.lastIndex(where: { ($0["action"] as? String) == action }) {
                commandQueue[existingIdx] = body
            } else {
                commandQueue.append(body)
            }
        } else if action == "clear" || action == "release_all" {
            commandQueue.removeAll { ($0["type"] as? String) == "live_pad" }
            commandQueue.append(body)
        } else {
            commandQueue.append(body)
        }

        if !isDrainingCommands {
            isDrainingCommands = true
            Task { @MainActor [weak self] in
                await self?.drainCommandQueue()
            }
        }
    }

    private func drainCommandQueue() async {
        defer { isDrainingCommands = false }
        while !commandQueue.isEmpty {
            let body = commandQueue.removeFirst()
            guard let url = URL(string: "\(studioHost)/api/live/command") else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 1.5
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)

            let t0 = ProcessInfo.processInfo.systemUptime
            do {
                let (data, response) = try await fastSession.data(for: req)
                if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                    let now = ProcessInfo.processInfo.systemUptime
                    let ms = max(1, Int(((now - t0) * 1000.0).rounded()))
                    if !isConnected { isConnected = true }
                    if now - lastRttUpdateUptime > 0.5 && abs(rttMs - ms) >= 2 {
                        lastRttUpdateUptime = now
                        rttMs = ms
                    }
                    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        applyServerActivePadIndices(json)
                    }
                }
            } catch {
                if isConnected { isConnected = false }
            }
        }
    }

    @discardableResult
    func fetchInitialPadsAndStatus() async -> Bool {
        guard let url = URL(string: "\(studioHost)/api/live/pads") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.6
        let t0 = ProcessInfo.processInfo.systemUptime
        do {
            let (data, response) = try await fastSession.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
            self.rttMs = max(1, Int(((ProcessInfo.processInfo.systemUptime - t0) * 1000.0).rounded()))
            self.isConnected = true
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let live = json["liveState"] as? [String: Any] {
                    applyRemoteLiveState(live)
                }
                applyServerPadsPayload(json)
                if let lan = json["lan"] as? [String: Any] {
                    applyLanPayload(lan)
                }
                lastStatusMessage = "Spojeno s \(serverHostname) (\(serverIp))"
            }
            return true
        } catch {
            isConnected = false
            return false
        }
    }

    func fetchLibraryTracks() async {
        guard let tracksUrl = URL(string: "\(studioHost)/api/library/tracks") else { return }
        let sharedUrl = URL(string: "\(studioHost)/api/library/shared-shows")

        var localTracks: [LibraryTrack] = []
        do {
            let (data, _) = try await fastSession.data(from: tracksUrl)
            struct Wrapper: Decodable { let tracks: [LibraryTrack]? }
            if let decoded = try? JSONDecoder().decode(Wrapper.self, from: data),
               let list = decoded.tracks {
                localTracks = list
            }
        } catch {}

        var sharedEntries: [[String: Any]] = []
        if let sUrl = sharedUrl {
            do {
                let (sData, _) = try await fastSession.data(from: sUrl)
                if let json = try? JSONSerialization.jsonObject(with: sData) as? [String: Any],
                   let shows = json["shows"] as? [[String: Any]] {
                    sharedEntries = shows
                }
            } catch {}
        }

        var byLocalId: [String: LibraryTrack] = [:]
        var byTitleLower: [String: String] = [:]
        for tr in localTracks {
            byLocalId[tr.id] = tr
            byTitleLower[tr.displayTitle.lowercased()] = tr.id
        }

        var unlinkedShared: [LibraryTrack] = []
        for entry in sharedEntries {
            let showId = entry["showId"] as? String
            let filename = entry["filename"] as? String
            let title = (entry["title"] as? String) ?? filename?.replacingOccurrences(of: ".ledshow.json", with: "") ?? "Light Show"
            let author = (entry["updatedBy"] as? String) ?? (entry["author"] as? String)
            let version = (entry["version"] as? NSNumber)?.intValue
            let clipCount = (entry["clipCount"] as? NSNumber)?.intValue
            let layerCount = (entry["layerCount"] as? NSNumber)?.intValue
            let bpmVal = (entry["bpm"] as? NSNumber)?.doubleValue
            let durVal = (entry["durationSec"] as? NSNumber)?.doubleValue
            let installedId = (entry["installedTrackId"] as? String) ?? byTitleLower[title.lowercased()]

            if let instId = installedId, var existing = byLocalId[instId] {
                existing.author = author ?? existing.author
                existing.version = version ?? existing.version
                existing.clipCount = clipCount ?? existing.clipCount
                existing.layerCount = layerCount ?? existing.layerCount
                existing.showId = showId ?? existing.showId
                existing.sharedFilename = filename ?? existing.sharedFilename
                existing.installedTrackId = instId
                existing.hasTimeline = true
                byLocalId[instId] = existing
            } else {
                let idStr = showId ?? filename ?? UUID().uuidString
                unlinkedShared.append(
                    LibraryTrack(
                        id: idStr,
                        title: title,
                        originalName: filename,
                        durationSec: durVal,
                        bpm: bpmVal,
                        hasTimeline: true,
                        author: author,
                        version: version,
                        clipCount: clipCount,
                        layerCount: layerCount,
                        showId: showId,
                        sharedFilename: filename,
                        installedTrackId: nil,
                        isSharedOnly: true
                    )
                )
            }
        }

        let enrichedLocal = localTracks.compactMap { byLocalId[$0.id] }
        let merged = enrichedLocal + unlinkedShared
        if !merged.isEmpty {
            self.libraryTracks = merged
        }
    }

    @discardableResult
    internal func pollStatusQuietly() async -> Bool {
        guard let url = URL(string: "\(studioHost)/api/live/status") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.5
        let t0 = ProcessInfo.processInfo.systemUptime
        do {
            let (data, response) = try await fastSession.data(for: req)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                self.rttMs = max(1, Int(((ProcessInfo.processInfo.systemUptime - t0) * 1000.0).rounded()))
                self.isConnected = true
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let live = json["liveState"] as? [String: Any] {
                        applyRemoteLiveState(live)
                    }
                    if let padsSnap = json["pads"] as? [String: Any] {
                        applyServerPadsPayload(padsSnap)
                    }
                    if let lan = json["lan"] as? [String: Any] {
                        applyLanPayload(lan)
                    }
                }
                return true
            }
        } catch {
            isConnected = false
        }
        return false
    }
}
