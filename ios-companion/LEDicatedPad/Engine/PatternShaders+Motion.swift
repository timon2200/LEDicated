import Foundation

public extension PatternShaders {
    nonisolated internal static func sampleChase(
        pad: PadConfig,
        opts: [String: String],
        pixel: Int,
        localTime: Double,
        stepSec: Double,
        barId: String,
        oneShotChase: Bool
    ) -> Double {
        let pixelsPerBar = 12.0
        let allBarIds = BarID.allRawIds
        let pathMode = opts["pathMode"] ?? "skip"
        let targetSet = Set(pad.bars.isEmpty ? allBarIds : pad.bars)
        let activeBars = (pad.bars.count == 9 || pad.bars.isEmpty || pathMode == "keep")
            ? allBarIds
            : allBarIds.filter { targetSet.contains($0) }
        if activeBars.isEmpty { return 0 }

        let targetList = allBarIds.filter { targetSet.contains($0) }
        let hasLeft = targetList.contains { $0.hasPrefix("L") }
        let hasRight = targetList.contains { $0.hasPrefix("R") }
        let hasCenter = targetList.contains { $0.hasPrefix("C") }
        let activeColCount = Set(targetList.map { String($0.prefix(1)) }).count
        let hasMultipleRows = Set(targetList.map { String($0.suffix(1)) }).count > 1
        let isDualFlank = hasLeft && hasRight && !hasCenter && hasMultipleRows
        let isSingleColumn = activeColCount == 1 && hasMultipleRows

        var dir = pad.direction
        if isSingleColumn && (dir == "ltr" || dir == "rtl") {
            dir = dir == "rtl" ? "btt" : "ttb"
        }
        let verticalGapPx = 5.8
        var position = 0.0
        var pathLen = 0.0

        if isDualFlank {
            let isRev = dir == "btt" || dir == "rtl"
            let isLeft = barId.hasPrefix("L")
            let isRight = barId.hasPrefix("R")
            if !isLeft && !isRight { return 0 }
            let sideOrder = isLeft
                ? (isRev ? ["L3", "L2", "L1"] : ["L1", "L2", "L3"])
                : (isRev ? ["R3", "R2", "R1"] : ["R1", "R2", "R3"])
            let sideBars = sideOrder.filter { activeBars.contains($0) }
            guard let idx = sideBars.firstIndex(of: barId) else { return 0 }
            let n = Double(sideBars.count)
            let gap = n > 1 ? verticalGapPx : 0.0
            let endFlyout = gap > 0 ? min(3.4, gap * 0.6) : 0.0
            let px = isRev ? Double(11 - pixel) : Double(pixel)
            position = Double(idx) * (pixelsPerBar + gap) + px
            pathLen = n * pixelsPerBar + max(0, n - 1) * gap + endFlyout
        } else {
            let order: [String]
            let revPixel: Bool
            switch dir {
            case "rtl":
                order = ["R1", "C1", "L1", "R2", "C2", "L2", "R3", "C3", "L3"]
                revPixel = true
            case "ttb":
                order = ["L1", "L2", "L3", "C1", "C2", "C3", "R1", "R2", "R3"]
                revPixel = false
            case "btt":
                order = ["L3", "L2", "L1", "C3", "C2", "C1", "R3", "R2", "R1"]
                revPixel = true
            default:
                order = ["L1", "C1", "R1", "L2", "C2", "R2", "L3", "C3", "R3"]
                revPixel = false
            }
            let pathBars = order.filter { activeBars.contains($0) }
            guard let idx = pathBars.firstIndex(of: barId) else { return 0 }
            let n = Double(pathBars.count)
            let px = revPixel ? Double(11 - pixel) : Double(pixel)
            position = Double(idx) * pixelsPerBar + px
            pathLen = n * pixelsPerBar
        }

        if pathLen <= 0 { return 0 }
        let head = oneShotChase
            ? (localTime / stepSec) * pathLen
            : ((localTime / stepSec) * pathLen).truncatingRemainder(dividingBy: pathLen)
        var d = head - position
        if !oneShotChase {
            if d < -pathLen / 2.0 { d += pathLen }
            if d > pathLen / 2.0 { d -= pathLen }
        }

        let beam = opts["beam"] ?? "beam"
        let tail: Double = {
            switch beam {
            case "needle": return 1.0
            case "razor": return 2.2
            case "beam": return 4.2
            case "comet": return 7.5
            default: return 4.2
            }
        }()
        let glow = pad.params.glow ?? 0.0
        let baseGlow = glow * 0.15
        let lead = min(1.6, max(0.75, tail * 0.34))
        let maxLead = lead * 2.1
        let maxTail = tail * 3.1
        if d < -maxLead || d > maxTail { return baseGlow }

        let beamVal: Double
        if d < 0 {
            let u = -d / lead
            let taper = 1.0 - (-d / maxLead)
            beamVal = exp(-u * u * 1.15) * taper
        } else {
            let taper = 1.0 - pow(d / maxTail, 2.2)
            beamVal = exp(-d / tail) * max(0.0, taper)
        }
        return max(0.0, min(1.0, baseGlow + (1.0 - baseGlow) * beamVal))
    }

