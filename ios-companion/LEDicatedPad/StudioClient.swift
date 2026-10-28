import Foundation
import SwiftUI
import Observation

@MainActor
@Observable
public final class StudioClient {
    public struct ActivePadRun: Sendable {
        public var startedAt: TimeInterval
        public var held: Bool
    }

    public var studioHost: String {
        didSet {
            UserDefaults.standard.set(studioHost, forKey: "ledicated.studioHost")
        }
    }

    public let clientId: String
    public var isConnected: Bool = false
    public var rttMs: Int = 0
    public var isStageOwner: Bool = true
    public var isRecordingSession: Bool = false
    public var holdLatchMode: Bool = false
    public var inspectorOnTapMode: Bool = false
    public var quantize: Bool = false

    public var pads: [PadConfig] = PadConfig.defaultPads
    public var selectedPadIndex: Int = 0
    public var activePads: [Int: ActivePadRun] = [:]
    public var queuedPads: [Int: TimeInterval] = [:]

    // Studio Transport & Track State
    public var trackId: String? = nil
    public var trackTitle: String = "LEDicated Live Performance"
    public var sectionName: String = "LIVE"
    public var isPlaying: Bool = false
    public var timeSec: Double = 0
    public var durationSec: Double = 180
    public var bpm: Double = 124
    public var masterBrightness: Double = 35
    public var blackout: Bool = false
    public var lastSyncUptime: TimeInterval = ProcessInfo.processInfo.systemUptime
    public var sections: [TrackSection] = []
    public var libraryTracks: [LibraryTrack] = []
    public var discoveredHosts: [String] = ["http://192.168.18.10:8787", "http://Timons-MacBook-Pro.local:8787"]

    private var sseTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

    public init() {
        let savedHost = UserDefaults.standard.string(forKey: "ledicated.studioHost") ?? "http://192.168.18.10:8787"
        self.studioHost = savedHost

        if let savedId = UserDefaults.standard.string(forKey: "ledicated.clientId") {
            self.clientId = savedId
        } else {
            let newId = "ios-native-\(UUID().uuidString.prefix(8).lowercased())"
            UserDefaults.standard.set(newId, forKey: "ledicated.clientId")
            self.clientId = newId
        }

        startNetworking()
    }

    public var selectedPad: PadConfig {
        get {
            guard pads.indices.contains(selectedPadIndex) else { return PadConfig.defaultPads[0] }
            return pads[selectedPadIndex]
        }
        set {
            guard pads.indices.contains(selectedPadIndex) else { return }
            pads[selectedPadIndex] = newValue
        }
    }

    public var interpolatedPlayheadSec: Double {
        guard isPlaying else { return timeSec }
        let elapsed = max(0, ProcessInfo.processInfo.systemUptime - lastSyncUptime)
        return min(max(durationSec, 1), timeSec + elapsed)
    }

    public func startNetworking() {
        sseTask?.cancel()
        pollTask?.cancel()

        Task {
            await fetchInitialPadsAndStatus()
            await fetchLibraryTracks()
        }

        sseTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.connectSSEStream()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }

        pollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_800_000_000)
                await self.pollStatusQuietly()
            }
        }
    }

    public func reconnect(to newHost: String) {
        let trimmed = newHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let normalized = trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") ? trimmed : "http://\(trimmed)"
        studioHost = normalized.hasSuffix("/") ? String(normalized.dropLast()) : normalized
        startNetworking()
    }

    // MARK: - Pad Trigger & Release Actions

    public func pressPad(_ index: Int) {
        guard pads.indices.contains(index) else { return }
        selectedPadIndex = index
        let pad = pads[index]
        HapticsEngine.shared.padHit(intensity: pad.intensity, isLoop: pad.isLoop)

        if inspectorOnTapMode {
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        if pad.isLoop {
            if activePads[index] != nil || queuedPads[index] != nil {
                activePads.removeValue(forKey: index)
                queuedPads.removeValue(forKey: index)
            } else if quantize && isPlaying {
                queuedPads[index] = nextBeatUptime(from: now)
            } else {
                activePads[index] = ActivePadRun(startedAt: now, held: false)
            }
            sendCommand(["type": "live_pad", "action": "trigger", "index": index])
        } else {
            if quantize && isPlaying && activePads[index] == nil {
                queuedPads[index] = nextBeatUptime(from: now)
            } else {
                activePads[index] = ActivePadRun(startedAt: now, held: true)
            }
            sendCommand(["type": "live_pad", "action": "press", "index": index])
        }
    }

    public func releasePad(_ index: Int) {
        guard pads.indices.contains(index) else { return }
        let pad = pads[index]
        guard !pad.isLoop && !holdLatchMode else { return }
        queuedPads.removeValue(forKey: index)
        activePads.removeValue(forKey: index)
        HapticsEngine.shared.padRelease()
        sendCommand(["type": "live_pad", "action": "release", "index": index])
    }

    public func stopAllPads() {
        activePads.removeAll()
        queuedPads.removeAll()
        HapticsEngine.shared.padHit(intensity: 0.7, isLoop: false)
        sendCommand(["type": "live_pad", "action": "clear"])
    }

    public func toggleQuantize() {
        quantize.toggle()
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "live_pad", "action": "quantize", "value": quantize])
    }

    public func toggleHoldLatch() {
        holdLatchMode.toggle()
        HapticsEngine.shared.tickSelection()
        if !holdLatchMode {
            for (idx, run) in activePads where !pads[idx].isLoop && run.held {
                activePads.removeValue(forKey: idx)
            }
            sendCommand(["type": "live_pad", "action": "release_all"])
        }
    }

    public func toggleBarForSelectedPad(_ barId: String) {
        var pad = selectedPad
        var current = Set(pad.bars.isEmpty ? BarID.allCases.map(\.rawValue) : pad.bars)
        if current.contains(barId) && current.count > 1 {
            current.remove(barId)
        } else {
            current.insert(barId)
        }
        pad.bars = BarID.allCases.map(\.rawValue).filter { current.contains($0) }
        selectedPad = pad
        HapticsEngine.shared.tickSelection()
        syncPadToServer(index: selectedPadIndex)
    }

    public func setBarsForSelectedPad(_ bars: [String]) {
        var pad = selectedPad
        pad.bars = bars
        selectedPad = pad
        HapticsEngine.shared.tickSelection()
        syncPadToServer(index: selectedPadIndex)
    }

    public func syncPadToServer(index: Int) {
        guard pads.indices.contains(index) else { return }
        let pad = pads[index]
        guard let data = try? JSONEncoder().encode(pad),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        sendCommand([
            "type": "live_pad",
            "action": "set",
            "index": index,
            "pad": dict
        ])
    }

    // MARK: - Transport & Stage Controls

    public func togglePlayPause() {
        isPlaying.toggle()
        lastSyncUptime = ProcessInfo.processInfo.systemUptime
        HapticsEngine.shared.padHit(intensity: 0.65, isLoop: true)
        sendCommand(["type": isPlaying ? "play" : "pause"])
    }

    public func seek(to seconds: Double) {
        timeSec = max(0, seconds)
        lastSyncUptime = ProcessInfo.processInfo.systemUptime
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "seek", "timeSec": timeSec])
    }

    public func setMasterBrightness(_ value: Double) {
        masterBrightness = max(0, min(60, value))
        sendCommand(["type": "master", "value": Int(masterBrightness.rounded())])
    }

    public func toggleBlackout() {
        blackout.toggle()
        if blackout {
            activePads.removeAll()
            queuedPads.removeAll()
        }
        HapticsEngine.shared.blackoutTriggered(active: blackout)
        sendCommand(["type": "blackout", "value": blackout])
    }

    public func selectTrack(_ id: String, title: String) {
        trackId = id
        trackTitle = title
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "select_track", "trackId": id])
    }

    public func toggleStageOwnership() async {
        HapticsEngine.shared.padHit(intensity: 0.75, isLoop: true)
        guard let url = URL(string: "\(studioHost)/api/lan/claim-stage") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "clientId": clientId,
            "name": "iPhone Live Pad (Native)",
            "source": "ios-pad",
            "release": isStageOwner
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let owner = json["isStageOwner"] as? Bool {
                isStageOwner = owner
            }
        } catch {}
    }

    // MARK: - 60 FPS Local Procedural 3x3 RGBW Bar Synthesizer

    public func tickAndRenderBars(now: TimeInterval) -> [BarID: [RGBWPixel]] {
        // Promote queued pads when beat arrives
        for (idx, fireTime) in queuedPads {
            if now >= fireTime {
                queuedPads.removeValue(forKey: idx)
                activePads[idx] = ActivePadRun(startedAt: now, held: false)
            }
        }

        // Expire non-held one-shot hit pads
        for (idx, run) in activePads {
            guard pads.indices.contains(idx) else {
                activePads.removeValue(forKey: idx)
                continue
            }
            let pad = pads[idx]
            if !pad.isLoop && !run.held {
                let dur = max(0.2, pad.duration)
                if now - run.startedAt >= dur {
                    activePads.removeValue(forKey: idx)
                }
            }
        }

        var result: [BarID: [RGBWPixel]] = [:]
        for bar in BarID.allCases {
            result[bar] = Array(repeating: RGBWPixel(r: 0.02, g: 0.03, b: 0.06, w: 0), count: 12)
        }

        guard !blackout else { return result }

        for (idx, run) in activePads.sorted(by: { $0.key < $1.key }) {
            guard pads.indices.contains(idx) else { continue }
            let pad = pads[idx]
            let elapsed = max(0, now - run.startedAt)
            let speed = max(0.2, pad.params.speed)
            let phase = elapsed * speed

            let env: Double = {
                if pad.isLoop || run.held { return pad.intensity }
                let dur = max(0.2, pad.duration)
                let norm = min(1.0, elapsed / dur)
                return pad.intensity * pow(1.0 - norm, 0.75)
            }()

            let c1 = pad.color.count >= 3 ? pad.color : [0, 0.95, 1]
            let c2 = (pad.colorSecondary?.count ?? 0) >= 3 ? pad.colorSecondary! : c1
            let targetBars = Set(pad.bars.isEmpty ? BarID.allCases.map(\.rawValue) : pad.bars)

            for bar in BarID.allCases where targetBars.contains(bar.rawValue) {
                guard var pixels = result[bar] else { continue }
                for p in 0..<12 {
                    let u = Double(p) / 11.0
                    let barOffset = Double(bar.row * 3 + bar.column) * 0.14
                    let wave: Double = {
                        switch pad.preset {
                        case "flash":
                            return exp(-elapsed * 3.2)
                        case "strobe":
                            let f = sin((phase * 18.0 + barOffset) * .pi)
                            return f > 0.2 ? 1.0 : 0.05
                        case "chase", "comet", "meteor":
                            let head = (phase * 0.85 + barOffset).truncatingRemainder(dividingBy: 1.0)
                            let dist = min(abs(u - head), 1.0 - abs(u - head))
                            return max(0, 1.0 - dist * 4.2)
                        case "sweep", "wave", "aurora", "horizon":
                            return 0.5 + 0.5 * sin((u * 2.0 - phase * 1.6 + barOffset) * .pi)
                        case "ripple", "supernova", "vortex":
                            let centerDist = abs(u - 0.5) * 2.0 + abs(Double(bar.column - 1)) * 0.35
                            return 0.5 + 0.5 * cos((centerDist * 2.4 - phase * 2.2) * .pi)
                        case "sparkle", "rain", "glitch", "shimmer":
                            let seed = sin(Double(p * 37 + bar.hashValue) + floor(phase * 10.0) * 1.73)
                            return seed > 0.35 ? 1.0 : 0.15
                        case "fire", "plasma":
                            return 0.45 + 0.55 * abs(sin((u * 3.1 + phase * 2.3 + barOffset) * .pi))
                        case "columns", "bounce":
                            let h = 0.5 + 0.5 * sin((phase * 2.0 + Double(bar.column) * 0.6) * .pi)
                            return u <= h ? 1.0 : 0.12
                        default:
                            return 0.55 + 0.45 * sin((phase * 2.0 + barOffset) * .pi)
                        }
                    }()

                    let mix = 0.5 + 0.5 * sin((u + phase * 0.5) * .pi)
                    let r = (c1[0] * (1 - mix) + c2[0] * mix) * wave * env
                    let g = (c1[1] * (1 - mix) + c2[1] * mix) * wave * env
                    let b = (c1[2] * (1 - mix) + c2[2] * mix) * wave * env
                    let w = pad.white * wave * env

                    pixels[p].r = min(1.0, pixels[p].r + r)
                    pixels[p].g = min(1.0, pixels[p].g + g)
                    pixels[p].b = min(1.0, pixels[p].b + b)
                    pixels[p].w = min(1.0, pixels[p].w + w)
                }
                result[bar] = pixels
            }
        }

        return result
    }

    private func nextBeatUptime(from now: TimeInterval) -> TimeInterval {
        let beatDur = 60.0 / max(40.0, bpm)
        let rem = interpolatedPlayheadSec.truncatingRemainder(dividingBy: beatDur)
        let wait = rem < 0.02 ? 0 : (beatDur - rem)
        return now + min(beatDur, max(0.02, wait))
    }

    // MARK: - Networking Implementation

    public func sendCommand(_ payload: [String: Any]) {
        guard let url = URL(string: "\(studioHost)/api/live/command") else { return }
        var body = payload
        body["clientId"] = clientId
        body["clientName"] = "iPhone Live Pad"
        body["source"] = "ios-pad"

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 3.0
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let t0 = ProcessInfo.processInfo.systemUptime
        Task {
            do {
                let (_, response) = try await URLSession.shared.data(for: req)
                if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                    let ms = max(1, Int(((ProcessInfo.processInfo.systemUptime - t0) * 1000.0).rounded()))
                    self.rttMs = ms
                    self.isConnected = true
                }
            } catch {
                self.isConnected = false
            }
        }
    }

    public func fetchInitialPadsAndStatus() async {
        guard let url = URL(string: "\(studioHost)/api/live/pads") else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            isConnected = true
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                applyServerPadsPayload(json)
                if let live = json["liveState"] as? [String: Any] {
                    applyRemoteLiveState(live)
                }
            }
        } catch {
            isConnected = false
        }
    }

    public func fetchLibraryTracks() async {
        guard let url = URL(string: "\(studioHost)/api/library/tracks") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            struct Wrapper: Decodable { let tracks: [LibraryTrack]? }
            if let decoded = try? JSONDecoder().decode(Wrapper.self, from: data),
               let list = decoded.tracks {
                self.libraryTracks = list
            }
        } catch {}
    }

    private func pollStatusQuietly() async {
        guard let url = URL(string: "\(studioHost)/api/live/status") else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                isConnected = true
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let live = json["liveState"] as? [String: Any] {
                    applyRemoteLiveState(live)
                }
            }
        } catch {
            isConnected = false
        }
    }

    private func connectSSEStream() async {
        let encodedId = clientId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? clientId
        guard let url = URL(string: "\(studioHost)/api/live/stream?clientId=\(encodedId)&name=iPhone%20Live%20Pad") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3600
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            isConnected = true

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
        }
    }

    private func handleSSECommand(_ cmd: [String: Any]) {
        guard let type = cmd["type"] as? String else { return }
        let now = ProcessInfo.processInfo.systemUptime

        switch type {
        case "pads_sync":
            applyServerPadsPayload(cmd)
        case "live_pad":
            let action = (cmd["action"] as? String) ?? "trigger"
            let idx = (cmd["index"] as? Int) ?? -1
            if action == "clear" || action == "stop_all" {
                activePads.removeAll()
                queuedPads.removeAll()
            } else if action == "release_all" {
                for (k, run) in activePads where !pads[k].isLoop && run.held {
                    activePads.removeValue(forKey: k)
                }
            } else if action == "quantize", let val = cmd["value"] as? Bool {
                quantize = val
            } else if pads.indices.contains(idx) {
                if action == "set", let padObj = cmd["pad"] as? [String: Any],
                   let data = try? JSONSerialization.data(withJSONObject: padObj),
                   let decoded = try? JSONDecoder().decode(PadConfig.self, from: data) {
                    pads[idx] = decoded
                } else if action == "press" {
                    activePads[idx] = ActivePadRun(startedAt: now, held: true)
                } else if action == "release" {
                    activePads.removeValue(forKey: idx)
                } else if action == "trigger" || action == "hit" || action == "loop" {
                    if pads[idx].isLoop && activePads[idx] != nil {
                        activePads.removeValue(forKey: idx)
                    } else {
                        activePads[idx] = ActivePadRun(startedAt: now, held: false)
                    }
                }
            }
        case "play":
            isPlaying = true
            lastSyncUptime = now
        case "pause":
            isPlaying = false
        case "seek":
            if let t = cmd["timeSec"] as? Double {
                timeSec = t
                lastSyncUptime = now
            }
        case "blackout":
            if let b = cmd["value"] as? Bool {
                blackout = b
                if b { activePads.removeAll() }
            }
        default:
            break
        }
    }

    private func applyServerPadsPayload(_ json: [String: Any]) {
        if let q = json["quantize"] as? Bool {
            quantize = q
        }
        guard let rawPads = json["pads"] as? [Any] else { return }
        var updated = pads
        for i in 0..<min(12, rawPads.count) {
            if let dict = rawPads[i] as? [String: Any],
               let data = try? JSONSerialization.data(withJSONObject: dict),
               let decoded = try? JSONDecoder().decode(PadConfig.self, from: data) {
                updated[i] = decoded
            }
        }
        pads = updated
    }

    private func applyRemoteLiveState(_ live: [String: Any]) {
        if let tid = live["trackId"] as? String { trackId = tid }
        if let title = live["trackTitle"] as? String, !title.isEmpty { trackTitle = title }
        if let sec = live["sectionName"] as? String, !sec.isEmpty { sectionName = sec }
        if let playing = live["isPlaying"] as? Bool { isPlaying = playing }
        if let t = live["timeSec"] as? Double {
            timeSec = t
            lastSyncUptime = ProcessInfo.processInfo.systemUptime
        }
        if let dur = live["durationSec"] as? Double, dur > 0 { durationSec = dur }
        if let b = live["bpm"] as? Double, b > 0 { bpm = b }
        if let m = live["master"] as? Double { masterBrightness = m }
        if let bo = live["blackout"] as? Bool { blackout = bo }
    }
}
