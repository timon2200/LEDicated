import AppKit
import SwiftUI
import Network
import Foundation

// MARK: - Data Models for WLED & LEDicated Studio JSON APIs

struct WledCombinedResponse: Decodable {
    let state: WledStateResponse
    let info: WledInfoResponse
}

struct WledStateResponse: Decodable {
    let on: Bool
    let bri: Int
    let lor: Int?
    let seg: [WledSegmentResponse]?
}

struct WledSegmentResponse: Decodable {
    let id: Int?
    let n: String?
    let col: [[Int]]?
    let fx: Int?
}

struct WledInfoResponse: Decodable {
    let ver: String?
    let name: String?
    let mac: String?
    let ip: String?
    let live: Bool?
    let lm: String?
    let lip: String?
    let uptime: Int?
    let leds: WledLedsInfo?
    let wifi: WledWifiInfo?
}

struct WledLedsInfo: Decodable {
    let count: Int?
    let pwr: Int?
    let fps: Int?
    let maxpwr: Int?
}

struct WledWifiInfo: Decodable {
    let signal: Int?
    let rssi: Int?
}

struct StudioLiveStatusResponse: Decodable {
    let ok: Bool?
    let liveState: StudioClientState?
    let serverState: StudioServerState?
    let lan: StudioLanState?
}

struct StudioServerState: Decodable {
    let armed: Bool?
    let outputMode: String?
}

struct StudioClientState: Decodable {
    let trackId: String?
    let trackTitle: String?
    let isPlaying: Bool?
    let bpm: Double?
    let timeSec: Double?
    let durationSec: Double?
    let activePads: [Int]?
}

struct StudioLanState: Decodable {
    let stageState: String?
    let outputMode: String?
    let armed: Bool?
    let nowPlaying: StudioNowPlaying?
}

struct StudioNowPlaying: Decodable {
    let name: String?
    let source: String?
    let trackTitle: String?
    let isPlaying: Bool?
    let bpm: Double?
}

// MARK: - Full-Power Color Temperature Math (24V WS2814 RGBW)

enum ColorTempMath {
    static let minKelvin: Double = 2700
    static let maxKelvin: Double = 6500
    static let defaultKelvin: Double = 4000

    /// Full-power RGBW curve: keeps the physical W emitter at 255 across warm/neutral
    /// and drives R, G, B simultaneously so 4800K hits full [255, 255, 255, 255] (all 4 channels at 100%).
    static func rgbwForKelvin(_ kelvin: Double) -> [Int] {
        let clamped = max(minKelvin, min(maxKelvin, kelvin))
        let t = (clamped - minKelvin) / (maxKelvin - minKelvin) // 0.0 (2700K) -> 1.0 (6500K)

        let r: Double
        let g: Double
        let b: Double
        let w: Double

        if t <= 0.22 {
            // 2700K -> 3530K: Full Warm White (255) + rich warm amber/gold RGB boost
            let p = t / 0.22
            r = 255.0
            g = 115.0 + (65.0 * p)  // 115 -> 180
            b = 18.0 + (72.0 * p)   // 18 -> 90
            w = 255.0
        } else if t <= 0.56 {
            // 3530K -> 4830K (Full Power Neutral White): R, G, B, W all ramp up to [255, 255, 255, 255]
            let p = (t - 0.22) / 0.34
            r = 255.0
            g = 180.0 + (75.0 * p)  // 180 -> 255
            b = 90.0 + (165.0 * p)  // 90 -> 255
            w = 255.0
        } else {
            // 4830K -> 6500K (Crisp Cool Daylight): Full Blue/Green with slightly tapered Warm White & Red
            let p = (t - 0.56) / 0.44
            r = 255.0 - (45.0 * p)  // 255 -> 210
            g = 255.0 - (12.0 * p)  // 255 -> 243
            b = 255.0
            w = 255.0 - (80.0 * p)  // 255 -> 175
        }

        return [
            max(0, min(255, Int(r.rounded()))),
            max(0, min(255, Int(g.rounded()))),
            max(0, min(255, Int(b.rounded()))),
            max(0, min(255, Int(w.rounded())))
        ]
    }

    static func kelvinFromRgbw(_ col: [Int], fallback: Double) -> Double {
        guard col.count >= 4 else { return fallback }
        let r = col[0], g = col[1], b = col[2], w = col[3]
        if r == 0 && g == 0 && b == 0 && w == 0 {
            return fallback
        }
        let expected = rgbwForKelvin(fallback)
        if abs(expected[0] - r) <= 6 && abs(expected[1] - g) <= 6 && abs(expected[2] - b) <= 6 && abs(expected[3] - w) <= 6 {
            return fallback
        }
        if w < 250 && b >= 245 {
            let p = min(1.0, max(0.0, Double(255 - w) / 80.0))
            let t = 0.56 + p * 0.44
            return (minKelvin + t * (maxKelvin - minKelvin)).rounded()
        }
        if b < 90 {
            let p = min(1.0, max(0.0, Double(b - 18) / 72.0))
            let t = p * 0.22
            return (minKelvin + t * (maxKelvin - minKelvin)).rounded()
        }
        let p = min(1.0, max(0.0, Double(b - 90) / 165.0))
        let t = 0.22 + p * 0.34
        return (minKelvin + t * (maxKelvin - minKelvin)).rounded()
    }

    static func labelForKelvin(_ kelvin: Double) -> String {
        let k = Int((kelvin / 50.0).rounded() * 50.0)
        if k < 3200 { return "Topla · \(k)K" }
        if k < 4100 { return "Prirodna · \(k)K" }
        if k < 5200 { return "Puna snaga · \(k)K" }
        return "Hladna · \(k)K"
    }

    static func previewColor(for kelvin: Double) -> Color {
        let t = max(0.0, min(1.0, (kelvin - minKelvin) / (maxKelvin - minKelvin)))
        if t < 0.5 {
            let p = t / 0.5
            return Color(red: 1.0, green: 0.72 + 0.25 * p, blue: 0.36 + 0.58 * p)
        } else {
            let p = (t - 0.5) / 0.5
            return Color(red: 1.0 - 0.16 * p, green: 0.97 - 0.03 * p, blue: 0.94 + 0.06 * p)
        }
    }
}

// MARK: - E8 Controller, Telemetry & Studio Manager

@MainActor
final class E8LightController: ObservableObject {
    @Published var isConnected: Bool = false
    @Published var isOn: Bool = false
    @Published var brightness: Double = 100.0
    @Published var kelvin: Double = ColorTempMath.defaultKelvin
    @Published var deviceName: String = "E8-WiFi Plus"
    @Published var deviceHost: String = "192.168.0.117"
    @Published var wifiSignal: Int? = nil

    // Telemetry: Watts, Lifetime Wh on E8, Refresh Rate (FPS/Hz)
    @Published var currentWatts: Double = 0.0
    @Published var totalWhEver: Double = 0.0
    @Published var refreshRateHz: Int = 0
    @Published var isLiveDdpActive: Bool = false

