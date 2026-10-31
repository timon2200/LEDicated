import Foundation

/// Pure 60 FPS 3×3 RGBW Bar Synthesizer combining the 30 FPS remote studio frame with 0ms local pad touch synthesis.
public enum BarSynthesizer {
    nonisolated public static func renderBars(
        now: TimeInterval,
        blackout: Bool,
        isConnected: Bool,
        isPlaying: Bool,
        bpm: Double,
        pads: [PadConfig],
        activePads: [Int: ActivePadRun],
        heldPads: [Int: HeldPadRun],
        spatialTouches: [String: SpatialTouchRun] = [:],
        liveSpread: Double = 0.0,
        lockedCols: Set<Int> = [],
        lockedRows: Set<Int> = [],
        lastLocalActionUptime: [Int: TimeInterval],
        remoteFrameBars: [BarID: [RGBWPixel]],
        lastRemoteFrameUptime: TimeInterval
    ) -> [BarID: [RGBWPixel]] {
        var result: [BarID: [RGBWPixel]] = [:]
        guard !blackout else {
            for bar in BarID.allCases {
                result[bar] = Array(repeating: RGBWPixel.zero, count: AppConfiguration.pixelsPerBar)
            }
            return result
        }

        // Keep the remote studio frame visible both during live playback and while paused/scrubbing,
        // tolerating browser background throttling or brief Wi-Fi jitter without black dropouts.
        let frameAge = now - lastRemoteFrameUptime
        let hasFreshServerFrame = isConnected && !remoteFrameBars.isEmpty && (frameAge < (isPlaying ? 2.5 : 15.0))
        let isStreamingHighRate = isConnected && !remoteFrameBars.isEmpty && (frameAge < 0.095)
        let hasActiveSpatialTouch = !spatialTouches.isEmpty
        for bar in BarID.allCases {
            if hasFreshServerFrame && !hasActiveSpatialTouch,
               let remotePx = remoteFrameBars[bar], remotePx.count == AppConfiguration.pixelsPerBar {
                result[bar] = remotePx
            } else {
                result[bar] = Array(repeating: RGBWPixel.zero, count: AppConfiguration.pixelsPerBar)
            }
        }

        // Render active pads locally using the exact 1:1 `timeline.mjs` `pattern(...)` formulas
        // whenever no high-rate server stream is active OR for instant 0ms local touch feedback
        let clampedBpm = max(40.0, min(240.0, bpm))
        let beatSec = 60.0 / clampedBpm

        for (idx, run) in activePads.sorted(by: { $0.key < $1.key }) {
            guard pads.indices.contains(idx) else { continue }
            let pad = pads[idx]
            if pad.isEmpty { continue }

            // If server is actively streaming at 30 FPS and already includes this pad (>180ms old), avoid double-adding
            if hasFreshServerFrame && isStreamingHighRate && (now - (lastLocalActionUptime[idx] ?? 0) > 0.18) {
                continue
            }

            if now < run.startedAt || now >= run.until { continue }

            let isFiniteHit = run.until.isFinite
            let isHeld = heldPads[idx] != nil
            let fadeWindow = (pad.preset == "chase" && isFiniteHit) ? 0.04 : 0.09
            let life: Double = (!isFiniteHit || isHeld || pad.preset == "strobe")
                ? 1.0
                : max(0.0, min(1.0, (run.until - now) / fadeWindow))

            let strength = max(0.0, min(1.0, pad.intensity * life))
            if strength <= 0 { continue }

            let speed = max(0.25, pad.params.speed)
            let localTime = (now - run.startedAt) * speed
            let animTimeSec = now * speed
            let oneShotChase = (pad.preset == "chase" && isFiniteHit)

            let cR = pad.color.count > 0 ? pad.color[0] : 1.0
            let cG = pad.color.count > 1 ? pad.color[1] : 1.0
            let cB = pad.color.count > 2 ? pad.color[2] : 1.0
            let cW = pad.white

            let targetBars = Set(pad.bars.isEmpty ? BarID.allRawIds : pad.bars)

            for bar in BarID.allCases where targetBars.contains(bar.rawValue) {
                guard var pixels = result[bar] else { continue }
                let row = bar.row
                let col = bar.column
                for p in 0..<AppConfiguration.pixelsPerBar {
                    let amount = strength * PatternShaders.samplePattern(
                        pad: pad,
                        row: row,
                        col: col,
                        pixel: p,
                        timeSec: animTimeSec,
                        localTime: localTime,
                        beatSec: beatSec,
                        barId: bar.rawValue,
                        oneShotChase: oneShotChase
                    )
                    if amount > 0 {
                        pixels[p].r = min(1.0, pixels[p].r + cR * amount)
                        pixels[p].g = min(1.0, pixels[p].g + cG * amount)
                        pixels[p].b = min(1.0, pixels[p].b + cB * amount)
                        pixels[p].w = min(1.0, pixels[p].w + cW * amount)
                    }
                }
                result[bar] = pixels
            }
        }

        // Render spatial 3x3 Guitar/Draw touches with velocity, locked columns/rows, and spread
        for (_, touch) in spatialTouches {
            let cR = touch.color.count > 0 ? touch.color[0] : 0.0
            let cG = touch.color.count > 1 ? touch.color[1] : 0.82
            let cB = touch.color.count > 2 ? touch.color[2] : 1.0
            let cW = touch.color.count > 3 ? touch.color[3] : 0.0
            let localTime = max(0.0, now - touch.startAt)

            for bar in BarID.allCases {
                let barGain = barGainForTouch(
                    touch: touch,
                    bar: bar,
                    now: now,
                    liveSpread: liveSpread,
                    lockedCols: lockedCols,
                    lockedRows: lockedRows
                )
                let gain = max(0.0, min(1.0, barGain * touch.intensity))
                if gain <= 0.001 { continue }
                guard var pixels = result[bar] else { continue }

                for p in 0..<AppConfiguration.pixelsPerBar {
                    let pat = sampleSpatialPanelEffect(
                        effect: touch.effect,
                        pixel: p,
                        row: bar.row,
                        col: bar.column,
                        barId: bar.rawValue,
                        timeSec: now,
                        localTime: localTime,
                        beatSec: beatSec
                    )
                    let amount = gain * pat
                    if amount > 0.001 {
                        pixels[p].r = min(1.0, pixels[p].r + cR * amount)
                        pixels[p].g = min(1.0, pixels[p].g + cG * amount)
                        pixels[p].b = min(1.0, pixels[p].b + cB * amount)
                        pixels[p].w = min(1.0, pixels[p].w + cW * amount)
                    }
                }
                result[bar] = pixels
            }
        }

        return result
    }

