import Foundation
import Observation

/// High-frequency (30–60 Hz) store for live LED bar frames and playhead timecode.
/// Separated from `StudioClient` so 30 Hz SSE `frame_sync` packets only invalidate
/// stage preview canvases and timecode labels, never the 12-pad grid or inspector sheets.
@MainActor
@Observable
public final class StageFrameStore {
    public var remoteFrameBars: [BarID: [RGBWPixel]] = [:]
    public var lastRemoteFrameUptime: TimeInterval = 0
    public var timeSec: Double = 0
    public var lastSyncUptime: TimeInterval = ProcessInfo.processInfo.systemUptime

    public init() {}

    public func interpolatedPlayheadSec(isPlaying: Bool, durationSec: Double) -> Double {
        guard isPlaying else { return timeSec }
        let elapsed = max(0, ProcessInfo.processInfo.systemUptime - lastSyncUptime)
        return min(max(durationSec, 1), timeSec + elapsed)
    }

    public func updateTime(_ seconds: Double, now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        timeSec = max(0, seconds)
        lastSyncUptime = now
    }

    public func parseBarsObject(
        _ barsObj: [String: Any],
        unscaled: Bool = false,
        masterBrightness: Double = 100.0,
        now: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) {
        // Always display full-brightness preview on the phone regardless of the set master brightness.
        // If the server sent `unscaled: true`, values are already 0...255 full scale; otherwise undo master scaling.
        let rawScale = max(0.01, min(1.0, masterBrightness / 100.0))
        let invScale: Double = (unscaled || rawScale >= 0.995) ? 1.0 : (1.0 / rawScale)
        var parsed: [BarID: [RGBWPixel]] = [:]
        for bar in BarID.allCases {
            if let rawList = barsObj[bar.rawValue] as? [[Any]] {
                var pxArr: [RGBWPixel] = []
                pxArr.reserveCapacity(AppConfiguration.pixelsPerBar)
                for item in rawList.prefix(AppConfiguration.pixelsPerBar) {
                    let r = min(1.0, (((item.count > 0 ? (item[0] as? NSNumber)?.doubleValue : 0) ?? 0) / 255.0) * invScale)
                    let g = min(1.0, (((item.count > 1 ? (item[1] as? NSNumber)?.doubleValue : 0) ?? 0) / 255.0) * invScale)
                    let b = min(1.0, (((item.count > 2 ? (item[2] as? NSNumber)?.doubleValue : 0) ?? 0) / 255.0) * invScale)
                    let w = min(1.0, (((item.count > 3 ? (item[3] as? NSNumber)?.doubleValue : 0) ?? 0) / 255.0) * invScale)
                    pxArr.append(RGBWPixel(r: r, g: g, b: b, w: w))
                }
                if pxArr.count == AppConfiguration.pixelsPerBar {
                    parsed[bar] = pxArr
                }
            }
        }
        if !parsed.isEmpty {
            remoteFrameBars = parsed
            lastRemoteFrameUptime = now
        }
    }
}
