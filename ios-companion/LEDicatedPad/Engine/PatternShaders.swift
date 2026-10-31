import Foundation

/// Pure, stateless 1:1 port of `pattern(preset, row, col, pixel, timeSec, localTime, beatSec, clip, barId)` from `timeline.mjs`.
public enum PatternShaders {
    nonisolated public static func samplePattern(
        pad: PadConfig,
        row: Int,
        col: Int,
        pixel: Int,
        timeSec: Double,
        localTime: Double,
        beatSec: Double,
        barId: String,
        oneShotChase: Bool
    ) -> Double {
        let pixelsPerBar = 12.0
        let y = (Double(pixel) + 0.5) / pixelsPerBar
        let speed = max(0.25, pad.params.speed)
        let intervalBeats: Double = {
            switch pad.timing {
            case "half": return 0.5
            case "bar": return 4.0
            case "2bar": return 8.0
            case "4bar": return 16.0
            default: return 1.0
            }
        }()
        let stepSec = max(0.04, beatSec * intervalBeats)
        let opts = pad.params.stringOptions

        switch pad.preset {
        case "wash":
            return sampleWash(opts: opts, col: col, y: y, timeSec: timeSec)
        case "pulse":
            return samplePulse(pad: pad, opts: opts, localTime: localTime, stepSec: stepSec)
        case "columns":
            return sampleColumns(pad: pad, opts: opts, row: row, col: col, localTime: localTime, stepSec: stepSec)
        case "chase":
            return sampleChase(
                pad: pad,
                opts: opts,
                pixel: pixel,
                localTime: localTime,
                stepSec: stepSec,
                barId: barId,
                oneShotChase: oneShotChase
            )
        case "flash":
            return sampleFlash(opts: opts, row: row, col: col, localTime: localTime, stepSec: stepSec)
        case "wave":
            return sampleWave(opts: opts, row: row, col: col, y: y, timeSec: timeSec, beatSec: beatSec)
        case "strobe":
            return sampleStrobe(opts: opts, row: row, col: col, speed: speed, localTime: localTime, beatSec: beatSec)
        case "sparkle":
            return sampleSparkle(opts: opts, row: row, col: col, pixel: pixel, timeSec: timeSec)
        case "spiral":
            return sampleSpiral(pad: pad, opts: opts, row: row, col: col, timeSec: timeSec, localTime: localTime, beatSec: beatSec)
        case "ripple":
            return sampleRipple(opts: opts, row: row, col: col, y: y, localTime: localTime, beatSec: beatSec)
        case "rain":
            return sampleRain(opts: opts, row: row, col: col, y: y, localTime: localTime, beatSec: beatSec)
        case "bounce":
            return sampleBounce(opts: opts, row: row, col: col, localTime: localTime, beatSec: beatSec)
        case "fire":
            return sampleFire(opts: opts, row: row, col: col, pixel: pixel, y: y, timeSec: timeSec)
        case "alternate":
            return sampleAlternate(opts: opts, row: row, col: col, localTime: localTime, stepSec: stepSec)
        case "center":
            return sampleCenter(opts: opts, row: row, col: col, timeSec: timeSec)
        case "sweep":
            return sampleSweep(opts: opts, row: row, col: col, y: y, localTime: localTime, beatSec: beatSec)
        default:
            return 0.0
        }
    }

    nonisolated internal static func sampleWash(opts: [String: String], col: Int, y: Double, timeSec: Double) -> Double {
        let mood = opts["mood"] ?? "drift"
        if mood == "breath" {
            return 0.3 + 0.5 * (0.5 + 0.5 * sin(timeSec * 2.0))
        }
        if mood == "still" {
            return 0.5 + 0.2 * (1.0 - abs(Double(col - 1)) * 0.4)
        }
        return 0.45 + 0.13 * sin(timeSec * 1.3 + Double(col) + y)
    }

