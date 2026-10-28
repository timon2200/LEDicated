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
}

public enum PadMode: String, CaseIterable, Codable, Sendable {
    case hit
    case loop

    public var title: String {
        switch self {
        case .hit: return "HIT (Bljesak)"
        case .loop: return "LOOP (Prekidač)"
        }
    }
}

public enum EffectPreset: String, CaseIterable, Codable, Identifiable, Sendable {
    case pulse, chase, sweep, strobe, flash, wash, sparkle, wave
    case ripple, rain, spiral, fire, columns, bounce, prism, aurora

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .pulse: return "Impuls"
        case .chase: return "Potjera"
        case .sweep: return "Val"
        case .strobe: return "Strobo"
        case .flash: return "Bljesak"
        case .wash: return "Preljev"
        case .sparkle: return "Iskre"
        case .wave: return "Sinus"
        case .ripple: return "Koncentrični"
        case .rain: return "Kiša"
        case .spiral: return "Spirala"
        case .fire: return "Vatra"
        case .columns: return "Stupci"
        case .bounce: return "Odskok"
        case .prism: return "Prizma"
        case .aurora: return "Aurora"
        }
    }

    public var sfSymbol: String {
        switch self {
        case .pulse: return "waveform.path.ecg"
        case .chase: return "arrow.right.to.line.compact"
        case .sweep: return "water.waves"
        case .strobe: return "bolt.fill"
        case .flash: return "sun.max.fill"
        case .wash: return "paintbrush.pointed.fill"
        case .sparkle: return "sparkles"
        case .wave: return "waveform"
        case .ripple: return "dot.radiowaves.left.and.right"
        case .rain: return "cloud.rain.fill"
        case .spiral: return "hurricane"
        case .fire: return "flame.fill"
        case .columns: return "chart.bar.fill"
        case .bounce: return "arrow.up.and.down.circle.fill"
        case .prism: return "triangle.lefthalf.filled"
        case .aurora: return "moon.stars.fill"
        }
    }
}

public enum AudioDriver: String, CaseIterable, Codable, Identifiable, Sendable {
    case none, drums, bass, vocals, other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .none: return "Ručno"
        case .drums: return "Bubanj"
        case .bass: return "Bas"
        case .vocals: return "Vokal"
        case .other: return "Synth"
        }
    }
}

public struct PadParams: Codable, Equatable, Sendable {
    public var speed: Double
    public var width: Double?
    public var direction: Double?
    public var softness: Double?
    public var duty: Double?
    public var decay: Double?
    public var density: Double?

    public init(
        speed: Double = 1.4,
        width: Double? = nil,
        direction: Double? = nil,
        softness: Double? = nil,
        duty: Double? = nil,
        decay: Double? = nil,
        density: Double? = nil
    ) {
        self.speed = speed
        self.width = width
        self.direction = direction
        self.softness = softness
        self.duty = duty
        self.decay = decay
        self.density = density
    }
}

public struct PadConfig: Codable, Equatable, Identifiable, Sendable {
    public static let padKeys = ["Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"]

    public var key: String
    public var name: String
    public var mode: String
    public var preset: String
    public var driver: String
    public var intensity: Double
    public var duration: Double
    public var color: [Double]
    public var colorSecondary: [Double]?
    public var white: Double
    public var bars: [String]
    public var params: PadParams

    public var id: String { key }

    public var swiftUIColor: Color {
        guard color.count >= 3 else { return .cyan }
        return Color(red: color[0], green: color[1], blue: color[2])
    }

    public var swiftUISecondaryColor: Color {
        if let sec = colorSecondary, sec.count >= 3 {
            return Color(red: sec[0], green: sec[1], blue: sec[2])
        }
        return swiftUIColor
    }

    public var isLoop: Bool {
        mode == "loop"
    }

