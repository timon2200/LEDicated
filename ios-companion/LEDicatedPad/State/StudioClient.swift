import Foundation
import SwiftUI
import Observation

@MainActor
@Observable
public final class StudioClient {
    public let frameStore = StageFrameStore()
    public let roomLight = RoomLightController.shared

    public var studioHost: String {
        didSet {
            UserDefaults.standard.set(studioHost, forKey: AppConfiguration.studioHostKey)
        }
    }

    public let clientId: String
    public var isConnected: Bool = false
    public var isSearchingNetwork: Bool = false
    public var lastStatusMessage: String = "Tražim Mac Studio na Wi-Fi mreži…"
    public var rttMs: Int = 0
    public var serverHostname: String = AppConfiguration.defaultServerHostname
    public var serverIp: String = AppConfiguration.defaultServerIp
    public var stageState: String = "on_air"
    public var stageOwnerName: String = "Mortu"
    public var isStageOwner: Bool = true
    public var isRecordingSession: Bool = false
    public var holdLatchMode: Bool = false
    public var inspectorOnTapMode: Bool = false
    public var quantize: Bool = false

    public var pads: [PadConfig] = PadConfig.defaultPads
    public var selectedPadIndex: Int = 0
    public var activePads: [Int: ActivePadRun] = [:]
    public var queuedPads: [Int: TimeInterval] = [:]
    public var heldPads: [Int: HeldPadRun] = [:]
    @ObservationIgnored public var spatialTouches: [String: SpatialTouchRun] = [:]
    public var liveColor: [Double] = [0.0, 0.82, 1.0, 0.0]
    public var liveIntensity: Double = 1.0
    public var liveSpread: Double = 0.0
    public var liveHue: Double = 195.0
    public var liveSat: Double = 1.0
    public var liveEffect: String = "solid"
    public var lockedCols: Set<Int> = []
    public var lockedRows: Set<Int> = []
    @ObservationIgnored internal var lastColorSendUptime: TimeInterval = 0
    @ObservationIgnored internal var lastIntensitySendUptime: TimeInterval = 0
    @ObservationIgnored internal var lastSpreadSendUptime: TimeInterval = 0
    @ObservationIgnored internal var lastTouchMoveSendUptime: [String: TimeInterval] = [:]
    @ObservationIgnored internal var lastLocalTouchUptime: TimeInterval = 0
    @ObservationIgnored internal var lastRttUpdateUptime: TimeInterval = 0
    @ObservationIgnored internal var commandQueue: [[String: Any]] = []
    @ObservationIgnored internal var isDrainingCommands: Bool = false

    // Track when a pad was locally touched so in-flight network packets don't cause bounce/flicker
    @ObservationIgnored internal var lastLocalActionUptime: [Int: TimeInterval] = [:]
    @ObservationIgnored internal var sseStreamingActive: Bool = false

    // Studio Transport & Track State
    public var trackId: String? = nil
    public var launchingTrackId: String? = nil
    public var trackTitle: String = "LEDicated Live Performance"
    public var sectionName: String = "LIVE"
    public var isPlaying: Bool = false
    public var durationSec: Double = 180
    public var bpm: Double = 124
    public var masterBrightness: Double = 45
    public var blackout: Bool = false
    public var sections: [TrackSection] = []
    public var libraryTracks: [LibraryTrack] = []
    public var discoveredServers: [DiscoveredStudioServer] = []
    public var discoveredHosts: [String] = AppConfiguration.initialDiscoveredHosts

    // High-frequency properties delegated to `frameStore` so non-stage views aren't invalidated at 30 Hz
    public var timeSec: Double {
        get { frameStore.timeSec }
        set { frameStore.timeSec = newValue }
    }

    public var lastSyncUptime: TimeInterval {
        get { frameStore.lastSyncUptime }
        set { frameStore.lastSyncUptime = newValue }
    }

    public var remoteFrameBars: [BarID: [RGBWPixel]] {
        get { frameStore.remoteFrameBars }
        set { frameStore.remoteFrameBars = newValue }
    }

    public var interpolatedPlayheadSec: Double {
        frameStore.interpolatedPlayheadSec(isPlaying: isPlaying, durationSec: durationSec)
    }

    internal var sseTask: Task<Void, Never>?
    internal var pollTask: Task<Void, Never>?
    internal var localHousekeepingTask: Task<Void, Never>?

    internal let fastSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 2.0
        cfg.timeoutIntervalForResource = 4.0
        cfg.httpMaximumConnectionsPerHost = 6
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: cfg)
    }()

    public init() {
        let rawSaved = UserDefaults.standard.string(forKey: AppConfiguration.studioHostKey) ?? ""
        let initialHost: String
        if rawSaved.isEmpty || rawSaved.contains("192.168.18.10") {
            initialHost = AppConfiguration.defaultStudioHost
            UserDefaults.standard.set(initialHost, forKey: AppConfiguration.studioHostKey)
        } else {
            initialHost = rawSaved
        }
        self.studioHost = initialHost

        if let savedId = UserDefaults.standard.string(forKey: AppConfiguration.clientIdKey) {
            self.clientId = savedId
        } else {
            let newId = "ios-pad-\(UUID().uuidString.prefix(8).lowercased())"
            UserDefaults.standard.set(newId, forKey: AppConfiguration.clientIdKey)
            self.clientId = newId
        }

        // Load cached MacBook pads immediately (0 ms startup!)
        if let cachedData = UserDefaults.standard.data(forKey: AppConfiguration.padsCacheKey),
           let decoded = try? JSONDecoder().decode([PadConfig].self, from: cachedData),
           decoded.count == AppConfiguration.totalPadSlots {
            self.pads = decoded
        }

        startNetworking()
    }

    internal func savePadsToCache(_ list: [PadConfig]) {
        if let encoded = try? JSONEncoder().encode(list) {
            UserDefaults.standard.set(encoded, forKey: AppConfiguration.padsCacheKey)
        }
    }

    public var selectedPad: PadConfig {
        get {
            guard pads.indices.contains(selectedPadIndex) else { return PadConfig.defaultPads[0] }
            return pads[selectedPadIndex]
        }
        set {
            guard pads.indices.contains(selectedPadIndex) else { return }
            pads[selectedPadIndex] = newValue
            savePadsToCache(pads)
        }
    }

    public var shortHostLabel: String {
        studioHost
            .replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: ":\(AppConfiguration.defaultPort)", with: "")
    }

    public func tickAndRenderBars(now: TimeInterval) -> [BarID: [RGBWPixel]] {
        BarSynthesizer.renderBars(
            now: now,
            blackout: blackout,
            isConnected: isConnected,
            isPlaying: isPlaying,
            bpm: bpm,
            pads: pads,
            activePads: activePads,
            heldPads: heldPads,
            spatialTouches: spatialTouches,
            liveSpread: liveSpread,
            lockedCols: lockedCols,
            lockedRows: lockedRows,
            lastLocalActionUptime: lastLocalActionUptime,
            remoteFrameBars: frameStore.remoteFrameBars,
            lastRemoteFrameUptime: frameStore.lastRemoteFrameUptime
        )
    }
}