    // Now Playing Light Show state
    @Published var showTitle: String? = nil
    @Published var showIsPlaying: Bool = false
    @Published var showSource: String = "daw"
    @Published var showBpm: Int? = nil
    @Published var studioOutputMode: String = "show"
    @Published var studioArmed: Bool = false
    @Published var isStartingServer: Bool = false

    var onStatusBarUpdate: (() -> Void)?

    private let projectRoot = "/Users/timonterzic/Documents/Projekti/LEDicated"
    private var appDir: String { "\(projectRoot)/studio-light-baseline/app" }
    private var configPath: String { "\(appDir)/config.json" }
    private var logFilePath: String { "\(projectRoot)/logs/ledicated.log" }
    private let targetMac = "d0ef767a14f8"
    private let mdnsFallbackHost = "wled-7a14f8.local"

    private var pathMonitor: NWPathMonitor?
    private let monitorQueue = DispatchQueue(label: "hr.studiovarazdin.ledicated.network", qos: .utility)
    private var networkAvailable: Bool = true
    private var systemSleeping: Bool = false
    private var isPopoverOpen: Bool = false
    private var isInteracting: Bool = false
    private var pollTimer: Timer?
    private var liveSendWorkItem: DispatchWorkItem?
    private var persistWorkItem: DispatchWorkItem?
    private var lastLiveSendTime: TimeInterval = 0
    private var lastPollTimestamp: TimeInterval = 0
    private var lastE8Uptime: Int? = nil
    private var lastFlashWhSyncTime: TimeInterval = 0
    private var unlockedFullPowerOnE8: Bool = false
    private var lastObservedLive: Bool? = nil
    private var lastObservedLor: Int? = nil
    private var lastObservedOn: Bool? = nil
    private var probeCounter: Int = 0
    private var probeInFlight: Bool = false

