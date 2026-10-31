import Foundation

public struct DiscoveredStudioServer: Identifiable, Equatable, Sendable {
    public var id: String { url }
    public var url: String
    public var hostname: String
    public var ip: String
    public var rttMs: Int
    public var stageOwnerName: String?
    public var trackTitle: String?

    public init(
        url: String,
        hostname: String,
        ip: String,
        rttMs: Int,
        stageOwnerName: String? = nil,
        trackTitle: String? = nil
    ) {
        self.url = url
        self.hostname = hostname
        self.ip = ip
        self.rttMs = rttMs
        self.stageOwnerName = stageOwnerName
        self.trackTitle = trackTitle
    }
}

public struct ActivePadRun: Sendable, Equatable {
    public var startedAt: TimeInterval
    public var until: TimeInterval
    public var held: Bool
    public var oneShot: Bool
    public var repeated: Bool

    public init(
        startedAt: TimeInterval,
        until: TimeInterval = .infinity,
        held: Bool = false,
        oneShot: Bool = false,
        repeated: Bool = false
    ) {
        self.startedAt = startedAt
        self.until = until
        self.held = held
        self.oneShot = oneShot
        self.repeated = repeated
    }
}

public struct HeldPadRun: Sendable, Equatable {
    public var downAt: TimeInterval
    public var wasActive: Bool
    public var mode: String

    public init(downAt: TimeInterval, wasActive: Bool, mode: String) {
        self.downAt = downAt
        self.wasActive = wasActive
        self.mode = mode
    }
}

public enum SpatialTouchMode: String, Sendable, Equatable {
    case hold
    case strobe
    case release
}

public struct SpatialTrailPoint: Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var time: TimeInterval

    public init(x: Double, y: Double, time: TimeInterval) {
        self.x = x
        self.y = y
        self.time = time
    }
}

public struct SpatialPanelHit: Sendable, Equatable {
    public var barId: String
    public var row: Int
    public var col: Int
    public var lastHitAt: TimeInterval
    public var peakGain: Double

    public init(barId: String, row: Int, col: Int, lastHitAt: TimeInterval, peakGain: Double) {
        self.barId = barId
        self.row = row
        self.col = col
        self.lastHitAt = lastHitAt
        self.peakGain = peakGain
    }
}

public struct SpatialTouchRun: Sendable, Equatable, Identifiable {
    public var id: String
    public var col: Int
    public var row: Int
    public var barId: String
    public var startX: Double
    public var startY: Double
    public var originX: Double
    public var originY: Double
    public var x: Double
    public var y: Double
    public var dragSpan: Double
    public var startAt: TimeInterval
    public var lastTickAt: TimeInterval
    public var lastMoveAt: TimeInterval
    public var velocityGain: Double
    public var fadeProgress: Double
    public var dragDown: Double
    public var maxDragDown: Double
    public var snappedCount: Int
    public var lastSnapAt: TimeInterval
    public var lastDimmerStep: Int
    public var mode: SpatialTouchMode
    public var strobeStart: TimeInterval
    public var releaseStart: TimeInterval
    public var releaseLevel: Double
    public var until: TimeInterval
    public var color: [Double]
    public var intensity: Double
    public var effect: String
    public var trailPoints: [SpatialTrailPoint]
    public var panelHits: [String: SpatialPanelHit]

    public static func barIdFor(col: Int, row: Int) -> String {
        let c = max(0, min(2, col))
        let r = max(0, min(2, row))
        let cols = ["L", "C", "R"]
        return "\(cols[c])\(r + 1)"
    }

    public init(
        id: String,
        x: Double,
        y: Double,
        startAt: TimeInterval,
        color: [Double],
        intensity: Double,
        effect: String = "solid",
        velocityGain: Double = 0.78
    ) {
        let c = max(0, min(2, Int(min(0.9999, max(0.0, x)) * 3.0)))
        let r = max(0, min(2, Int(min(0.9999, max(0.0, y)) * 3.0)))
        let ny = max(0.0, min(1.0, y))
        let initialBar = Self.barIdFor(col: c, row: r)
        self.id = id
        self.col = c
        self.row = r
        self.barId = initialBar
        self.startX = x
        self.startY = ny
        self.originX = x
        self.originY = ny
        self.x = x
        self.y = ny
        self.dragSpan = max(0.18, min(0.45, 0.96 - ny))
        self.startAt = startAt
        self.lastTickAt = startAt
        self.lastMoveAt = startAt
        self.velocityGain = velocityGain
        self.fadeProgress = 0
        self.dragDown = 0
        self.maxDragDown = 0
        self.snappedCount = 0
        self.lastSnapAt = 0
        self.lastDimmerStep = 0
        self.mode = .hold
        self.strobeStart = startAt
        self.releaseStart = startAt
        self.releaseLevel = 1.0
        self.until = .infinity
        self.color = color
        self.intensity = intensity
        self.effect = effect
        self.trailPoints = [SpatialTrailPoint(x: x, y: ny, time: startAt)]
        self.panelHits = [
            initialBar: SpatialPanelHit(barId: initialBar, row: r, col: c, lastHitAt: startAt, peakGain: velocityGain)
        ]
    }
}