    nonisolated public static func barGainForTouch(
        touch: SpatialTouchRun,
        bar: BarID,
        now: TimeInterval,
        liveSpread: Double,
        lockedCols: Set<Int>,
        lockedRows: Set<Int>
    ) -> Double {
        let bCol = bar.column
        let bRow = bar.row
        let vel = max(0.15, min(1.0, touch.velocityGain))

        // 1. Direct active panel or locked column/row
        let isDirect = (bCol == touch.col && bRow == touch.row)
            || (lockedCols.contains(touch.col) && bCol == touch.col)
            || (lockedRows.contains(touch.row) && bRow == touch.row)
        var bestGain: Double = isDirect ? vel : 0.0

        // 2. Strum trail sustain across recently crossed panels
        if let hit = touch.panelHits[bar.rawValue] {
            let age = max(0.0, now - hit.lastHitAt)
            if age < 0.42 {
                let trailGain = hit.peakGain * exp(-age / 0.14)
                if trailGain > bestGain {
                    bestGain = trailGain
                }
            }
        }

        // 3. Spatial spread onto neighboring bars when SPREAD > 0
        let spread = max(0.0, min(1.0, liveSpread))
        if spread > 0.005 && bestGain < vel {
            let effColDist: Double = (lockedRows.contains(touch.row) || (lockedCols.contains(touch.col) && bCol == touch.col))
                ? 0.0
                : Double(abs(bCol - touch.col))
            let effRowDist: Double = (lockedCols.contains(touch.col) || (lockedRows.contains(touch.row) && bRow == touch.row))
                ? 0.0
                : Double(abs(bRow - touch.row))
            let gridDist = hypot(effColDist, effRowDist)
            if gridDist > 0 {
                let sigmaSq = 0.36 + spread * 2.25
                let bleed = vel * spread * exp(-(gridDist * gridDist) / sigmaSq)
                if bleed > bestGain {
                    bestGain = bleed
                }
            }
        }

        return max(0.0, min(1.0, bestGain))
    }