    private lazy var urlSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 1.4
        cfg.timeoutIntervalForResource = 2.2
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    init() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "ledicated.kelvin") != nil {
            kelvin = max(ColorTempMath.minKelvin, min(ColorTempMath.maxKelvin, defaults.double(forKey: "ledicated.kelvin")))
        }
        if defaults.object(forKey: "ledicated.brightness") != nil {
            brightness = max(1.0, min(100.0, defaults.double(forKey: "ledicated.brightness")))
        }
        if defaults.object(forKey: "ledicated.totalWhEver") != nil {
            totalWhEver = max(0.0, defaults.double(forKey: "ledicated.totalWhEver"))
        }
        if let savedHost = defaults.string(forKey: "ledicated.e8Host"), !savedHost.isEmpty {
            deviceHost = savedHost
        }
        loadHostFromConfigJson()
        setupSleepWakeObservers()
        setupNetworkMonitor()
        appendLocalLog(action: "MENUBAR_START", details: ["host": deviceHost, "kelvin": Int(kelvin), "brightness": Int(brightness)])
        rescheduleTimer()
        Task { await pollAll() }
    }

    private func appendLocalLog(action: String, details: [String: Any] = [:]) {
        let logDir = "\(projectRoot)/logs"
        let filePath = logFilePath
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let ts = iso.string(from: Date())
        var detailStr = ""
        if !details.isEmpty, let data = try? JSONSerialization.data(withJSONObject: details, options: [.sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            detailStr = " \(str)"
        }
        let line = "\(ts) [MENUBAR] \(action)\(detailStr)\n"
        DispatchQueue.global(qos: .utility).async {
            let fm = FileManager.default
            try? fm.createDirectory(atPath: logDir, withIntermediateDirectories: true)
            if !fm.fileExists(atPath: filePath) {
                try? line.write(toFile: filePath, atomically: true, encoding: .utf8)
                return
            }
            if let handle = FileHandle(forWritingAtPath: filePath) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                if let data = line.data(using: .utf8) {
                    try? handle.write(contentsOf: data)
                }
            }
        }
    }

    private func loadHostFromConfigJson() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let nodes = json["nodes"] as? [[String: Any]] else { return }
        if let e8 = nodes.first(where: { ($0["id"] as? String) == "E8-1" }) ?? nodes.first,
           let host = e8["host"] as? String, !host.isEmpty {
            deviceHost = host
            UserDefaults.standard.set(host, forKey: "ledicated.e8Host")
        }
    }

    private func saveHostToConfigJson(_ newHost: String) {
        UserDefaults.standard.set(newHost, forKey: "ledicated.e8Host")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
              var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              var nodes = json["nodes"] as? [[String: Any]] else { return }
        var changed = false
        for i in nodes.indices {
            if (nodes[i]["id"] as? String) == "E8-1" || i == 0 {
                if (nodes[i]["host"] as? String) != newHost {
                    nodes[i]["host"] = newHost
                    changed = true
                }
            }
        }
        if changed {
            json["nodes"] = nodes
            if let out = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
                try? out.write(to: URL(fileURLWithPath: configPath), options: .atomic)
            }
        }
    }

    // MARK: - E8 Segment Variable Encoding ("WH:12.345|UP:1500")

    private func encodeEnergySegmentName(wh: Double, uptime: Int) -> String {
        // Max 32 chars in WLED segment name
        return String(format: "WH:%.3f|UP:%d", wh, uptime)
    }

    private func parseEnergySegmentName(_ raw: String?) -> (wh: Double, uptime: Int?)? {
        guard let raw, raw.hasPrefix("WH:") else { return nil }
        let parts = raw.split(separator: "|")
        var parsedWh: Double? = nil
        var parsedUp: Int? = nil
        for part in parts {
            if part.hasPrefix("WH:"), let v = Double(part.dropFirst(3)) {
                parsedWh = v
            } else if part.hasPrefix("UP:"), let u = Int(part.dropFirst(3)) {
                parsedUp = u
            }
        }
        if let wh = parsedWh {
            return (wh, parsedUp)
        }
        return nil
    }

    /// Converts WLED's internal 5V mA estimate (`leds.pwr`) + power state into real 24V WS2814 Watts
    private func computeRealWatts(isOn: Bool, wledPwrMa: Int?, isLive: Bool, bri: Int, col: [Int]?) -> Double {
        guard isOn else {
            return 3.2 // E8 ESP32 + 24V PSU standby draw
        }
        let baseControllerWatts = 5.5 // E8 controller + level shifters under load
        if let pwr = wledPwrMa, pwr > 150 {
            // WLED reports 150 mA base + up to 5910 mA (6060 mA total) at full [255,255,255,255] across 108 groups.
            // 108 groups of 24V WS2814 (4ch * 16.5mA * 24V) = 171 W max LED load.
            let ratio = max(0.0, min(1.0, Double(pwr - 150) / 5910.0))
            return baseControllerWatts + (ratio * 171.0)
        }
        if !isLive, let col, col.count >= 4 {
            let sum = Double(col[0] + col[1] + col[2] + col[3])
            let scale = Double(max(0, min(255, bri))) / 255.0
            let ratio = (sum / 1020.0) * scale
            return baseControllerWatts + (ratio * 171.0)
        }
        return baseControllerWatts
    }

    private func setupSleepWakeObservers() {
        let wsCenter = NSWorkspace.shared.notificationCenter
        wsCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.systemSleeping = true
                self?.pollTimer?.invalidate()
                self?.pollTimer = nil
            }
        }
        wsCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.systemSleeping = false
                self.rescheduleTimer()
                await self.pollAll()
            }
        }
        wsCenter.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.rescheduleTimer()
            }
        }
        wsCenter.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.rescheduleTimer()
                await self.pollAll()
            }
        }
    }

    private func setupNetworkMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = (path.status == .satisfied)
            Task { @MainActor in
                guard let self else { return }
                let wasAvailable = self.networkAvailable
                self.networkAvailable = satisfied
                if !satisfied {
                    self.isConnected = false
                    self.wifiSignal = nil
                    self.currentWatts = 0
                    self.refreshRateHz = 0
                    self.onStatusBarUpdate?()
                } else if !wasAvailable {
                    await self.pollAll()
                }
                self.rescheduleTimer()
            }
        }
        monitor.start(queue: monitorQueue)
        pathMonitor = monitor
    }

    func setPopoverOpen(_ open: Bool) {
        isPopoverOpen = open
        rescheduleTimer()
        if open {
            Task { await pollAll() }
        }
    }

    private func rescheduleTimer() {
        pollTimer?.invalidate()
        pollTimer = nil
        guard !systemSleeping && networkAvailable else { return }

        let interval: TimeInterval
        let tolerance: TimeInterval
        if isPopoverOpen {
            interval = isLiveDdpActive ? 2.5 : 1.8
            tolerance = 0.25
        } else if isConnected {
            interval = isLiveDdpActive ? 20.0 : 12.0
            tolerance = 3.5
        } else {
            interval = 15.0
            tolerance = 5.0
        }

        let timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.pollAll()
            }
        }
        timer.tolerance = tolerance
        pollTimer = timer
    }

    func pollAll() async {
        guard networkAvailable && !systemSleeping && !probeInFlight else { return }
        probeInFlight = true
        defer { probeInFlight = false }

        async let studioTask: Void = pollLocalStudioStatus()
        async let e8Task: Void = pollE8()
        _ = await (studioTask, e8Task)
    }

    private func pollLocalStudioStatus() async {
        guard let url = URL(string: "http://127.0.0.1:8787/api/live/status") else { return }
        var req = URLRequest(url: url)
        req.setValue("127.0.0.1:8787", forHTTPHeaderField: "Host")
        req.timeoutInterval = 0.45

        do {
            let (data, response) = try await urlSession.data(for: req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                updateFallbackShowStatus()
                return
            }
            let status = try JSONDecoder().decode(StudioLiveStatusResponse.self, from: data)
            if let mode = status.serverState?.outputMode ?? status.lan?.outputMode {
                studioOutputMode = mode
            }
            if let armedVal = status.serverState?.armed ?? status.lan?.armed {
                studioArmed = armedVal
            }
            if let np = status.lan?.nowPlaying, let title = np.trackTitle, !title.isEmpty {
                showTitle = title
                showIsPlaying = np.isPlaying ?? false
                showSource = np.source ?? "daw"
                showBpm = np.bpm != nil ? Int(np.bpm!.rounded()) : nil
                return
            }
            if let ls = status.liveState, let title = ls.trackTitle, !title.isEmpty {
                let hasPads = !(ls.activePads ?? []).isEmpty
                showTitle = title
                showIsPlaying = (ls.isPlaying ?? false) || hasPads
                showSource = "daw"
                showBpm = ls.bpm != nil ? Int(ls.bpm!.rounded()) : nil
                return
            }
            showTitle = nil
            showIsPlaying = false
            showBpm = nil
        } catch {
            updateFallbackShowStatus()
        }
    }

    private func updateFallbackShowStatus() {
        if isLiveDdpActive {
            showTitle = "Uživo Light Show (DDP)"
            showIsPlaying = true
            showSource = "lan"
        } else {
            showTitle = nil
            showIsPlaying = false
            showBpm = nil
        }
    }

    func pollE8() async {
        guard !isInteracting else { return }
        probeCounter += 1
        loadHostFromConfigJson()

        if await fetchFromHost(deviceHost) {
            return
        }

        if isPopoverOpen || probeCounter % 2 == 0 {
            if await fetchFromHost(mdnsFallbackHost) {
                return
            }
        }

        if isConnected {
            isConnected = false
            wifiSignal = nil
            currentWatts = 0
            refreshRateHz = 0
            isLiveDdpActive = false
            onStatusBarUpdate?()
            rescheduleTimer()
        }
    }

    private func fetchFromHost(_ host: String) async -> Bool {
        guard let url = URL(string: "http://\(host)/json/si") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.3
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        do {
            let (data, response) = try await urlSession.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
            let decoded = try JSONDecoder().decode(WledCombinedResponse.self, from: data)

            if let mac = decoded.info.mac?.lowercased(), !mac.isEmpty, mac != targetMac {
                return false
            }

            let wasConnected = isConnected
            isConnected = true
            if let name = decoded.info.name, !name.isEmpty {
                deviceName = name
            }
            wifiSignal = decoded.info.wifi?.signal

            if let reportedIp = decoded.info.ip, !reportedIp.isEmpty, reportedIp != "0.0.0.0", reportedIp != deviceHost {
                deviceHost = reportedIp
                saveHostToConfigJson(reportedIp)
            }

            let lorVal = decoded.state.lor ?? 0
            let rawLive = decoded.info.live ?? false
            let isLive = rawLive && lorVal != 2
            isLiveDdpActive = isLive
            let rawFps = decoded.info.leds?.fps ?? 0
            refreshRateHz = isLive ? max(rawFps, 1) : (decoded.state.on ? max(rawFps, 2) : 0)

            let firstSeg = decoded.state.seg?.first
            let firstCol = firstSeg?.col?.first

            // Calculate real-time 24V Watts
            let watts = computeRealWatts(
                isOn: decoded.state.on,
                wledPwrMa: decoded.info.leds?.pwr,
                isLive: isLive,
                bri: decoded.state.bri,
                col: firstCol
            )
            currentWatts = watts

            if lastObservedLive != rawLive || lastObservedLor != lorVal || lastObservedOn != decoded.state.on {
                appendLocalLog(action: "E8_STATE_CHANGE", details: [
                    "on": decoded.state.on,
                    "bri": decoded.state.bri,
                    "lor": lorVal,
                    "live": rawLive,
                    "fps": rawFps,
                    "watts": Int(watts.rounded()),
                    "studioMode": studioOutputMode
                ])
                lastObservedLive = rawLive
                lastObservedLor = lorVal
                lastObservedOn = decoded.state.on
            }

            // If we are in ambient mode (no show active) and E8 has lor != 2, lock lor: 2 on E8 so stray UDP packets cannot cause a 0.5s blink
            if !isInteracting && studioOutputMode == "ambient" && !showIsPlaying && lorVal != 2 {
                Task { await lockAmbientLorOnE8(host: deviceHost) }
            }

            // Reconcile & integrate lifetime Wh with E8's onboard segment variable
            let nowTs = Date().timeIntervalSince1970
            let e8Uptime = decoded.info.uptime ?? 0
            if let e8Saved = parseEnergySegmentName(firstSeg?.n) {
                if e8Saved.wh > totalWhEver {
                    totalWhEver = e8Saved.wh
                }
                // If MacBook was asleep/away while E8 stayed running, catch up using E8's hardware uptime delta
                if lastE8Uptime == nil, let savedUp = e8Saved.uptime, e8Uptime > savedUp {
                    let awaySec = Double(e8Uptime - savedUp)
                    if awaySec > 2.0 && awaySec < 86400.0 * 14.0 {
                        totalWhEver += watts * (awaySec / 3600.0)
                    }
                }
            }

            if lastPollTimestamp > 0 {
                let dt = nowTs - lastPollTimestamp
                if dt > 0 && dt < 120.0 {
                    totalWhEver += watts * (dt / 3600.0)
                }
            }
            lastPollTimestamp = nowTs
            lastE8Uptime = e8Uptime
            UserDefaults.standard.set(totalWhEver, forKey: "ledicated.totalWhEver")

            // Ensure WLED ABL & Gamma crush are disabled once per session so E8 outputs 100% power while keeping pwr telemetry active
            if !unlockedFullPowerOnE8 && (decoded.info.leds?.maxpwr ?? 0) != 65000 {
                unlockedFullPowerOnE8 = true
                Task { await unlockFullPowerConfigOnE8(host: deviceHost) }
            }

            // Periodically sync totalWhEver to E8 RAM/flash (every 10 min when NOT running a live DDP show)
            if !isLive && (nowTs - lastFlashWhSyncTime > 600.0) {
                lastFlashWhSyncTime = nowTs
                let segName = encodeEnergySegmentName(wh: totalWhEver, uptime: e8Uptime)
                Task { await updateSegmentEnergyOnE8(host: deviceHost, segName: segName, saveToFlash: false) }
            }

            if !isInteracting {
                if !isLive {
                    var hasNonZeroColor = true
                    if let firstCol, firstCol.count >= 4 {
                        let sum = firstCol[0] + firstCol[1] + firstCol[2] + firstCol[3]
                        if sum > 0 {
                            let estimatedK = ColorTempMath.kelvinFromRgbw(firstCol, fallback: kelvin)
                            kelvin = estimatedK
                            UserDefaults.standard.set(estimatedK, forKey: "ledicated.kelvin")
                        } else {
                            hasNonZeroColor = false
                        }
                    }
                    isOn = decoded.state.on && hasNonZeroColor
                    if decoded.state.bri > 0 && hasNonZeroColor {
                        let pct = max(1.0, min(100.0, (Double(decoded.state.bri) / 255.0 * 100.0).rounded()))
                        brightness = pct
                        UserDefaults.standard.set(pct, forKey: "ledicated.brightness")
                    }
                } else {
                    isOn = decoded.state.on
                    if showTitle == nil {
                        updateFallbackShowStatus()
                    }
                }
            }

            onStatusBarUpdate?()
            if !wasConnected {
                rescheduleTimer()
            }
            return true
        } catch {
            return false
        }
    }

    private func unlockFullPowerConfigOnE8(host: String) async {
        guard let cfgUrl = URL(string: "http://\(host)/json/cfg") else { return }
        var req = URLRequest(url: cfgUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 2.0
        let payload: [String: Any] = [
            "hw": ["led": ["maxpwr": 65000]],
            "light": ["scale-bri": 100, "gc": ["bri": false, "col": false, "val": 1.0]]
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await urlSession.data(for: req)
    }

    private func updateSegmentEnergyOnE8(host: String, segName: String, saveToFlash: Bool) async {
        guard let url = URL(string: "http://\(host)/json/state") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 1.5
        var payload: [String: Any] = [
            "seg": [["id": 0, "n": segName]]
        ]
        if saveToFlash {
            payload["psave"] = 1
            payload["n"] = "Uredska rasvjeta"
            payload["ib"] = true
            payload["sb"] = true
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await urlSession.data(for: req)
    }

    // MARK: - User Actions (Power Switch, Brightness, Color Temperature)

    func togglePower() {
        setPower(!isOn)
    }

    func setPower(_ newOn: Bool) {
        isOn = newOn
        isLiveDdpActive = false
        let rgbw = ColorTempMath.rgbwForKelvin(kelvin)
        let briByte = max(1, min(255, Int((brightness / 100.0 * 255.0).rounded())))
        currentWatts = computeRealWatts(isOn: newOn, wledPwrMa: nil, isLive: false, bri: briByte, col: rgbw)
        onStatusBarUpdate?()
        sendStateImmediate(saveToFlashAfterDelay: true)
    }

    func updateBrightness(_ newBri: Double, isDragging: Bool) {
        isInteracting = isDragging
        brightness = max(1.0, min(100.0, newBri.rounded()))
        UserDefaults.standard.set(brightness, forKey: "ledicated.brightness")
        if !isOn && brightness > 2.0 {
            isOn = true
            onStatusBarUpdate?()
        }
        isLiveDdpActive = false
        let rgbw = ColorTempMath.rgbwForKelvin(kelvin)
        let briByte = max(1, min(255, Int((brightness / 100.0 * 255.0).rounded())))
        currentWatts = computeRealWatts(isOn: isOn, wledPwrMa: nil, isLive: false, bri: briByte, col: rgbw)
        throttledLiveSend(saveToFlash: !isDragging)
    }

    func updateKelvin(_ newKelvin: Double, isDragging: Bool) {
        isInteracting = isDragging
        kelvin = max(ColorTempMath.minKelvin, min(ColorTempMath.maxKelvin, (newKelvin / 50.0).rounded() * 50.0))
        UserDefaults.standard.set(kelvin, forKey: "ledicated.kelvin")
        if !isOn {
            isOn = true
            onStatusBarUpdate?()
        }
        isLiveDdpActive = false
        let rgbw = ColorTempMath.rgbwForKelvin(kelvin)
        let briByte = max(1, min(255, Int((brightness / 100.0 * 255.0).rounded())))
        currentWatts = computeRealWatts(isOn: isOn, wledPwrMa: nil, isLive: false, bri: briByte, col: rgbw)
        throttledLiveSend(saveToFlash: !isDragging)
    }

    private func throttledLiveSend(saveToFlash: Bool) {
        let now = Date().timeIntervalSince1970
        let elapsed = now - lastLiveSendTime
        liveSendWorkItem?.cancel()

        if elapsed >= 0.075 {
            lastLiveSendTime = now
            sendStateImmediate(saveToFlashAfterDelay: saveToFlash)
        } else {
            let delay = max(0.02, 0.075 - elapsed)
            let item = DispatchWorkItem { [weak self] in
                Task { @MainActor in
                    guard let self else { return }
                    self.lastLiveSendTime = Date().timeIntervalSince1970
                    self.sendStateImmediate(saveToFlashAfterDelay: saveToFlash)
                }
            }
            liveSendWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
        }
    }

    private func sendStateImmediate(saveToFlashAfterDelay: Bool) {
        let targetOn = isOn
        let briByte = max(1, min(255, Int((brightness / 100.0 * 255.0).rounded())))
        let rgbw = ColorTempMath.rgbwForKelvin(kelvin)
        let host = deviceHost
        let segName = encodeEnergySegmentName(wh: totalWhEver, uptime: lastE8Uptime ?? 0)

        disarmLocalServerIfRunning()

        Task {
            guard let url = URL(string: "http://\(host)/json/state") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.timeoutInterval = 1.5

            let payload: [String: Any] = [
                "on": targetOn,
                "bri": briByte,
                "lor": 2,
                "transition": 2,
                "seg": [
                    [
                        "id": 0,
                        "n": segName,
                        "on": true,
                        "bri": 255,
                        "fx": 0,
                        "col": [rgbw, [0, 0, 0, 0], [0, 0, 0, 0]]
                    ]
                ]
            ]
            req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
            _ = try? await urlSession.data(for: req)
        }

        if saveToFlashAfterDelay {
            scheduleFlashPersistence(isOn: targetOn, briByte: briByte, rgbw: rgbw, segName: segName, host: host)
        }
    }

    private func scheduleFlashPersistence(isOn: Bool, briByte: Int, rgbw: [Int], segName: String, host: String) {
        persistWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                defer { self.isInteracting = false }
                self.lastFlashWhSyncTime = Date().timeIntervalSince1970
                await self.persistToE8Flash(isOn: isOn, briByte: briByte, rgbw: rgbw, segName: segName, host: host)
            }
        }
        persistWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.42, execute: item)
    }

    private func lockAmbientLorOnE8(host: String) async {
        guard let stateUrl = URL(string: "http://\(host)/json/state") else { return }
        var req = URLRequest(url: stateUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 1.2
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["lor": 2, "transition": 0])
        _ = try? await urlSession.data(for: req)
        appendLocalLog(action: "AMBIENT_LOR_GUARD", details: ["host": host, "lor": 2])
    }

    private func persistToE8Flash(isOn: Bool, briByte: Int, rgbw: [Int], segName: String, host: String) async {
        // Save Preset 1 via /json/state ("psave": 1) without touching /json/cfg.
        // Calling /json/cfg on ESP32 WLED re-initializes the RMT LED bus and causes a ~0.4s blink;
        // /json/state with psave:1 updates presets.json silently with zero flicker!
        if let stateUrl = URL(string: "http://\(host)/json/state") {
            var stateReq = URLRequest(url: stateUrl)
            stateReq.httpMethod = "POST"
            stateReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            stateReq.timeoutInterval = 2.0

            let presetPayload: [String: Any] = [
                "on": isOn,
                "bri": briByte,
                "lor": 2,
                "transition": 0,
                "seg": [
                    [
                        "id": 0,
                        "n": segName,
                        "on": true,
                        "bri": 255,
                        "fx": 0,
                        "col": [rgbw, [0, 0, 0, 0], [0, 0, 0, 0]]
                    ]
                ],
                "psave": 1,
                "n": "Uredska rasvjeta",
                "ib": true,
                "sb": true
            ]
            stateReq.httpBody = try? JSONSerialization.data(withJSONObject: presetPayload)
            _ = try? await urlSession.data(for: stateReq)
            appendLocalLog(action: "PRESET_SAVED", details: ["on": isOn, "bri": briByte, "kelvin": Int(kelvin), "lor": 2])
        }
    }

    private func disarmLocalServerIfRunning() {
        studioOutputMode = "ambient"
        studioArmed = false
        guard let url = URL(string: "http://127.0.0.1:8787/api/mode") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("127.0.0.1:8787", forHTTPHeaderField: "Host")
        req.setValue("http://127.0.0.1:8787", forHTTPHeaderField: "Origin")
        req.timeoutInterval = 0.6
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": "ambient", "restorePreset": false, "source": "menubar"])
        Task {
            _ = try? await urlSession.data(for: req)
        }
    }

    func takeOverWithAmbient() {
        if !isOn {
            isOn = true
        }
        isLiveDdpActive = false
        studioOutputMode = "ambient"
        studioArmed = false
        let rgbw = ColorTempMath.rgbwForKelvin(kelvin)
        let briByte = max(1, min(255, Int((brightness / 100.0 * 255.0).rounded())))
        currentWatts = computeRealWatts(isOn: isOn, wledPwrMa: nil, isLive: false, bri: briByte, col: rgbw)
        appendLocalLog(action: "TAKEOVER_AMBIENT", details: ["brightness": Int(brightness), "kelvin": Int(kelvin)])
        onStatusBarUpdate?()
        sendStateImmediate(saveToFlashAfterDelay: true)
    }

    func takeOverWithShow() {
        let host = deviceHost
        isLiveDdpActive = true
        studioOutputMode = "show"
        studioArmed = true
        isOn = true
        appendLocalLog(action: "TAKEOVER_SHOW", details: ["host": host])
        onStatusBarUpdate?()

        Task {
            // 1. Unlock WLED from lor:2 so E8 immediately accepts DDP frames
            if let e8Url = URL(string: "http://\(host)/json/state") {
                var e8Req = URLRequest(url: e8Url)
                e8Req.httpMethod = "POST"
                e8Req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                e8Req.timeoutInterval = 1.2
                let payload: [String: Any] = [
                    "on": true,
                    "bri": 255,
                    "transition": 0,
                    "lor": 0
                ]
                e8Req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
                _ = try? await urlSession.data(for: e8Req)
            }

            // 2. Ensure LEDicated server is running and switch it to 'show' mode
            if !(await isLocalServerRunning()) {
                isStartingServer = true
                startLocalServerProcess()
                for _ in 0..<20 {
                    try? await Task.sleep(nanoseconds: 150_000_000)
                    if await isLocalServerRunning() { break }
                }
                isStartingServer = false
            }

            if let modeUrl = URL(string: "http://127.0.0.1:8787/api/mode") {
                var req = URLRequest(url: modeUrl)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("127.0.0.1:8787", forHTTPHeaderField: "Host")
                req.setValue("http://127.0.0.1:8787", forHTTPHeaderField: "Origin")
                req.timeoutInterval = 1.2
                req.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": "show"])
                _ = try? await urlSession.data(for: req)
            }

            try? await Task.sleep(nanoseconds: 250_000_000)
            await pollAll()
        }
    }

    // MARK: - Open LEDicated Web App & Auto-Start Server

    func openWebStudio(closePopover: @escaping () -> Void) {
        guard !isStartingServer else { return }
        Task {
            if await isLocalServerRunning() {
                if let url = URL(string: "http://127.0.0.1:8787") {
                    NSWorkspace.shared.open(url)
                }
                closePopover()
                return
            }

            isStartingServer = true
            startLocalServerProcess()

            for _ in 0..<25 {
                try? await Task.sleep(nanoseconds: 160_000_000)
                if await isLocalServerRunning() {
                    break
                }
            }

            isStartingServer = false
            if let url = URL(string: "http://127.0.0.1:8787") {
                NSWorkspace.shared.open(url)
            }
            closePopover()
        }
    }

    private func isLocalServerRunning() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8787/api/state") else { return false }
        var req = URLRequest(url: url)
        req.setValue("127.0.0.1:8787", forHTTPHeaderField: "Host")
        req.timeoutInterval = 0.45
        do {
            let (_, response) = try await urlSession.data(for: req)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func startLocalServerProcess() {
        let nodeCandidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        let nodeBin = nodeCandidates.first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/opt/homebrew/bin/node"
        let serverScript = "\(appDir)/server.mjs"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodeBin)
        process.arguments = [serverScript]
        process.currentDirectoryURL = URL(fileURLWithPath: appDir)

        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = env

        let logPath = "/tmp/ledicated-studio-server.log"
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            process.standardOutput = logHandle
            process.standardError = logHandle
        }

        try? process.run()
    }
}

