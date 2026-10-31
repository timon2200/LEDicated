import Foundation
import SwiftUI
import Observation

public enum RoomLightPreset: String, CaseIterable, Identifiable, Sendable {
    case warm2700, neutral4000, fullPower, cool6500
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .warm2700: return "Topla"
        case .neutral4000: return "Prirodna"
        case .fullPower: return "Puna"
        case .cool6500: return "Hladna"
        }
    }

    public var subtitle: String {
        switch self {
        case .warm2700: return "2700K"
        case .neutral4000: return "4000K"
        case .fullPower: return "4800K MAX"
        case .cool6500: return "6500K"
        }
    }

    public var kelvin: Double {
        switch self {
        case .warm2700: return 2700
        case .neutral4000: return 4000
        case .fullPower: return 4800
        case .cool6500: return 6500
        }
    }

    public var brightness: Double {
        switch self {
        case .warm2700: return 178
        case .neutral4000: return 210
        case .fullPower: return 255
        case .cool6500: return 225
        }
    }
}

public enum ColorTempMath {
    public static let minKelvin: Double = 2700
    public static let maxKelvin: Double = 6500
    public static let defaultKelvin: Double = 4000

    public static func rgbwForKelvin(_ kelvin: Double) -> [Int] {
        let clamped = min(max(kelvin, minKelvin), maxKelvin)
        let t = (clamped - minKelvin) / (maxKelvin - minKelvin)
        let r: Double, g: Double, b: Double, w: Double
        if t <= 0.22 {
            let p = t / 0.22
            r = 255.0; g = 115.0 + 65.0 * p; b = 18.0 + 72.0 * p; w = 255.0
        } else if t <= 0.56 {
            let p = (t - 0.22) / 0.34
            r = 255.0; g = 180.0 + 75.0 * p; b = 90.0 + 165.0 * p; w = 255.0
        } else {
            let p = (t - 0.56) / 0.44
            r = 255.0 - 45.0 * p; g = 255.0 - 12.0 * p; b = 255.0; w = 255.0 - 80.0 * p
        }
        return [Int(r.rounded()), Int(g.rounded()), Int(b.rounded()), Int(w.rounded())]
    }

    public static func kelvinFromRgbw(_ col: [Int]) -> Double {
        guard col.count >= 4 else { return defaultKelvin }
        let r = col[0], g = col[1], b = col[2], w = col[3]
        if r == 0 && g == 0 && b == 0 && w == 0 { return defaultKelvin }
        if w < 250 && b >= 245 {
            let p = min(1.0, max(0.0, Double(255 - w) / 80.0))
            return ((minKelvin + (0.56 + p * 0.44) * (maxKelvin - minKelvin)) / 50.0).rounded() * 50.0
        }
        if b < 90 {
            let p = min(1.0, max(0.0, Double(b - 18) / 72.0))
            return ((minKelvin + (p * 0.22) * (maxKelvin - minKelvin)) / 50.0).rounded() * 50.0
        }
        let p = min(1.0, max(0.0, Double(b - 90) / 165.0))
        return ((minKelvin + (0.22 + p * 0.34) * (maxKelvin - minKelvin)) / 50.0).rounded() * 50.0
    }

    public static func labelForKelvin(_ kelvin: Double) -> String {
        let k = Int(kelvin.rounded())
        if k < 3200 { return "\(k)K · Topla" }
        if k < 4300 { return "\(k)K · Prirodna" }
        if k < 5300 { return "\(k)K · Puna" }
        return "\(k)K · Hladna"
    }

    public static func previewColor(for kelvin: Double) -> Color {
        let t = min(max((kelvin - minKelvin) / (maxKelvin - minKelvin), 0), 1)
        if t < 0.45 {
            let u = t / 0.45
            return Color(red: 1.0, green: 0.72 + 0.23 * u, blue: 0.38 + 0.54 * u)
        }
        let u = (t - 0.45) / 0.55
        return Color(red: 1.0 - 0.16 * u, green: 0.95 - 0.03 * u, blue: 0.92 + 0.08 * u)
    }

