import Foundation
import SwiftUI

public enum BarID: String, CaseIterable, Codable, Identifiable, Sendable {
    case L1, C1, R1
    case L2, C2, R2
    case L3, C3, R3

    public var id: String { rawValue }

    public var row: Int {
        switch self {
        case .L1, .C1, .R1: return 0
        case .L2, .C2, .R2: return 1
        case .L3, .C3, .R3: return 2
        }
    }

    public var column: Int {
        switch self {
        case .L1, .L2, .L3: return 0
        case .C1, .C2, .C3: return 1
        case .R1, .R2, .R3: return 2
        }
    }

    public static let allRawIds: [String] = allCases.map(\.rawValue)
    public static let outerPerimeterIds: [String] = ["L1", "C1", "R1", "R2", "R3", "C3", "L3", "L2"]
}

public struct ZonePreset: Identifiable, Sendable {
    public let id: String
    public let label: String
    public let bars: [String]

    public static let allPresets: [ZonePreset] = [
        ZonePreset(id: "all", label: "Svi (9)", bars: BarID.allRawIds),
        ZonePreset(id: "left", label: "Lijevo", bars: ["L1", "L2", "L3"]),
        ZonePreset(id: "center", label: "Centar", bars: ["C1", "C2", "C3"]),
        ZonePreset(id: "right", label: "Desno", bars: ["R1", "R2", "R3"]),
        ZonePreset(id: "edge", label: "Rub", bars: ["L1", "L2", "L3", "R1", "R2", "R3"]),
        ZonePreset(id: "cross", label: "Križ", bars: ["C1", "L2", "C2", "R2", "C3"]),
        ZonePreset(id: "top", label: "Gornji", bars: ["L1", "C1", "R1"]),
        ZonePreset(id: "mid", label: "Srednji", bars: ["L2", "C2", "R2"]),
        ZonePreset(id: "bot", label: "Donji", bars: ["L3", "C3", "R3"])
    ]
}

public struct RGBWPixel: Sendable, Equatable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var w: Double

    public init(r: Double, g: Double, b: Double, w: Double) {
        self.r = r
        self.g = g
        self.b = b
        self.w = w
    }

    public static let zero = RGBWPixel(r: 0, g: 0, b: 0, w: 0)

    /// Full-brightness display RGB (0...1) with warm-white mixing and hue-preserving perceptual gamma lift,
    /// ensuring all active timeline and live effects render at vivid full brightness on iPhone regardless of room dimming.
    public var displayRGB: (r: Double, g: Double, b: Double, energy: Double) {
        let linR = min(1.0, max(0.0, r + w * 0.95))
        let linG = min(1.0, max(0.0, g + w * 0.78))
        let linB = min(1.0, max(0.0, b + w * 0.48))
        let rawPeak = max(linR, max(linG, linB))
        guard rawPeak > 0.004 else {
            return (0, 0, 0, 0)
        }
        let gamma = 1.0 / 2.0
        let outR = min(1.0, pow(linR, gamma))
        let outG = min(1.0, pow(linG, gamma))
        let outB = min(1.0, pow(linB, gamma))
        let peak = max(outR, max(outG, outB))
        let targetPeak = min(1.0, 0.18 + 0.82 * peak)
        let boost = peak > 0.001 ? (targetPeak / peak) : 1.0
        return (
            min(1.0, outR * boost),
            min(1.0, outG * boost),
            min(1.0, outB * boost),
            targetPeak
        )
    }
}

public struct StageTelemetryStats: Sendable, Equatable {
    public let r: Double
    public let g: Double
    public let b: Double
    public let w: Double
    public let watts: Int

    public static let zero = StageTelemetryStats(r: 0, g: 0, b: 0, w: 0, watts: 0)

    public static func compute(from bars: [BarID: [RGBWPixel]], blackout: Bool) -> StageTelemetryStats {
        guard !blackout else { return .zero }
        var sumR = 0.0, sumG = 0.0, sumB = 0.0, sumW = 0.0
        var count = 0.0
        for pxList in bars.values {
            for px in pxList {
                sumR += px.r
                sumG += px.g
                sumB += px.b
                sumW += px.w
                count += 1
            }
        }
        let denom = max(1.0, count)
        let r = sumR / denom
        let g = sumG / denom
        let b = sumB / denom
        let w = sumW / denom
        let avg = (r + g + b + w) / 4.0
        if avg < 0.005 {
            return .zero
        }
        let watts = Int((avg * 171.0).rounded())
        return StageTelemetryStats(r: r, g: g, b: b, w: w, watts: watts)
    }
}