// MARK: - Lightweight Animated Musical Notes Icon for Now Playing Show

struct FloatingMusicalNotesBadge: View {
    let isPlaying: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24.0, paused: !isPlaying)) { context in
            let t = isPlaying ? context.date.timeIntervalSinceReferenceDate : 0.0
            ZStack {
                Circle()
                    .fill(
                        isPlaying
                            ? LinearGradient(colors: [Color.purple.opacity(0.85), Color.blue.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing)
                            : LinearGradient(colors: [Color.primary.opacity(0.10), Color.primary.opacity(0.07)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .frame(width: 34, height: 34)
                    .shadow(color: isPlaying ? Color.purple.opacity(0.45) : .clear, radius: 6, x: 0, y: 1)

                // Main waveform / studio icon
                Image(systemName: isPlaying ? "waveform" : "music.quarternote.3")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isPlaying ? Color.white : Color.primary.opacity(0.75))
                    .scaleEffect(isPlaying ? 1.0 + 0.06 * sin(t * 5.0) : 1.0)

                // Floating notes: animate upward & outward when playing, sit still when paused
                noteView(symbol: "♪", phase: isPlaying ? fmod(t * 0.65, 1.0) : 0.25, xSpread: -11.0, drift: -4.0)
                noteView(symbol: "♫", phase: isPlaying ? fmod(t * 0.65 + 0.35, 1.0) : 0.55, xSpread: 11.0, drift: 5.0)
                if isPlaying {
                    noteView(symbol: "♪", phase: fmod(t * 0.65 + 0.70, 1.0), xSpread: 2.0, drift: -6.0)
                }
            }
            .frame(width: 40, height: 38)
        }
    }

    @ViewBuilder
    private func noteView(symbol: String, phase: Double, xSpread: Double, drift: Double) -> some View {
        let yOffset = isPlaying ? (-4.0 - phase * 16.0) : -11.0
        let xOffset = isPlaying ? (xSpread * 0.5 + sin(phase * .pi * 2.0) * drift) : xSpread
        let alpha = isPlaying ? sin(phase * .pi) * 0.95 : 0.45
        let scale = isPlaying ? (0.65 + 0.45 * phase) : 0.75

        Text(symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(isPlaying ? Color.cyan : Color.secondary)
            .scaleEffect(scale)
            .opacity(max(0.0, alpha))
            .offset(x: xOffset, y: yOffset)
            .allowsHitTesting(false)
    }
}

// MARK: - Native macOS Control Center Style Sliders & Switch

struct ControlCenterPillSlider: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let leftSymbol: String
    let rightSymbol: String
    let trackFill: AnyShapeStyle
    let isEnabled: Bool
    let onChanged: (Double, Bool) -> Void

    var body: some View {
        GeometryReader { geo in
            let width = max(1.0, geo.size.width)
            let height = geo.size.height
            let progress = max(0.0, min(1.0, (value - range.lowerBound) / (range.upperBound - range.lowerBound)))
            let thumbDiameter = height - 4.0
            let usableWidth = max(1.0, width - thumbDiameter - 4.0)
            let thumbX = 2.0 + CGFloat(progress) * usableWidth

            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.primary.opacity(0.08))
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5)
                    )

                Capsule(style: .continuous)
                    .fill(trackFill)
                    .frame(width: max(height, thumbX + thumbDiameter - 2.0))
                    .opacity(isEnabled ? 0.95 : 0.45)

                HStack {
                    Image(systemName: leftSymbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.primary.opacity(0.55))
                        .padding(.leading, 8)
                    Spacer()
                    Image(systemName: rightSymbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.primary.opacity(0.55))
                        .padding(.trailing, 8)
                }
                .allowsHitTesting(false)

                Circle()
                    .fill(Color.white)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: .black.opacity(0.22), radius: 2.5, x: 0, y: 1)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.black.opacity(0.08), lineWidth: 0.5)
                    )
                    .offset(x: thumbX)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        let ratio = max(0.0, min(1.0, Double((gesture.location.x - thumbDiameter / 2.0) / usableWidth)))
                        let newValue = range.lowerBound + ratio * (range.upperBound - range.lowerBound)
                        value = newValue
                        onChanged(newValue, true)
                    }
                    .onEnded { gesture in
                        let ratio = max(0.0, min(1.0, Double((gesture.location.x - thumbDiameter / 2.0) / usableWidth)))
                        let newValue = range.lowerBound + ratio * (range.upperBound - range.lowerBound)
                        value = newValue
                        onChanged(newValue, false)
                    }
            )
        }
        .frame(height: 26)
    }
}