    public static func computeRealWatts(isOn: Bool, bri: Int, rgbw: [Int]) -> Double {
        let idle = 3.2
        guard isOn, bri > 0 else { return idle }
        let bScale = Double(min(max(bri, 0), 255)) / 255.0
        let r = Double(rgbw.indices.contains(0) ? rgbw[0] : 0) / 255.0
        let g = Double(rgbw.indices.contains(1) ? rgbw[1] : 0) / 255.0
        let b = Double(rgbw.indices.contains(2) ? rgbw[2] : 0) / 255.0
        let w = Double(rgbw.indices.contains(3) ? rgbw[3] : 255) / 255.0
        return idle + bScale * (r * 41.4 + g * 41.4 + b * 41.4 + w * 48.6)
    }
}

public enum RoomLightNetworkHelper {
    public static let isOnKey = "ledicated.roomLight.isOn"
    public static let brightnessKey = "ledicated.roomLight.brightness"
    public static let kelvinKey = "ledicated.roomLight.kelvin"
    public static let e8HostKey = "ledicated.e8Host"
    public static let defaultE8Host = "192.168.0.117"
    public static let fallbackMdnsHost = "wled-7a14f8.local"

    private static let fastSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 1.3
        cfg.timeoutIntervalForResource = 2.0
        return URLSession(configuration: cfg)
    }()

    public static func savedState() -> (isOn: Bool, brightness: Double, kelvin: Double, e8Host: String, studioHost: String) {
        let d = UserDefaults.standard
        let isOn = d.object(forKey: isOnKey) as? Bool ?? false
        let rawBri = d.object(forKey: brightnessKey) as? Double ?? 204.0
        let rawKel = d.object(forKey: kelvinKey) as? Double ?? ColorTempMath.defaultKelvin
        let e8 = d.string(forKey: e8HostKey) ?? defaultE8Host
        let studio = d.string(forKey: AppConfiguration.studioHostKey) ?? AppConfiguration.defaultStudioHost
        return (isOn, min(max(rawBri, 3), 255), min(max(rawKel, 2700), 6500), e8, studio)
    }

    public static func persistState(isOn: Bool, brightness: Double, kelvin: Double) {
        let d = UserDefaults.standard
        d.set(isOn, forKey: isOnKey)
        d.set(brightness, forKey: brightnessKey)
        d.set(kelvin, forKey: kelvinKey)
    }

    @discardableResult
    public static func sendLightState(
        isOn: Bool,
        brightness: Double,
        kelvin: Double,
        studioHost: String? = nil,
        saveToFlash: Bool = true
    ) async -> Bool {
        persistState(isOn: isOn, brightness: brightness, kelvin: kelvin)
        let saved = savedState()
        let activeStudio = studioHost ?? saved.studioHost
        let briInt = max(1, min(255, Int(brightness.rounded())))
        let kelInt = max(2700, min(6500, Int(kelvin.rounded())))
        let rgbw = ColorTempMath.rgbwForKelvin(Double(kelInt))

        var wledPayload: [String: Any] = [
            "on": isOn, "bri": briInt, "transition": 2, "lor": 2,
            "seg": [["id": 0, "on": true, "bri": 255, "fx": 0, "col": [rgbw, [0, 0, 0, 0], [0, 0, 0, 0]]]]
        ]
        if saveToFlash {
            wledPayload["psave"] = 1
            wledPayload["n"] = "Uredska rasvjeta"
            wledPayload["ib"] = true
            wledPayload["sb"] = true
        }
        let studioPayload: [String: Any] = ["on": isOn, "bri": briInt, "kelvin": kelInt, "saveToFlash": saveToFlash]
        let wledData = try? JSONSerialization.data(withJSONObject: wledPayload)
        let studioData = try? JSONSerialization.data(withJSONObject: studioPayload)
        async let wledOk = postWled(body: wledData, e8Host: saved.e8Host)
        async let studioOk = postStudio(body: studioData, studioHost: activeStudio)
        let (wRes, sRes) = await (wledOk, studioOk)
        return wRes || sRes
    }

    private static func postWled(body: Data?, e8Host: String) async -> Bool {
        guard let body else { return false }
        for host in [e8Host, fallbackMdnsHost] {
            guard let url = URL(string: "http://\(host)/json/state") else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 1.2
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            if let (_, resp) = try? await fastSession.data(for: req),
               let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                if host != e8Host { UserDefaults.standard.set(host, forKey: e8HostKey) }
                return true
            }
        }
        return false
    }

    private static func postStudio(body: Data?, studioHost: String) async -> Bool {
        guard let body, let url = URL(string: "\(studioHost)/api/ambient-light") else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 1.3
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        if let (_, resp) = try? await fastSession.data(for: req),
           let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
            return true
        }
        return false
    }

    public static func fetchDirectE8State(e8Host: String) async -> [String: Any]? {
        for host in [e8Host, fallbackMdnsHost] {
            guard let url = URL(string: "http://\(host)/json/si") else { continue }
            var req = URLRequest(url: url)
            req.timeoutInterval = 1.1
            if let (data, resp) = try? await fastSession.data(for: req),
               let http = resp as? HTTPURLResponse, http.statusCode == 200,
               let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let state = root["state"] as? [String: Any] {
                let info = root["info"] as? [String: Any]
                let isOn = (state["on"] as? Bool) ?? false
                let bri = (state["bri"] as? Int) ?? 204
                let lor = (state["lor"] as? Int) ?? 0
                let live = ((info?["live"] as? Bool) ?? false) && (lor != 2)
                var col = [0, 0, 0, 255]
                if let segs = state["seg"] as? [[String: Any]], let cols = segs.first?["col"] as? [[Int]],
                   let primary = cols.first, primary.count >= 4 { col = primary }
                let hasColor = (col[0] + col[1] + col[2] + col[3]) > 0
                let isShowCarrier = (lor == 0) && (!hasColor || bri == 255)
                return ["on": isOn && hasColor, "bri": bri, "kelvin": ColorTempMath.kelvinFromRgbw(col), "live": live, "showCarrier": isShowCarrier, "reachable": true]
            }
        }
        return nil
    }
}