    nonisolated internal static func sampleWave(
        opts: [String: String],
        row: Int,
        col: Int,
        y: Double,
        timeSec: Double,
        beatSec: Double
    ) -> Double {
        let shape = opts["shape"] ?? "sine"
        let angle = opts["angle"] ?? "diag"
        let density = opts["density"] ?? "med"
        let freqMult: Double = density == "low" ? 0.5 : (density == "high" ? 2.5 : 1.0)
        let physY = Double(row) * 1.4833 + y
        let spatialPos: Double = {
            if angle == "horiz" { return Double(col) * 1.3 + y * 0.15 }
            if angle == "vert" { return physY }
            return Double(col) + physY * 0.45
        }()
        let phase = spatialPos * freqMult * .pi - timeSec * .pi / beatSec
        let w: Double
        if shape == "triangle" {
            let norm = ((phase / .pi).truncatingRemainder(dividingBy: 2.0) + 2.0).truncatingRemainder(dividingBy: 2.0)
            w = abs(norm - 1.0)
        } else if shape == "saw" {
            w = ((phase / (2.0 * .pi)).truncatingRemainder(dividingBy: 1.0) + 1.0).truncatingRemainder(dividingBy: 1.0)
        } else {
            w = 0.5 + 0.5 * sin(phase)
        }
        return max(0.0, min(1.0, 0.15 + 0.85 * w))
    }

    nonisolated internal static func sampleSpiral(
        pad: PadConfig,
        opts: [String: String],
        row: Int,
        col: Int,
        timeSec: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        let dir = opts["direction"] ?? "cw"
        let tailMode = opts["tail"] ?? "med"
        let centerMode = opts["center"] ?? "pulse"
        let perimeterGrid = [
            [0, 1, 2],
            [7, -1, 3],
            [6, 5, 4]
        ]
        let perimeterIndex = perimeterGrid[row][col]
        if perimeterIndex == -1 {
            if centerMode == "off" { return 0.0 }
            if centerMode == "on" { return 1.0 }
            return max(0.0, min(1.0, 0.2 + 0.6 * (0.5 + 0.5 * sin(timeSec * 3.0))))
        }
        let order = dir == "ccw" ? [0, 7, 6, 5, 4, 3, 2, 1] : [0, 1, 2, 3, 4, 5, 6, 7]
        let idAtPerimeter = BarID.outerPerimeterIds
        let pathMode = opts["pathMode"] ?? "keep"
        let targetSet = Set(pad.bars.isEmpty ? BarID.allRawIds : pad.bars)
        let path = (pathMode == "skip" && pad.bars.count < 9 && !pad.bars.isEmpty)
            ? order.filter { targetSet.contains(idAtPerimeter[$0]) }
            : order
        if path.isEmpty { return 0.0 }
        guard let pIdx = path.firstIndex(of: perimeterIndex) else { return 0.0 }
        let pathCount = Double(path.count)
        let head = (localTime / beatSec * 2.0).truncatingRemainder(dividingBy: pathCount)
        let dist = (head - Double(pIdx) + pathCount).truncatingRemainder(dividingBy: pathCount)
        let tailSpread: Double = tailMode == "point" ? 1.0 : (tailMode == "snake" ? 6.0 : 3.0)
        return max(0.0, min(1.0, 0.08 + 0.92 * exp(-dist * dist / tailSpread)))
    }