struct TemperaturePillSlider: View {
    @Binding var kelvin: Double
    let isEnabled: Bool
    let onChanged: (Double, Bool) -> Void

    private let range = ColorTempMath.minKelvin...ColorTempMath.maxKelvin

    var body: some View {
        GeometryReader { geo in
            let width = max(1.0, geo.size.width)
            let height = geo.size.height
            let progress = max(0.0, min(1.0, (kelvin - range.lowerBound) / (range.upperBound - range.lowerBound)))
            let thumbDiameter = height - 4.0
            let usableWidth = max(1.0, width - thumbDiameter - 4.0)
            let thumbX = 2.0 + CGFloat(progress) * usableWidth

            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            stops: [
                                .init(color: Color(red: 1.00, green: 0.67, blue: 0.24), location: 0.00),
                                .init(color: Color(red: 1.00, green: 0.87, blue: 0.68), location: 0.25),
                                .init(color: Color(red: 0.99, green: 0.98, blue: 0.96), location: 0.55),
                                .init(color: Color(red: 0.78, green: 0.90, blue: 1.00), location: 1.00)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .opacity(isEnabled ? 0.92 : 0.45)
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.14), lineWidth: 0.5)
                    )

                Circle()
                    .fill(Color.white)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: .black.opacity(0.25), radius: 2.5, x: 0, y: 1)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5)
                    )
                    .offset(x: thumbX)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        let ratio = max(0.0, min(1.0, Double((gesture.location.x - thumbDiameter / 2.0) / usableWidth)))
                        let newK = range.lowerBound + ratio * (range.upperBound - range.lowerBound)
                        kelvin = newK
                        onChanged(newK, true)
                    }
                    .onEnded { gesture in
                        let ratio = max(0.0, min(1.0, Double((gesture.location.x - thumbDiameter / 2.0) / usableWidth)))
                        let newK = range.lowerBound + ratio * (range.upperBound - range.lowerBound)
                        kelvin = newK
                        onChanged(newK, false)
                    }
            )
        }
        .frame(height: 26)
    }
}