@MainActor
@Observable
public final class RoomLightController {
    public static let shared = RoomLightController()

    public var isOn: Bool
    public var brightness: Double
    public var kelvin: Double
    public var currentWatts: Double = 3.2
    public var isConnected: Bool = false
    public var isLiveDdpActive: Bool = false
    public var e8Host: String
    @ObservationIgnored private var lastLocalChangeUptime: TimeInterval = 0
    @ObservationIgnored private var throttleTask: Task<Void, Never>?

    public init() {
        let initial = RoomLightNetworkHelper.savedState()
        self.isOn = initial.isOn
        self.brightness = initial.brightness
        self.kelvin = initial.kelvin
        self.e8Host = initial.e8Host
        self.currentWatts = ColorTempMath.computeRealWatts(
            isOn: initial.isOn, bri: Int(initial.brightness.rounded()), rgbw: ColorTempMath.rgbwForKelvin(initial.kelvin)
        )
    }

    public var brightnessPercent: Int {
        max(1, min(100, Int(((brightness / 255.0) * 100.0).rounded())))
    }

    public var statusSubtitle: String {
        if isLiveDdpActive { return "Preuzmi od Light Showa u statičko svjetlo" }
        return isOn ? "\(brightnessPercent)% · \(ColorTempMath.labelForKelvin(kelvin))" : "Ugašeno · 1 klik za uključenje"
    }

    public func togglePower(studioHost: String? = nil) { setPower(!isOn, studioHost: studioHost) }