    nonisolated internal static func samplePulse(pad: PadConfig, opts: [String: String], localTime: Double, stepSec: Double) -> Double {
        let curve = opts["curve"] ?? "punch"
        let floorVal = pad.params.floor ?? 0.2
        let phase = (localTime / stepSec).truncatingRemainder(dividingBy: 1.0)
        let val: Double
        if curve == "breath" {
            val = 0.5 + 0.5 * cos(phase * 2.0 * .pi)
        } else if curve == "swell" {
            val = exp((phase - 1.0) * 3.5)
        } else {
            val = exp(-phase * 4.0)
        }
        return max(0.0, min(1.0, floorVal + (1.0 - floorVal) * val))
    }

    nonisolated internal static func sampleColumns(
        pad: PadConfig,
        opts: [String: String],
        row: Int,
        col: Int,
        localTime: Double,
        stepSec: Double
    ) -> Double {
        let allBarIds = BarID.allRawIds
        let pathMode = opts["pathMode"] ?? "skip"
        let targetSet = Set(pad.bars.isEmpty ? allBarIds : pad.bars)
        let activeBars = (pad.bars.count == 9 || pad.bars.isEmpty || pathMode == "keep")
            ? allBarIds
            : allBarIds.filter { targetSet.contains($0) }
        let dir = pad.direction
        let mode = opts["mode"] ?? "single"

        if dir == "ttb" || dir == "btt" {
            var rowsSet = Set<Int>()
            for id in activeBars {
                if id.hasSuffix("1") { rowsSet.insert(0) }
                else if id.hasSuffix("2") { rowsSet.insert(1) }
                else { rowsSet.insert(2) }
            }
            var activeRows = rowsSet.sorted()
            if activeRows.isEmpty { activeRows = [0, 1, 2] }
            if dir == "btt" { activeRows.reverse() }
            let stepIndex = Int(floor(localTime / stepSec)) % activeRows.count
            let curRow = activeRows[max(0, stepIndex)]
            if mode == "invert" { return row != curRow ? 1.0 : 0.05 }
            if mode == "double" {
                let nextRow = activeRows[(max(0, stepIndex) + 1) % activeRows.count]
                return (row == curRow || row == nextRow) ? 1.0 : 0.05
            }
            return row == curRow ? 1.0 : 0.05
        } else {
            var colsSet = Set<Int>()
            for id in activeBars {
                if id.hasPrefix("L") { colsSet.insert(0) }
                else if id.hasPrefix("C") { colsSet.insert(1) }
                else { colsSet.insert(2) }
            }
            var activeCols = colsSet.sorted()
            if activeCols.isEmpty { activeCols = [0, 1, 2] }
            if dir == "rtl" { activeCols.reverse() }
            let stepIndex = Int(floor(localTime / stepSec)) % activeCols.count
            let curCol = activeCols[max(0, stepIndex)]
            if mode == "invert" { return col != curCol ? 1.0 : 0.05 }
            if mode == "double" {
                let nextCol = activeCols[(max(0, stepIndex) + 1) % activeCols.count]
                return (col == curCol || col == nextCol) ? 1.0 : 0.05
            }
            return col == curCol ? 1.0 : 0.05
        }
    }

    nonisolated internal static func sampleFlash(opts: [String: String], row: Int, col: Int, localTime: Double, stepSec: Double) -> Double {
        let focus = opts["focus"] ?? "center"
        let decay = opts["decay"] ?? "fast"
        let decayMult: Double = decay == "instant" ? 8.0 : (decay == "slow" ? 2.0 : 4.0)
        let env = exp(-((localTime / stepSec).truncatingRemainder(dividingBy: 1.0)) * decayMult)
        if focus == "all" { return env }
        if focus == "edges" { return env * (abs(Double(col - 1)) / 1.5 + abs(Double(row - 1)) * 0.3) }
        return (0.35 + 0.65 * (1.0 - abs(Double(col - 1)) / 2.0)) * env
    }

