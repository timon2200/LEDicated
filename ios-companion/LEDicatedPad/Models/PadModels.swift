import Foundation
import SwiftUI

public enum PadMode: String, CaseIterable, Codable, Sendable {
    case hit
    case loop

    public var title: String {
        switch self {
        case .hit: return "HIT (Udar)"
        case .loop: return "LOOP (Petlja)"
        }
    }
}

public enum SpatialTouchEffect: String, CaseIterable, Codable, Identifiable, Sendable {
    case solid
    case pulse, wash, wave, sparkle, fire, rain, chase, flash
    case ripple, bounce, sweep, spiral, columns, alternate, center, strobe

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .solid: return "Svijetli (Panel)"
        case .pulse: return "Puls"
        case .wash: return "Preljev"
        case .wave: return "Val"
        case .sparkle: return "Iskre"
        case .fire: return "Vatra"
        case .rain: return "Kiša"
        case .chase: return "Potjera"
        case .flash: return "Bljesak"
        case .ripple: return "Valovi"
        case .bounce: return "Odskok"
        case .sweep: return "Prelet"
        case .spiral: return "Spirala"
        case .columns: return "Stupci"
        case .alternate: return "Izmjena"
        case .center: return "Centar"
        case .strobe: return "Strobo"
        }
    }

    public var sfSymbol: String {
        switch self {
        case .solid: return "lightbulb.max.fill"
        case .pulse: return "waveform.path.ecg"
        case .wash: return "paintbrush.pointed.fill"
        case .wave: return "waveform"
        case .sparkle: return "sparkles"
        case .fire: return "flame.fill"
        case .rain: return "cloud.rain.fill"
        case .chase: return "arrow.right.to.line.compact"
        case .flash: return "sun.max.fill"
        case .ripple: return "dot.radiowaves.left.and.right"
        case .bounce: return "arrow.up.and.down.circle.fill"
        case .sweep: return "water.waves"
        case .spiral: return "hurricane"
        case .columns: return "chart.bar.fill"
        case .alternate: return "arrow.left.arrow.right.circle.fill"
        case .center: return "scope"
        case .strobe: return "bolt.fill"
        }
    }
}

public enum EffectPreset: String, CaseIterable, Codable, Identifiable, Sendable {
    case pulse, chase, sweep, strobe, flash, wash, sparkle, wave
    case ripple, rain, spiral, fire, columns, bounce, alternate, center

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .pulse: return "Puls"
        case .chase: return "Potjera"
        case .sweep: return "Prelet"
        case .strobe: return "Strobo"
        case .flash: return "Bljesak"
        case .wash: return "Preljev"
        case .sparkle: return "Iskre"
        case .wave: return "Val"
        case .ripple: return "Valovi"
        case .rain: return "Kiša"
        case .spiral: return "Spirala"
        case .fire: return "Vatra"
        case .columns: return "Stupci"
        case .bounce: return "Odskok"
        case .alternate: return "Izmjena"
        case .center: return "Centar"
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
        case .alternate: return "arrow.left.arrow.right.circle.fill"
        case .center: return "scope"
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