struct BigAppleSwitch: View {
    let isOn: Bool
    let accentColor: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule(style: .continuous)
                    .fill(isOn ? accentColor : Color.primary.opacity(0.14))
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5)
                    )
                    .frame(width: 54, height: 30)

                Circle()
                    .fill(Color.white)
                    .frame(width: 26, height: 26)
                    .shadow(color: .black.opacity(0.22), radius: 2.5, x: 0, y: 1)
                    .padding(2)
            }
            .animation(.spring(response: 0.25, dampingFraction: 0.78), value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOn ? "Ugasi svjetlo" : "Upali svjetlo")
    }
}

// MARK: - Main Popover SwiftUI View

struct MenuBarPopoverView: View {
    @ObservedObject var controller: E8LightController
    let closePopover: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            // 1. Clean Header Row (No separate button — Now Playing card opens LEDicated Studio!)
            HStack(spacing: 6) {
                Text("Uredska rasvjeta")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.primary)

                Spacer()

                HStack(spacing: 5) {
                    Circle()
                        .fill(controller.isConnected ? Color.green : Color.orange.opacity(0.8))
                        .frame(width: 6, height: 6)
                        .shadow(color: controller.isConnected ? Color.green.opacity(0.6) : .clear, radius: 3)

                    Text(statusSubtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 2)

            // 2. Hero Power Switch Card
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            controller.isOn && controller.isConnected
                                ? ColorTempMath.previewColor(for: controller.kelvin).opacity(0.92)
                                : Color.primary.opacity(0.09)
                        )
                        .frame(width: 40, height: 40)
                        .shadow(
                            color: controller.isOn && controller.isConnected
                                ? ColorTempMath.previewColor(for: controller.kelvin).opacity(0.55)
                                : .clear,
                            radius: 8, x: 0, y: 2
                        )

