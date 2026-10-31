import Foundation

@MainActor
public extension StudioClient {
    // MARK: - Transport, Stage Ownership & Show Launcher

    func togglePlayPause() {
        isPlaying.toggle()
        frameStore.lastSyncUptime = ProcessInfo.processInfo.systemUptime
        HapticsEngine.shared.padHit(intensity: 0.65, isLoop: true)
        sendCommand(["type": "transport", "action": isPlaying ? "play" : "pause"])
    }

    func seek(to seconds: Double) {
        let clamped = max(0, seconds)
        frameStore.updateTime(clamped)
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "transport", "action": "seek", "timeSec": clamped])
    }

    func restartShow() {
        frameStore.updateTime(0)
        isPlaying = true
        HapticsEngine.shared.padHit(intensity: 0.7, isLoop: true)
        sendCommand(["type": "transport", "action": "seek", "timeSec": 0])
        sendCommand(["type": "transport", "action": "play"])
    }

    func stopShow() {
        isPlaying = false
        frameStore.updateTime(0)
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "transport", "action": "stop"])
    }

    func setMasterBrightness(_ value: Double) {
        masterBrightness = max(0, min(60, value))
        sendCommand(["type": "master", "value": Int(masterBrightness.rounded())])
    }

    func toggleBlackout() {
        blackout.toggle()
        if blackout {
            activePads.removeAll()
            queuedPads.removeAll()
            heldPads.removeAll()
        }
        HapticsEngine.shared.blackoutTriggered(active: blackout)
        sendCommand(["type": "blackout", "value": blackout])
    }

    func toggleRecordingSession() {
        isRecordingSession.toggle()
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "record_session", "value": isRecordingSession])
    }

    func toggleStageOwnership() async {
        isStageOwner = true
    }

    func selectTrack(_ id: String, title: String, autoPlay: Bool = true) {
        trackId = id
        trackTitle = title
        if autoPlay {
            frameStore.updateTime(0)
            isPlaying = true
            blackout = false
        }
        HapticsEngine.shared.padHit(intensity: 0.75, isLoop: true)
        sendCommand(["type": "select_track", "trackId": id, "autoPlay": autoPlay])
        if autoPlay {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(450))
                self.sendCommand(["type": "transport", "action": "play"])
                try? await Task.sleep(for: .milliseconds(550))
                if self.trackId == id && !self.isPlaying {
                    self.isPlaying = true
                    self.sendCommand(["type": "transport", "action": "play"])
                }
            }
        }
    }

    /// Launches a Light Show directly from the database (local or cloud/shared) on the connected Mac.
    func playShow(_ track: LibraryTrack) {
        let targetId = track.effectiveTrackId
        if !targetId.isEmpty && targetId == trackId && track.isSharedOnly != true {
            togglePlayPause()
            return
        }

        HapticsEngine.shared.padHit(intensity: 0.85, isLoop: true)
        launchingTrackId = track.id

        Task { @MainActor in
            var resolvedTrackId = track.installedTrackId ?? (track.isSharedOnly == true ? "" : track.id)

            // If this show is from the shared database and not yet installed on the Mac, install it first
            if resolvedTrackId.isEmpty, let url = URL(string: "\(studioHost)/api/library/install-shared-show") {
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.timeoutInterval = 25.0
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                var body: [String: Any] = ["downloadAudio": true]
                if let sid = track.showId, !sid.isEmpty { body["showId"] = sid }
                if let fname = track.sharedFilename, !fname.isEmpty { body["filename"] = fname }
                req.httpBody = try? JSONSerialization.data(withJSONObject: body)
                if let (data, resp) = try? await URLSession.shared.data(for: req),
                   let http = resp as? HTTPURLResponse, http.statusCode == 200,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let trObj = json["track"] as? [String: Any],
                   let newId = trObj["id"] as? String {
                    resolvedTrackId = newId
                    await self.fetchLibraryTracks()
                }
            }

            guard !resolvedTrackId.isEmpty else {
                self.launchingTrackId = nil
                return
            }

            if let b = track.bpm, b > 0 { self.bpm = b }
            if let d = track.durationSec, d > 0 { self.durationSec = d }
            self.selectTrack(resolvedTrackId, title: track.displayTitle, autoPlay: true)
            try? await Task.sleep(for: .milliseconds(500))
            self.launchingTrackId = nil
        }
    }
}