    nonisolated internal static func sampleStrobe(
        opts: [String: String],
        row: Int,
        col: Int,
        speed: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        let rate = opts["rate"] ?? "1/8"
        let duty = opts["duty"] ?? "sharp"
        let pat = opts["pattern"] ?? "all"
        let div: Double = {
            switch rate {
            case "1/2": return 2.0
            case "1/8": return 8.0
            case "1/16": return 16.0
            case "1/32": return 32.0
            default: return 4.0
            }
        }()
        var dutyCut: Double = (duty == "sharp" || duty == "razor") ? 0.16 : (duty == "wide" ? 0.55 : 0.35)
        let periodSec = beatSec / div
        let effPeriodSec = speed > 0 ? (periodSec / speed) : periodSec
        if effPeriodSec > 0 {
            let minDuty = min(0.85, 0.025 / effPeriodSec)
            if dutyCut < minDuty { dutyCut = minDuty }
        }
        let offset: Double = {
            if pat == "checker" { return ((row + col) % 2 == 0) ? 0.0 : 0.5 }
            if pat == "chaos" { return Double((row * 7 + col * 13) % 10) / 10.0 }
            return 0.0
        }()
        let phase = ((localTime / (beatSec / div) + offset).truncatingRemainder(dividingBy: 1.0) + 1.0).truncatingRemainder(dividingBy: 1.0)
        return phase < dutyCut ? 1.0 : 0.0
    }

    nonisolated internal static func sampleSparkle(opts: [String: String], row: Int, col: Int, pixel: Int, timeSec: Double) -> Double {
        let density = opts["density"] ?? "stars"
        let glint = opts["glint"] ?? "crisp"
        let s1 = sin(Double(row * 7 + col * 13 + pixel * 31) * 83.0 + timeSec * 9.0)
        let s2 = cos(Double(row * 11 + col * 5 + pixel * 17) * 47.0 - timeSec * 7.0)
        let raw = max(0.0, s1 * s2)
        let thresh: Double = density == "firefly" ? 0.55 : (density == "glitter" ? 0.05 : 0.25)
        if raw < thresh { return 0.0 }
        let power: Double = glint == "soft" ? 1.8 : 3.5
        return max(0.0, min(1.0, pow((raw - thresh) / max(0.001, 1.0 - thresh), power)))
    }

    nonisolated internal static func sampleAlternate(opts: [String: String], row: Int, col: Int, localTime: Double, stepSec: Double) -> Double {
        let pat = opts["pattern"] ?? "checker"
        let trans = opts["transition"] ?? "cut"
        let isEven: Bool = {
            switch pat {
            case "rows": return row % 2 == 0
            case "cols": return col % 2 == 0
            case "cross": return (row == 1 || col == 1)
            default: return (row + col) % 2 == 0
            }
        }()
        let progress = localTime / stepSec
        let stepIndex = Int(floor(progress))
        let on = (isEven == (stepIndex % 2 == 0))
        if trans == "fade" {
            let frac = progress.truncatingRemainder(dividingBy: 1.0)
            let wave = 0.5 + 0.5 * cos(frac * .pi)
            return on ? (0.1 + 0.9 * wave) : (0.1 + 0.9 * (1.0 - wave))
        }
        return on ? 1.0 : 0.08
    }

    nonisolated internal static func sampleCenter(opts: [String: String], row: Int, col: Int, timeSec: Double) -> Double {
        let mode = opts["geometry"] ?? "cross"
        let breathe = opts["breathe"] ?? "off"
        let pulseVal = (breathe == "on") ? max(0.0, min(1.0, 0.2 + 0.8 * (0.5 + 0.5 * sin(timeSec * 3.0)))) : 1.0
        if row == 1 && col == 1 { return pulseVal }
        if mode == "cross" && (row == 1 || col == 1) { return max(0.0, min(1.0, pulseVal * 0.65)) }
        if mode == "iris" {
            let d = hypot(Double(col - 1), Double(row - 1))
            return max(0.0, min(1.0, pulseVal * (1.0 - d / 2.0)))
        }
        return max(0.0, min(1.0, 0.12 + 0.15 * (0.5 + 0.5 * sin(timeSec * 2.0 + Double(row + col)))))
    }
}