    nonisolated public static func sampleSpatialPanelEffect(
        effect: String,
        pixel: Int,
        row: Int,
        col: Int,
        barId: String,
        timeSec: Double,
        localTime: Double,
        beatSec: Double
    ) -> Double {
        if effect == "solid" || effect.isEmpty {
            return 1.0
        }
        let y = (Double(pixel) + 0.5) / Double(AppConfiguration.pixelsPerBar)
        let safeBeat = max(0.2, beatSec)
        switch effect {
        case "pulse":
            let phase = (localTime / safeBeat).truncatingRemainder(dividingBy: 1.0)
            return max(0.0, min(1.0, 0.2 + 0.8 * exp(-phase * 4.0)))
        case "wash":
            return max(0.0, min(1.0, 0.45 + 0.55 * (0.5 + 0.5 * sin(timeSec * 2.4 + y * .pi))))
        case "wave":
            let phase = y * 2.0 * .pi - localTime * .pi / (safeBeat * 0.5)
            return max(0.0, min(1.0, 0.15 + 0.85 * (0.5 + 0.5 * sin(phase))))
        case "sparkle":
            return PatternShaders.sampleSparkle(opts: ["density": "stars", "glint": "crisp"], row: row, col: col, pixel: pixel, timeSec: timeSec)
        case "fire":
            let flameH = max(0.15, 1.0 - y * 0.55)
            let flicker = 0.55 + 0.45 * sin(timeSec * 16.0 + Double(pixel) * 0.65) * sin(timeSec * 8.3 - Double(pixel) * 0.35)
            return max(0.0, min(1.0, flameH * flicker))
        case "rain":
            let phase = ((localTime / (safeBeat * 0.75) - y).truncatingRemainder(dividingBy: 1.0) + 1.0).truncatingRemainder(dividingBy: 1.0)
            return exp(-phase * 5.0)
        case "chase":
            let pathLen = Double(AppConfiguration.pixelsPerBar)
            let head = ((localTime / safeBeat) * pathLen).truncatingRemainder(dividingBy: pathLen)
            var d = head - Double(pixel)
            if d < -pathLen / 2.0 { d += pathLen }
            if d > pathLen / 2.0 { d -= pathLen }
            return d < 0 ? exp(-(-d) * 1.4) : exp(-d / 3.2)
        case "flash":
            let phase = (localTime / safeBeat).truncatingRemainder(dividingBy: 1.0)
            return exp(-phase * 4.5)
        case "ripple":
            let rDist = abs(y - 0.5) * 2.0
            let phase = ((localTime / safeBeat - rDist * 0.65).truncatingRemainder(dividingBy: 1.0) + 1.0).truncatingRemainder(dividingBy: 1.0)
            return exp(-phase * 4.2)
        case "bounce":
            let sweep = 0.5 + 0.44 * sin(localTime / safeBeat * .pi * 2.0)
            let dist = (y - sweep) / 0.22
            return exp(-dist * dist)
        case "sweep":
            let pos = (localTime / safeBeat).truncatingRemainder(dividingBy: 1.0) * 1.2 - 0.1
            let dist = abs(y - pos)
            return exp(-dist * dist * 18.0)
        case "spiral":
            let phase = y * 2.5 * .pi - localTime * 4.5
            return max(0.0, min(1.0, 0.12 + 0.88 * pow(0.5 + 0.5 * sin(phase), 2.0)))
        case "columns":
            let seg = min(2, pixel / 4)
            let step = Int(floor(localTime / (safeBeat * 0.5))) % 3
            return seg == step ? 1.0 : 0.08
        case "alternate":
            let isEven = (pixel / 3) % 2 == 0
            let step = Int(floor(localTime / (safeBeat * 0.5))) % 2 == 0
            return (isEven == step) ? 1.0 : 0.08
        case "center":
            let dist = abs(y - 0.5) * 2.0
            let pulse = 0.35 + 0.65 * (0.5 + 0.5 * sin(timeSec * 4.0))
            return max(0.0, min(1.0, (1.0 - dist * 0.85) * pulse))
        case "strobe":
            return PatternShaders.sampleStrobe(opts: ["rate": "1/8", "duty": "sharp", "pattern": "all"], row: row, col: col, speed: 1.0, localTime: localTime, beatSec: safeBeat)
        default:
            return 1.0
        }
    }
}