    public func setPower(_ newState: Bool, studioHost: String? = nil) {
        isOn = newState
        if newState && brightness < 15 { brightness = 204 }
        isLiveDdpActive = false
        recalculateWatts()
        lastLocalChangeUptime = ProcessInfo.processInfo.systemUptime
        HapticsEngine.shared.tickSelection()
        let b = brightness, k = kelvin
        Task {
            let ok = await RoomLightNetworkHelper.sendLightState(isOn: newState, brightness: b, kelvin: k, studioHost: studioHost, saveToFlash: true)
            self.isConnected = ok
        }
    }

    public func updateBrightness(_ value: Double, isDragging: Bool, studioHost: String? = nil) {
        brightness = min(max(value, 3), 255)
        if !isOn { isOn = true }
        isLiveDdpActive = false
        recalculateWatts()
        dispatchChange(saveToFlash: !isDragging, studioHost: studioHost)
    }

    public func updateKelvin(_ value: Double, isDragging: Bool, studioHost: String? = nil) {
        kelvin = min(max((value / 50.0).rounded() * 50.0, 2700), 6500)
        if !isOn { isOn = true }
        isLiveDdpActive = false
        recalculateWatts()
        dispatchChange(saveToFlash: !isDragging, studioHost: studioHost)
    }

    public func applyPreset(_ preset: RoomLightPreset, studioHost: String? = nil) {
        isOn = true
        brightness = preset.brightness
        kelvin = preset.kelvin
        isLiveDdpActive = false
        recalculateWatts()
        HapticsEngine.shared.tickSelection()
        dispatchChange(saveToFlash: true, studioHost: studioHost)
    }

    public func applyRemoteSync(_ dict: [String: Any]) {
        guard ProcessInfo.processInfo.systemUptime - lastLocalChangeUptime > 0.9 else { return }
        let liveVal = (dict["live"] as? Bool) ?? (dict["isLive"] as? Bool) ?? false
        let isShowCarrier = (dict["showCarrier"] as? Bool) ?? false
        isLiveDdpActive = liveVal
        if let reachVal = (dict["reachable"] as? Bool) ?? (dict["connected"] as? Bool) { isConnected = reachVal }
        guard !liveVal && !isShowCarrier else { return }
        if let onVal = dict["on"] as? Bool { isOn = onVal }
        if let briVal = (dict["bri"] as? NSNumber)?.doubleValue, briVal > 0 {
            brightness = briVal
        } else if let pctVal = (dict["brightness"] as? NSNumber)?.doubleValue, pctVal > 0 {
            brightness = (pctVal / 100.0) * 255.0
        }
        if let kelVal = (dict["kelvin"] as? NSNumber)?.doubleValue, kelVal >= 2700 { kelvin = kelVal }
        RoomLightNetworkHelper.persistState(isOn: isOn, brightness: brightness, kelvin: kelvin)
        recalculateWatts()
    }

    public func pollDirectE8() async {
        if let dict = await RoomLightNetworkHelper.fetchDirectE8State(e8Host: e8Host) {
            applyRemoteSync(dict)
        }
    }

    private func recalculateWatts() {
        currentWatts = ColorTempMath.computeRealWatts(isOn: isOn, bri: Int(brightness.rounded()), rgbw: ColorTempMath.rgbwForKelvin(kelvin))
    }

    private func dispatchChange(saveToFlash: Bool, studioHost: String?) {
        lastLocalChangeUptime = ProcessInfo.processInfo.systemUptime
        throttleTask?.cancel()
        let onVal = isOn, bVal = brightness, kVal = kelvin
        throttleTask = Task {
            if !saveToFlash {
                try? await Task.sleep(nanoseconds: 65_000_000)
                if Task.isCancelled { return }
            }
            self.isConnected = await RoomLightNetworkHelper.sendLightState(isOn: onVal, brightness: bVal, kelvin: kVal, studioHost: studioHost, saveToFlash: saveToFlash)
        }
    }
}