    nonisolated internal static func sampleRipple(
        opts: [String: String],
        row: Int,
        col: Int,
        y: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        let origin = opts["origin"] ?? "center"
        let dir = opts["direction"] ?? "out"
        let width = opts["width"] ?? "sharp"
        var oCol = 1.0, oRow = 1.0
        if origin == "top" { oCol = 1.0; oRow = 0.0 }
        else if origin == "bottom" { oCol = 1.0; oRow = 2.0 }
        else if origin == "corners" { oCol = col == 0 ? 0.0 : 2.0; oRow = row == 0 ? 0.0 : 2.0 }
        let rDist = hypot(Double(col) - oCol, (Double(row) - oRow) * 1.1) + abs(y - 0.5) * 0.4
        let signedDist = (dir == "in" ? -rDist : rDist)
        var rPhase = (localTime / (beatSec * 2.0) - signedDist * 0.38).truncatingRemainder(dividingBy: 1.0)
        rPhase = (rPhase + 1.0).truncatingRemainder(dividingBy: 1.0)
        let decayPower: Double = width == "wide" ? 2.5 : 4.5
        return exp(-rPhase * decayPower)
    }

    nonisolated internal static func sampleRain(
        opts: [String: String],
        row: Int,
        col: Int,
        y: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        let streak = opts["streak"] ?? "streak"
        let spread = opts["spread"] ?? "random"
        let colShift = spread == "sync" ? 0.0 : (Double(col) * 0.28)
        let vert = Double(row) * 1.4833 + y
        let phase = ((localTime / (beatSec * 1.5) - vert * 0.26 + colShift).truncatingRemainder(dividingBy: 1.0) + 1.0).truncatingRemainder(dividingBy: 1.0)
        let dropPower: Double = streak == "drops" ? 9.0 : (streak == "beam" ? 2.5 : 5.0)
        return exp(-phase * dropPower)
    }

    nonisolated internal static func sampleBounce(opts: [String: String], row: Int, col: Int, localTime: Double, beatSec: Double) -> Double {
        let axis = opts["axis"] ?? "horiz"
        let curve = opts["curve"] ?? "pendulum"
        let rawPos = (localTime / beatSec).truncatingRemainder(dividingBy: 2.0)
        let sweep: Double
        if curve == "elastic" {
            sweep = 1.0 + (rawPos < 1.0 ? (rawPos * 2.0 - 1.0) : (3.0 - rawPos * 2.0))
        } else {
            sweep = 1.0 + sin(localTime / beatSec * .pi)
        }
        let targetPos = Double(axis == "vert" ? row : col)
        return exp(-pow(targetPos - sweep, 2.0) * 3.0)
    }

    nonisolated internal static func sampleFire(
        opts: [String: String],
        row: Int,
        col: Int,
        pixel: Int,
        y: Double,
        timeSec: Double
    ) -> Double {
        let height = opts["height"] ?? "mid"
        let turbulence = opts["turbulence"] ?? "normal"
        let hLimit: Double = height == "low" ? 1.8 : (height == "full" ? 3.4 : 2.6)
        let flameH = max(0.0, (hLimit - (Double(row) + y * 0.8)) / hLimit)
        let tMult: Double = turbulence == "calm" ? 0.6 : (turbulence == "storm" ? 2.2 : 1.0)
        let flicker = 0.65 + 0.35 * sin(timeSec * 16.0 * tMult + Double(col) * 3.7 + Double(pixel) * 0.4) * sin(timeSec * 8.3 * tMult - Double(row) * 1.9)
        return max(0.0, min(1.0, flameH * flicker))
    }

    nonisolated internal static func sampleSweep(
        opts: [String: String],
        row: Int,
        col: Int,
        y: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        let style = opts["style"] ?? "horiz"
        let width = opts["width"] ?? "laser"
        let beamExp: Double = width == "fan" ? 2.5 : 10.0
        let bDist: Double
        if style == "vert" {
            let beamPos = (localTime / (beatSec * 2.0)).truncatingRemainder(dividingBy: 1.0) * 3.2 - 0.1
            bDist = abs(Double(row) + y - beamPos)
        } else if style == "radar" {
            let angle = (localTime / (beatSec * 2.0)).truncatingRemainder(dividingBy: 1.0) * .pi * 2.0
            let cellAngle = atan2(Double(row - 1), Double(col - 1)) + .pi
            var diff = abs(angle - cellAngle)
            if diff > .pi { diff = 2.0 * .pi - diff }
            bDist = diff * 1.5
        } else {
            let beamPos = (localTime / (beatSec * 2.0)).truncatingRemainder(dividingBy: 1.0) * 3.4 - 0.2
            bDist = abs((Double(col) + Double(row) * 0.3 + y * 0.2) - beamPos)
        }
        return exp(-bDist * bDist * beamExp)
    }
}