                    Image(systemName: controller.isOn ? "lightbulb.fill" : "lightbulb")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(
                            controller.isOn && controller.isConnected
                                ? Color.black.opacity(0.82)
                                : Color.primary.opacity(0.55)
                        )
                }
                .animation(.easeInOut(duration: 0.2), value: controller.isOn)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Svjetlo")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)

                    Text(powerCardSubtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                Spacer()

                BigAppleSwitch(
                    isOn: controller.isOn,
                    accentColor: Color(nsColor: .controlAccentColor),
                    action: { controller.togglePower() }
                )
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.primary.opacity(controller.isOn ? 0.08 : 0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.09), lineWidth: 0.5)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .onTapGesture {
                controller.togglePower()
            }
            .disabled(!controller.isConnected)
            .opacity(controller.isConnected ? 1.0 : 0.55)

            // 3. Brightness & Color Temperature Card
            VStack(spacing: 12) {
                VStack(spacing: 5) {
                    HStack {
                        Text("Svjetlina")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.primary.opacity(0.9))
                        Spacer()
                        Text("\(Int(controller.brightness.rounded()))%")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }

                    ControlCenterPillSlider(
                        value: $controller.brightness,
                        range: 1.0...100.0,
                        leftSymbol: "sun.min.fill",
                        rightSymbol: "sun.max.fill",
                        trackFill: AnyShapeStyle(
                            LinearGradient(
                                colors: [Color.white.opacity(0.55), Color.white.opacity(0.92)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        ),
                        isEnabled: controller.isConnected && controller.isOn,
                        onChanged: { newVal, dragging in
                            controller.updateBrightness(newVal, isDragging: dragging)
                        }
                    )
                }

                VStack(spacing: 5) {
                    HStack {
                        Text("Temperatura")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.primary.opacity(0.9))
                        Spacer()
                        Text(ColorTempMath.labelForKelvin(controller.kelvin))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }

                    TemperaturePillSlider(
                        kelvin: $controller.kelvin,
                        isEnabled: controller.isConnected && controller.isOn,
                        onChanged: { newK, dragging in
                            controller.updateKelvin(newK, isDragging: dragging)
                        }
                    )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.primary.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.09), lineWidth: 0.5)
                    )
            )
            .disabled(!controller.isConnected)
            .opacity(controller.isConnected ? 1.0 : 0.55)

            // 4. Now Playing Light Show / Takeover & Open LEDicated Studio Card
            HStack(spacing: 8) {
                Button(action: {
                    controller.openWebStudio(closePopover: closePopover)
                }) {
                    HStack(spacing: 10) {
                        FloatingMusicalNotesBadge(isPlaying: controller.showIsPlaying)

                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(nowPlayingHeadline)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)

                                if let bpm = controller.showBpm, bpm >= 40 {
                                    Text("\(bpm) BPM")
                                        .font(.system(size: 9, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1.5)
                                        .background(Capsule().fill(Color.primary.opacity(0.08)))
                                }
                            }

                            Text(nowPlayingSubline)
                                .font(.system(size: 10.5, weight: .regular))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }

                        Spacer(minLength: 2)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Klikni za otvaranje LEDicated Studio web aplikacije")

                // Instant 1-Click Takeover Button (Show <-> Menu Bar)
                Button(action: {
                    if controller.isLiveDdpActive {
                        controller.takeOverWithAmbient()
                    } else {
                        controller.takeOverWithShow()
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: controller.isLiveDdpActive ? "lightbulb.fill" : "bolt.fill")
                            .font(.system(size: 10, weight: .bold))
                        Text(controller.isLiveDdpActive ? "Uredsko" : "Pusti Show")
                            .font(.system(size: 10.5, weight: .semibold))
                    }
                    .foregroundStyle(controller.isLiveDdpActive ? Color.orange : Color.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5.5)
                    .background(
                        Capsule(style: .continuous)
                            .fill(
                                controller.isLiveDdpActive
                                    ? AnyShapeStyle(Color.orange.opacity(0.16))
                                    : AnyShapeStyle(LinearGradient(colors: [Color.purple, Color.blue], startPoint: .leading, endPoint: .trailing))
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .strokeBorder(
                                        controller.isLiveDdpActive ? Color.orange.opacity(0.35) : Color.white.opacity(0.18),
                                        lineWidth: 0.5
                                    )
                            )
                    )
                }
                .buttonStyle(.plain)
                .disabled(!controller.isConnected)
                .help(
                    controller.isLiveDdpActive
                        ? "Preuzmi kontrolu i vrati statično uredsko svjetlo (Menu Bar)"
                        : "Preuzmi kontrolu i pusti Light Show na 3×3 LED zid"
                )

                Button(action: {
                    controller.openWebStudio(closePopover: closePopover)
                }) {
                    if controller.isStartingServer {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.75)
                            .frame(width: 22, height: 22)
                    } else {
                        Image(systemName: "arrow.up.forward")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(Color.primary.opacity(0.06)))
                    }
                }
                .buttonStyle(.plain)
                .help("Otvori LEDicated Studio u pregledniku")
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(controller.isLiveDdpActive ? Color.purple.opacity(0.11) : Color.primary.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(
                                controller.isLiveDdpActive ? Color.purple.opacity(0.30) : Color.primary.opacity(0.09),
                                lineWidth: 0.5
                            )
                    )
            )

            // 5. Compact Telemetry Strip: Trenutno W · Ukupno ikad (E8) · Refresh Rate (Hz)
            HStack(spacing: 0) {
                telemetryItem(
                    icon: "bolt.fill",
                    iconColor: controller.currentWatts > 10 ? .yellow : .secondary,
                    title: "TRENUTNO",
                    value: formattedWatts(controller.currentWatts)
                )

                Divider()
                    .frame(height: 22)
                    .opacity(0.4)

                telemetryItem(
                    icon: "gauge.with.dots.needle.67percent",
                    iconColor: .cyan,
                    title: "UKUPNO IKAD",
                    value: formattedTotalEnergy(controller.totalWhEver)
                )

                Divider()
                    .frame(height: 22)
                    .opacity(0.4)

                telemetryItem(
                    icon: "waveform.path.ecg",
                    iconColor: controller.isLiveDdpActive ? .green : .secondary,
                    title: "OSVJEŽAVANJE",
                    value: formattedRefreshRate()
                )
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 6)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color.primary.opacity(0.04))
                    .overlay(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.5)
                    )
            )
            .opacity(controller.isConnected ? 1.0 : 0.5)
        }
        .padding(13)
        .frame(width: 312)
    }

    @ViewBuilder
    private func telemetryItem(icon: String, iconColor: Color, title: String, value: String) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(iconColor)
                Text(title)
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.primary.opacity(0.9))
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity)
    }

    private func formattedWatts(_ w: Double) -> String {
        if !controller.isConnected { return "— W" }
        if w < 10.0 {
            return String(format: "%.1f W", w)
        }
        return "\(Int(w.rounded())) W"
    }

    private func formattedTotalEnergy(_ wh: Double) -> String {
        if wh >= 1000.0 {
            return String(format: "%.2f kWh", wh / 1000.0)
        }
        if wh >= 100.0 {
            return String(format: "%.1f Wh", wh)
        }
        return String(format: "%.2f Wh", wh)
    }

    private func formattedRefreshRate() -> String {
        if !controller.isConnected { return "— Hz" }
        if !controller.isOn && !controller.isLiveDdpActive { return "0 Hz" }
        let hz = max(1, controller.refreshRateHz)
        return controller.isLiveDdpActive ? "\(hz) Hz · DDP" : "\(hz) Hz"
    }

    private var nowPlayingHeadline: String {
        if controller.isStartingServer {
            return "Pokrećem LEDicated Studio…"
        }
        if let title = controller.showTitle, !title.isEmpty {
            return title
        }
        return "LEDicated Studio"
    }

    private var nowPlayingSubline: String {
        if controller.isStartingServer {
            return "Otvaram web aplikaciju u pregledniku…"
        }
        if controller.isLiveDdpActive {
            let src = controller.showSource == "youtube" ? "YouTube Show na zidu" : "Light Show na zidu"
            return "🟢 \(src) · klikni za Studio"
        }
        if controller.showIsPlaying {
            return "💡 Uredsko svjetlo aktivno · klikni Pusti Show"
        }
        if controller.showTitle != nil {
            return "⏸ Spremno · klikni Pusti Show ili otvori Studio"
        }
        return "Klikni za Studio ili Pusti Show"
    }

    private var statusSubtitle: String {
        if controller.isConnected {
            return "\(controller.deviceName) · \(controller.deviceHost)"
        }
        return "Tražim E8 na mreži…"
    }

    private var powerCardSubtitle: String {
        if !controller.isConnected {
            return "Nije u dometu ureda"
        }
        if controller.isLiveDdpActive {
            return "Uživo Light Show · \(Int(controller.currentWatts.rounded())) W"
        }
        if controller.isOn {
            return "Upaljeno · \(Int(controller.brightness.rounded()))% · \(Int(controller.currentWatts.rounded())) W"
        }
        return "Ugašeno · spremljeno na E8"
    }
}

