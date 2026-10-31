import Foundation

public struct TrackSection: Codable, Identifiable, Sendable {
    public var id: String { "\(label ?? kind ?? "sec")-\(startSec)" }
    public var kind: String?
    public var label: String?
    public var startSec: Double
    public var endSec: Double?

    public init(kind: String? = nil, label: String? = nil, startSec: Double, endSec: Double? = nil) {
        self.kind = kind
        self.label = label
        self.startSec = startSec
        self.endSec = endSec
    }
}

public struct LibraryTrack: Codable, Identifiable, Sendable {
    public var id: String
    public var title: String?
    public var originalName: String?
    public var durationSec: Double?
    public var bpm: Double?
    public var hasTimeline: Bool?
    public var author: String?
    public var version: Int?
    public var clipCount: Int?
    public var layerCount: Int?
    public var showId: String?
    public var sharedFilename: String?
    public var installedTrackId: String?
    public var isSharedOnly: Bool?

    public init(
        id: String,
        title: String? = nil,
        originalName: String? = nil,
        durationSec: Double? = nil,
        bpm: Double? = nil,
        hasTimeline: Bool? = nil,
        author: String? = nil,
        version: Int? = nil,
        clipCount: Int? = nil,
        layerCount: Int? = nil,
        showId: String? = nil,
        sharedFilename: String? = nil,
        installedTrackId: String? = nil,
        isSharedOnly: Bool? = nil
    ) {
        self.id = id
        self.title = title
        self.originalName = originalName
        self.durationSec = durationSec
        self.bpm = bpm
        self.hasTimeline = hasTimeline
        self.author = author
        self.version = version
        self.clipCount = clipCount
        self.layerCount = layerCount
        self.showId = showId
        self.sharedFilename = sharedFilename
        self.installedTrackId = installedTrackId
        self.isSharedOnly = isSharedOnly
    }

    public var displayTitle: String {
        title ?? originalName ?? id
    }

    public var effectiveTrackId: String {
        installedTrackId ?? id
    }
}