    public var icon: String {
        switch self {
        case .none: return "hand.tap.fill"
        case .drums: return "waveform.badge.exclamationmark"
        case .bass: return "speaker.wave.3.fill"
        case .vocals: return "mic.fill"
        case .other: return "pianokeys"
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
    public var floor: Double?
    public var glow: Double?
    public var stringOptions: [String: String]

    public init(
        speed: Double = 1.0,
        width: Double? = nil,
        direction: Double? = nil,
        softness: Double? = nil,
        duty: Double? = nil,
        decay: Double? = nil,
        density: Double? = nil,
        floor: Double? = nil,
        glow: Double? = nil,
        stringOptions: [String: String] = [:]
    ) {
        self.speed = speed
        self.width = width
        self.direction = direction
        self.softness = softness
        self.duty = duty
        self.decay = decay
        self.density = density
        self.floor = floor
        self.glow = glow
        self.stringOptions = stringOptions
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
    public var direction: String
    public var timing: String
    public var motionMode: String
    public var hitTravel: String
    public var hitBeats: Double
    public var isEmpty: Bool

    public var id: String { key }

    public init(
        key: String,
        name: String,
        mode: String,
        preset: String,
        driver: String,
        intensity: Double,
        duration: Double,
        color: [Double],
        colorSecondary: [Double]? = nil,
        white: Double,
        bars: [String],
        params: PadParams = PadParams(),
        direction: String = "ltr",
        timing: String = "beat",
        motionMode: String = "serial",
        hitTravel: String = "full",
        hitBeats: Double = 0.5,
        isEmpty: Bool = false
    ) {
        self.key = key
        self.name = name
        self.mode = mode
        self.preset = preset
        self.driver = driver
        self.intensity = intensity
        self.duration = duration
        self.color = color
        self.colorSecondary = colorSecondary
        self.white = white
        self.bars = bars
        self.params = params
        self.direction = direction
        self.timing = timing
        self.motionMode = motionMode
        self.hitTravel = hitTravel
        self.hitBeats = hitBeats
        self.isEmpty = isEmpty
    }

    public static func emptySlot(index: Int) -> PadConfig {
        let k = index < padKeys.count ? padKeys[index] : "P\(index + 1)"
        return PadConfig(
            key: k,
            name: "Prazno",
            mode: "hit",
            preset: "flash",
            driver: "none",
            intensity: 0.9,
            duration: 0.5,
            color: [0.35, 0.45, 0.58],
            colorSecondary: nil,
            white: 0.0,
            bars: BarID.allRawIds,
            params: PadParams(speed: 1.0),
            isEmpty: true
        )
    }

    public var swiftUIColor: Color {
        if isEmpty {
            return Color(red: 0.35, green: 0.45, blue: 0.58)
        }
        guard color.count >= 3 else { return .cyan }
        let r = max(0, min(1, color[0]))
        let g = max(0, min(1, color[1]))
        let b = max(0, min(1, color[2]))
        if r + g + b < 0.12 && white > 0.05 {
            return Color(red: 1.0, green: 0.84, blue: 0.55)
        }
        if white > 0.25 && (r > 0.9 && g > 0.9 && b > 0.9) {
            return Color(red: 1.0, green: 0.94, blue: 0.84)
        }
        return Color(red: r, green: g, blue: b)
    }

    public var swiftUISecondaryColor: Color {
        if isEmpty {
            return Color(red: 0.22, green: 0.28, blue: 0.38)
        }
        if let sec = colorSecondary, sec.count >= 3 {
            return Color(red: max(0, min(1, sec[0])), green: max(0, min(1, sec[1])), blue: max(0, min(1, sec[2])))
        }
        if white > 0.2 {
            return Color(red: 1.0, green: 0.84, blue: 0.52).opacity(0.85)
        }
        return swiftUIColor.opacity(0.78)
    }

    public var isLoop: Bool {
        !isEmpty && mode == "loop"
    }

    /// Exact 1:1 port of `hitDuration(pad, bpm)` from `live-performance-state.mjs`
    public func hitDuration(bpm: Double) -> Double {
        let clampedBpm = max(40.0, min(240.0, bpm))
        let beatSec = 60.0 / clampedBpm
        let timingMult: Double = {
            switch timing {
            case "half": return 0.5
            case "bar": return 4.0
            case "2bar": return 8.0
            case "4bar": return 16.0
            default: return 1.0
            }
        }()
        let travelMult: Double = {
            switch hitTravel {
            case "quarter": return 0.25
            case "half": return 0.5
            default: return 1.0
            }
        }()
        let spd = max(0.25, params.speed)
        if preset == "chase" {
            return max(0.08, beatSec * timingMult * travelMult / spd)
        }
        if preset == "spiral" {
            let pathMode = params.stringOptions["pathMode"] ?? "keep"
            let steps: Int
            if pathMode == "skip" && bars.count < 9 && !bars.isEmpty {
                let targetSet = Set(bars)
                steps = BarID.outerPerimeterIds.filter { targetSet.contains($0) }.count
            } else {
                steps = 8
            }
            return max(0.08, beatSec * Double(max(1, steps)) / 2.0 * travelMult / spd)
        }
        return max(0.08, beatSec * max(0.125, hitBeats))
    }

    public static let defaultPads: [PadConfig] = [
        PadConfig(key: "Q", name: "Bljesak", mode: "hit", preset: "flash", driver: "none", intensity: 1.0, duration: 0.5, color: [1, 1, 1], white: 1.0, bars: ["L1", "R1", "L3", "R3"], params: PadParams(speed: 0.95, stringOptions: ["focus": "center", "decay": "fast"])),
        PadConfig(key: "W", name: "Potjera", mode: "hit", preset: "chase", driver: "none", intensity: 1.0, duration: 0.5, color: [1, 0, 0], white: 1.0, bars: ["L1", "L2", "L3", "R1", "R2", "R3"], params: PadParams(speed: 0.51, glow: 0, stringOptions: ["beam": "beam", "pathMode": "skip"])),
        PadConfig(key: "E", name: "Puls", mode: "loop", preset: "pulse", driver: "none", intensity: 1.0, duration: 0.5, color: [0.18, 0.35, 1], white: 0.0, bars: BarID.allRawIds, params: PadParams(speed: 1.0, floor: 0.2, stringOptions: ["curve": "punch"])),
        PadConfig(key: "R", name: "Strobo", mode: "hit", preset: "strobe", driver: "none", intensity: 1.0, duration: 0.5, color: [1, 1, 1], white: 1.0, bars: BarID.allRawIds, params: PadParams(speed: 1.0, stringOptions: ["rate": "1/8", "duty": "sharp", "pattern": "all"])),
        PadConfig(key: "A", name: "Preljev", mode: "hit", preset: "wash", driver: "none", intensity: 0.55, duration: 0.5, color: [0.12, 0.35, 1], white: 0.0, bars: BarID.allRawIds, params: PadParams(speed: 1.0, stringOptions: ["mood": "drift"])),
        PadConfig(key: "S", name: "Spirala", mode: "loop", preset: "spiral", driver: "none", intensity: 0.7, duration: 0.5, color: [0.75, 0.18, 1], white: 0.0, bars: BarID.allRawIds, params: PadParams(speed: 1.0, stringOptions: ["direction": "cw", "tail": "med", "center": "pulse", "pathMode": "keep"])),
        PadConfig(key: "D", name: "Potjera", mode: "hit", preset: "chase", driver: "none", intensity: 0.74, duration: 0.5, color: [1, 1, 1], white: 0.1, bars: ["L1", "R1", "L2", "R2", "L3", "R3"], params: PadParams(speed: 1.07, glow: 0, stringOptions: ["beam": "beam", "pathMode": "skip"]), timing: "half", hitTravel: "half"),
        PadConfig(key: "F", name: "Odskok", mode: "loop", preset: "bounce", driver: "none", intensity: 1.0, duration: 0.5, color: [0.45, 0.79, 1], white: 1.0, bars: ["L1", "R1", "L2", "R2", "L3", "R3"], params: PadParams(speed: 0.47, stringOptions: ["axis": "vert", "curve": "elastic"])),
        PadConfig(key: "Z", name: "Stupci", mode: "hit", preset: "columns", driver: "none", intensity: 0.9, duration: 0.5, color: [1, 0.7, 0.3], white: 0.5, bars: BarID.allRawIds, params: PadParams(speed: 1.0, stringOptions: ["mode": "single", "pathMode": "skip"])),
        PadConfig(key: "X", name: "Izmjena", mode: "hit", preset: "alternate", driver: "none", intensity: 0.7, duration: 0.5, color: [1, 0.79, 0.52], white: 0.5, bars: BarID.allRawIds, params: PadParams(speed: 1.0, stringOptions: ["pattern": "checker", "transition": "cut"])),
        PadConfig(key: "C", name: "Valovi", mode: "hit", preset: "ripple", driver: "none", intensity: 0.9, duration: 0.5, color: [1, 0.7, 0.3], white: 0.24, bars: BarID.allRawIds, params: PadParams(speed: 0.38, stringOptions: ["origin": "bottom", "direction": "out", "width": "sharp"])),
        PadConfig.emptySlot(index: 11)
    ]
}