// MARK: - AppDelegate & Status Bar Item

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private let controller = E8LightController()
    private var eventMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.target = self
            button.action = #selector(handleStatusBarClick(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        controller.onStatusBarUpdate = { [weak self] in
            self?.updateStatusBarIcon()
        }
        updateStatusBarIcon()

        let contentView = MenuBarPopoverView(
            controller: controller,
            closePopover: { [weak self] in
                self?.closePopover()
            }
        )

        let hosting = NSHostingController(rootView: contentView)
        popover.contentViewController = hosting
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self

        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.popover.isShown else { return }
            self.closePopover()
        }
    }

    private func updateStatusBarIcon() {
        guard let button = statusItem?.button else { return }
        let symbolName: String
        if !controller.isConnected {
            symbolName = "lightbulb.slash"
        } else if controller.showIsPlaying || controller.isLiveDdpActive {
            symbolName = "sparkles"
        } else if controller.isOn {
            symbolName = "lightbulb.fill"
        } else {
            symbolName = "lightbulb"
        }

        let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "LEDicated Rasvjeta")?.withSymbolConfiguration(config) {
            image.isTemplate = true
            button.image = image
        }
        button.alphaValue = controller.isConnected ? 1.0 : 0.55
    }

    @objc private func handleStatusBarClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else {
            togglePopover(sender)
            return
        }
        if event.type == .rightMouseUp || event.modifierFlags.contains(.option) {
            let menu = NSMenu()
            let studioItem = NSMenuItem(title: "Otvori LEDicated Studio…", action: #selector(openStudioFromMenu), keyEquivalent: "o")
            studioItem.target = self
            menu.addItem(studioItem)
            menu.addItem(.separator())
            let quitItem = NSMenuItem(title: "Zatvori iz Menu Bara", action: #selector(quitApp), keyEquivalent: "q")
            quitItem.target = self
            menu.addItem(quitItem)
            statusItem.menu = menu
            buttonClickMenuCleanup()
            return
        }
        togglePopover(sender)
    }

    private func buttonClickMenuCleanup() {
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func openStudioFromMenu() {
        controller.openWebStudio(closePopover: {})
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private func togglePopover(_ sender: NSStatusBarButton) {
        if popover.isShown {
            closePopover()
        } else {
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
            controller.setPopoverOpen(true)
        }
    }

    private func closePopover() {
        popover.performClose(nil)
        controller.setPopoverOpen(false)
    }

    func popoverDidClose(_ notification: Notification) {
        controller.setPopoverOpen(false)
    }
}

@main
struct LEDicatedMenuBarApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