    public static let defaultPads: [PadConfig] = [
        PadConfig(key: "Q", name: "Strobe Blinder", mode: "hit", preset: "flash", driver: "none", intensity: 1.0, duration: 0.7, color: [1, 1, 1], colorSecondary: [0.56, 0.77, 1], white: 1.0, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 2.2, decay: 0.85)),
        PadConfig(key: "W", name: "Bass Impact", mode: "hit", preset: "ripple", driver: "bass", intensity: 1.0, duration: 1.1, color: [1, 0.24, 0.54], colorSecondary: [1, 0.54, 0.18], white: 0.15, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.8, width: 0.28)),
        PadConfig(key: "E", name: "Cyan Sweep", mode: "hit", preset: "sweep", driver: "drums", intensity: 0.96, duration: 1.0, color: [0.18, 0.88, 1], colorSecondary: [0.22, 0.45, 1], white: 0.08, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.5, direction: 1, softness: 0.55)),
        PadConfig(key: "R", name: "Laser Strobe", mode: "hit", preset: "strobe", driver: "drums", intensity: 1.0, duration: 0.8, color: [0.42, 0.92, 1], colorSecondary: [1, 0.24, 0.72], white: 0.35, bars: ["L1", "C1", "R1", "L3", "C3", "R3"], params: PadParams(speed: 2.8, duty: 0.26)),
        PadConfig(key: "A", name: "Club Chase", mode: "loop", preset: "chase", driver: "drums", intensity: 0.92, duration: 1.2, color: [0.22, 0.82, 1], colorSecondary: [0.64, 0.32, 1], white: 0.04, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.6, width: 0.22, direction: 1)),
        PadConfig(key: "S", name: "Fire Matrix", mode: "loop", preset: "fire", driver: "bass", intensity: 0.96, duration: 1.2, color: [1, 0.36, 0.12], colorSecondary: [1, 0.78, 0.18], white: 0.1, bars: ["L3", "C3", "R3", "L2", "C2", "R2"], params: PadParams(speed: 1.5, density: 0.65)),
        PadConfig(key: "D", name: "Vocal Shimmer", mode: "loop", preset: "sparkle", driver: "vocals", intensity: 0.9, duration: 1.2, color: [0.68, 0.42, 1], colorSecondary: [0.24, 0.88, 1], white: 0.14, bars: ["L1", "C1", "R1", "C2"], params: PadParams(speed: 1.4, density: 0.55)),
        PadConfig(key: "F", name: "Spiral Vortex", mode: "loop", preset: "spiral", driver: "other", intensity: 0.92, duration: 1.2, color: [0.18, 0.94, 0.74], colorSecondary: [0.24, 0.56, 1], white: 0.05, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.4, width: 0.3, direction: 1)),
        PadConfig(key: "Z", name: "Columns EQ", mode: "loop", preset: "columns", driver: "bass", intensity: 0.94, duration: 1.2, color: [1, 0.56, 0.16], colorSecondary: [1, 0.2, 0.56], white: 0.06, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.4)),
        PadConfig(key: "X", name: "Neon Rain", mode: "loop", preset: "rain", driver: "other", intensity: 0.88, duration: 1.2, color: [0.28, 0.78, 1], colorSecondary: [0.76, 0.36, 1], white: 0.05, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.5, density: 0.5)),
        PadConfig(key: "C", name: "Bounce Wave", mode: "loop", preset: "bounce", driver: "drums", intensity: 0.92, duration: 1.2, color: [0.22, 0.95, 0.62], colorSecondary: [1, 0.76, 0.2], white: 0.06, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 1.35, width: 0.25)),
        PadConfig(key: "V", name: "Warm Amber Wash", mode: "loop", preset: "wash", driver: "vocals", intensity: 0.82, duration: 1.2, color: [1, 0.68, 0.28], colorSecondary: [1, 0.42, 0.22], white: 0.32, bars: BarID.allCases.map(\.rawValue), params: PadParams(speed: 0.8, softness: 0.8))
    ]
}

public struct RGBWPixel: Sendable, Equatable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var w: Double

    public static let zero = RGBWPixel(r: 0, g: 0, b: 0, w: 0)
}

public struct TrackSection: Codable, Identifiable, Sendable {
    public var id: String { "\(label ?? kind ?? "sec")-\(startSec)" }
    public var kind: String?
    public var label: String?
    public var startSec: Double
    public var endSec: Double?
}

public struct LibraryTrack: Codable, Identifiable, Sendable {
    public var id: String
    public var title: String?
    public var originalName: String?
    public var durationSec: Double?
    public var bpm: Double?

    public var displayTitle: String {
        title ?? originalName ?? id
    }
}
