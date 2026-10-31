import Foundation

@MainActor
public extension StudioClient {
    // MARK: - Exact 1:1 Pad Trigger & Release State Machine (`live-performance-state.mjs` port)

    func pressPad(_ index: Int) {
        guard pads.indices.contains(index) else { return }
        selectedPadIndex = index
        let pad = pads[index]
        guard !pad.isEmpty else { return }

        HapticsEngine.shared.padHit(intensity: pad.intensity, isLoop: pad.isLoop)
        if inspectorOnTapMode { return }

        let now = ProcessInfo.processInfo.systemUptime
        lastLocalActionUptime[index] = now

        if heldPads[index] != nil { return }
        let wasActive = activePads[index] != nil || queuedPads[index] != nil
        heldPads[index] = HeldPadRun(downAt: now, wasActive: wasActive, mode: pad.mode)

        if pad.isLoop && wasActive {
            // Holding an already-active loop pad: will toggle off on release
            sendCommand(["type": "live_pad", "action": "press", "index": index, "pad": index])
            return
        }

        // Trigger logic matching `api.trigger` in `live-performance-state.mjs`
        if queuedPads[index] != nil {
            queuedPads.removeValue(forKey: index)
        } else if quantize && isPlaying {
            queuedPads[index] = nextBeatUptime(from: now)
        } else if pad.isLoop {
            activePads[index] = ActivePadRun(startedAt: now, until: .infinity, held: true)
        } else {
            let dur = pad.hitDuration(bpm: bpm)
            activePads[index] = ActivePadRun(startedAt: now, until: now + dur, held: true)
        }

        sendCommand(["type": "live_pad", "action": "press", "index": index, "pad": index])
    }

    func releasePad(_ index: Int) {
        guard pads.indices.contains(index) else { return }
        let pad = pads[index]
        guard !pad.isEmpty else { return }
        guard !holdLatchMode else { return }

        let now = ProcessInfo.processInfo.systemUptime
        lastLocalActionUptime[index] = now

        guard let heldRun = heldPads.removeValue(forKey: index) else { return }
        HapticsEngine.shared.padRelease()

        let longPress = (now - heldRun.downAt) >= AppConfiguration.holdThresholdSec
        if heldRun.mode == "loop" {
            if longPress || heldRun.wasActive {
                activePads.removeValue(forKey: index)
                queuedPads.removeValue(forKey: index)
            } else if var run = activePads[index] {
                // Short tap on loop pad latches it ON!
                run.held = false
                run.until = .infinity
                activePads[index] = run
            }
        } else {
            // Hit pad release: if held >= 0.22s, stop immediately (except unrepeated chase);
            // if short tap (< 0.22s), let the one-shot hit finish its full duration!
            let isRepeated = activePads[index]?.repeated ?? false
            let shouldStopHeldHit = longPress && (pad.preset != "chase" || isRepeated)
            if shouldStopHeldHit {
                queuedPads.removeValue(forKey: index)
                activePads.removeValue(forKey: index)
            } else if var run = activePads[index] {
                run.held = false
                run.oneShot = true
                activePads[index] = run
            }
        }

        sendCommand(["type": "live_pad", "action": "release", "index": index, "pad": index])
    }

    func stopAllPads() {
        let now = ProcessInfo.processInfo.systemUptime
        for i in 0..<AppConfiguration.totalPadSlots { lastLocalActionUptime[i] = now }
        activePads.removeAll()
        queuedPads.removeAll()
        heldPads.removeAll()
        spatialTouches.removeAll()
        HapticsEngine.shared.padHit(intensity: 0.7, isLoop: false)
        sendCommand(["type": "live_pad", "action": "clear"])
    }

    // MARK: - Spatial 3x3 Pad Gestures (Quick Press = Fast Strobe, Hold = Fade Out, Drag Down = Dim Faster)

    static func hsvToRgbw(hue: Double, sat: Double, val: Double = 1.0) -> [Double] {
        let h = ((hue.truncatingRemainder(dividingBy: 360.0)) + 360.0).truncatingRemainder(dividingBy: 360.0)
        let s = max(0.0, min(1.0, sat))
        let v = max(0.0, min(1.0, val))
        let c = v * s
        let x = c * (1.0 - abs((h / 60.0).truncatingRemainder(dividingBy: 2.0) - 1.0))
        let m = v - c
        var r1 = 0.0, g1 = 0.0, b1 = 0.0
        if h < 60 { r1 = c; g1 = x }
        else if h < 120 { r1 = x; g1 = c }
        else if h < 180 { g1 = c; b1 = x }
        else if h < 240 { g1 = x; b1 = c }
        else if h < 300 { r1 = x; b1 = c }
        else { r1 = c; b1 = x }
        let w = pow(1.0 - s, 1.35) * v
        let r = min(1.0, r1 + m * 0.65)
        let g = min(1.0, g1 + m * 0.65)
        let b = min(1.0, b1 + m * 0.65)
        return [r, g, b, w]
    }

    static func colWithHysteresis(x: Double, prevCol: Int, deadband: Double = 0.016) -> Int {
        let nx = max(0.0, min(1.0, x))
        if prevCol == 0 {
            if nx >= (1.0 / 3.0) + deadband {
                return nx >= (2.0 / 3.0) + deadband ? 2 : 1
            }
            return 0
        }
        if prevCol == 1 {
            if nx <= (1.0 / 3.0) - deadband { return 0 }
            if nx >= (2.0 / 3.0) + deadband { return 2 }
            return 1
        }
        if prevCol == 2 {
            if nx <= (2.0 / 3.0) - deadband {
                return nx <= (1.0 / 3.0) - deadband ? 0 : 1
            }
            return 2
        }
        return max(0, min(2, Int(min(0.9999, nx) * 3.0)))
    }

    func setLiveEffect(_ effect: String) {
        let valid = SpatialTouchEffect(rawValue: effect)?.rawValue ?? "solid"
        if liveEffect != valid {
            liveEffect = valid
        }
        for key in spatialTouches.keys {
            spatialTouches[key]?.effect = valid
        }
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "live_pad", "action": "set_effect", "effect": valid])
    }

    func setLiveIntensity(_ value: Double) {
        let clamped = max(0.0, min(1.0, value))
        if abs(liveIntensity - clamped) > 0.001 {
            liveIntensity = clamped
        }
        for key in spatialTouches.keys {
            if spatialTouches[key]?.mode == .hold {
                spatialTouches[key]?.intensity = clamped
            }
        }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastIntensitySendUptime > 0.025 {
            lastIntensitySendUptime = now
            sendCommand(["type": "live_pad", "action": "set_intensity", "intensity": clamped])
        }
    }

    func setLiveSpread(_ value: Double) {
        let clamped = max(0.0, min(1.0, value))
        if abs(liveSpread - clamped) > 0.001 {
            liveSpread = clamped
        }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastSpreadSendUptime > 0.025 {
            lastSpreadSendUptime = now
            sendCommand(["type": "live_pad", "action": "set_spread", "spread": clamped])
        }
    }

    func setColumnLocked(_ col: Int, locked: Bool) {
        let c = max(0, min(2, col))
        if locked {
            lockedCols.insert(c)
        } else {
            lockedCols.remove(c)
        }
        let now = ProcessInfo.processInfo.systemUptime
        for key in spatialTouches.keys {
            if var touch = spatialTouches[key] {
                for item in expandedCoordsFor(col: touch.col, row: touch.row) {
                    touch.panelHits[item.barId] = SpatialPanelHit(
                        barId: item.barId,
                        row: item.row,
                        col: item.col,
                        lastHitAt: now,
                        peakGain: touch.velocityGain
                    )
                }
                spatialTouches[key] = touch
            }
        }
        sendCommand([
            "type": "live_pad",
            "action": "set_locks",
            "lockedCols": Array(lockedCols).sorted(),
            "lockedRows": Array(lockedRows).sorted()
        ])
    }

    func setRowLocked(_ row: Int, locked: Bool) {
        let r = max(0, min(2, row))
        if locked {
            lockedRows.insert(r)
        } else {
            lockedRows.remove(r)
        }
        let now = ProcessInfo.processInfo.systemUptime
        for key in spatialTouches.keys {
            if var touch = spatialTouches[key] {
                for item in expandedCoordsFor(col: touch.col, row: touch.row) {
                    touch.panelHits[item.barId] = SpatialPanelHit(
                        barId: item.barId,
                        row: item.row,
                        col: item.col,
                        lastHitAt: now,
                        peakGain: touch.velocityGain
                    )
                }
                spatialTouches[key] = touch
            }
        }
        sendCommand([
            "type": "live_pad",
            "action": "set_locks",
            "lockedCols": Array(lockedCols).sorted(),
            "lockedRows": Array(lockedRows).sorted()
        ])
    }

    func expandedCoordsFor(col: Int, row: Int) -> [(col: Int, row: Int, barId: String)] {
        let c = max(0, min(2, col))
        let r = max(0, min(2, row))
        var seen: Set<String> = []
        var list: [(col: Int, row: Int, barId: String)] = []
        func add(_ cc: Int, _ rr: Int) {
            let id = SpatialTouchRun.barIdFor(col: cc, row: rr)
            if !seen.contains(id) {
                seen.insert(id)
                list.append((cc, rr, id))
            }
        }
        add(c, r)
        if lockedCols.contains(c) {
            for rr in 0..<3 { add(c, rr) }
        }
        if lockedRows.contains(r) {
            for cc in 0..<3 { add(cc, r) }
        }
        return list
    }

    func setLiveColorFromWheel(hue: Double, sat: Double) {
        let normHue = ((hue.truncatingRemainder(dividingBy: 360.0)) + 360.0).truncatingRemainder(dividingBy: 360.0)
        let normSat = max(0.0, min(1.0, sat))
        liveHue = normHue
        liveSat = normSat
        let nextColor = Self.hsvToRgbw(hue: normHue, sat: normSat, val: 1.0)
        liveColor = nextColor
        for key in spatialTouches.keys {
            if spatialTouches[key]?.mode == .hold {
                spatialTouches[key]?.color = nextColor
            }
        }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastColorSendUptime > 0.025 {
            lastColorSendUptime = now
            sendCommand(["type": "live_pad", "action": "set_color", "color": nextColor])
        }
    }

    func spatialTouchDown(id: String, x: Double, y: Double) {
        let nx = max(0.0, min(1.0, x))
        let ny = max(0.0, min(1.0, y))
        let now = ProcessInfo.processInfo.systemUptime
        lastLocalTouchUptime = now
        let initialVel = 0.78
        HapticsEngine.shared.guitarStrum(velocity: initialVel * max(0.5, liveIntensity))
        var run = SpatialTouchRun(
            id: id,
            x: nx,
            y: ny,
            startAt: now,
            color: liveColor,
            intensity: liveIntensity,
            effect: liveEffect,
            velocityGain: initialVel
        )
        for item in expandedCoordsFor(col: run.col, row: run.row) {
            run.panelHits[item.barId] = SpatialPanelHit(
                barId: item.barId,
                row: item.row,
                col: item.col,
                lastHitAt: now,
                peakGain: initialVel
            )
        }
        spatialTouches[id] = run
        sendCommand([
            "type": "live_pad",
            "action": "touch_down",
            "touchId": "\(clientId):\(id)",
            "x": nx,
            "y": ny,
            "color": liveColor,
            "intensity": liveIntensity,
            "spread": liveSpread,
            "velocityGain": initialVel,
            "effect": liveEffect,
            "lockedCols": Array(lockedCols).sorted(),
            "lockedRows": Array(lockedRows).sorted()
        ])
    }

    func spatialTouchMove(id: String, x: Double, y: Double) {
        guard var touch = spatialTouches[id], touch.mode == .hold else { return }
        let now = ProcessInfo.processInfo.systemUptime
        lastLocalTouchUptime = now
        touch.lastTickAt = max(touch.lastTickAt, now)

        let nx = max(0.0, min(1.0, x))
        let ny = max(0.0, min(1.0, y))
        let dt = max(0.004, min(0.25, now - touch.lastMoveAt))
        let dist = hypot(nx - touch.x, ny - touch.y)
        let rawSpeed = dist / dt

        // Guitar Mode velocity mapping: slow movement = soft glow (~0.28), fast strum = full punch (1.0)
        if dist > 0.0015 {
            let targetVel = max(0.28, min(1.0, 0.26 + pow(min(1.0, rawSpeed / 1.55), 0.72) * 0.74))
            let alpha = targetVel > touch.velocityGain ? 0.50 : 0.16
            touch.velocityGain = max(0.28, min(1.0, touch.velocityGain + (targetVel - touch.velocityGain) * alpha))
            touch.lastMoveAt = now
        }

        let newCol = max(0, min(2, Int(min(0.9999, nx) * 3.0)))
        let newRow = max(0, min(2, Int(min(0.9999, ny) * 3.0)))
        let changedPanel = (newCol != touch.col) || (newRow != touch.row)

        touch.x = nx
        touch.y = ny
        touch.originX = nx
        touch.originY = ny
        touch.dragDown = 0

        if changedPanel {
            touch.col = newCol
            touch.row = newRow
            touch.barId = SpatialTouchRun.barIdFor(col: newCol, row: newRow)
            touch.snappedCount += 1
            touch.lastSnapAt = now
            HapticsEngine.shared.guitarStrum(velocity: touch.velocityGain * max(0.45, liveIntensity))
        }

        for item in expandedCoordsFor(col: touch.col, row: touch.row) {
            let prevPeak = touch.panelHits[item.barId]?.peakGain ?? 0.0
            let nextPeak = changedPanel ? touch.velocityGain : max(touch.velocityGain, prevPeak * 0.92)
            touch.panelHits[item.barId] = SpatialPanelHit(
                barId: item.barId,
                row: item.row,
                col: item.col,
                lastHitAt: now,
                peakGain: nextPeak
            )
        }

        // Prune expired strum trail hits & keep smooth finger ribbon
        touch.panelHits = touch.panelHits.filter { (now - $0.value.lastHitAt) < 0.45 }
        touch.trailPoints.append(SpatialTrailPoint(x: nx, y: ny, time: now))
        if touch.trailPoints.count > 36 {
            touch.trailPoints.removeFirst(touch.trailPoints.count - 36)
        }
        touch.trailPoints.removeAll { (now - $0.time) > 0.36 }

        spatialTouches[id] = touch

        if changedPanel || (now - (lastTouchMoveSendUptime[id] ?? 0) > 0.022) {
            lastTouchMoveSendUptime[id] = now
            sendCommand([
                "type": "live_pad",
                "action": "touch_move",
                "touchId": "\(clientId):\(id)",
                "x": nx,
                "y": ny,
                "velocityGain": touch.velocityGain
            ])
        }
    }

    func spatialTouchUp(id: String, cancel: Bool = false) {
        lastTouchMoveSendUptime.removeValue(forKey: id)
        guard let touch = spatialTouches.removeValue(forKey: id) else { return }
        let now = ProcessInfo.processInfo.systemUptime
        lastLocalTouchUptime = now
        HapticsEngine.shared.padRelease()
        sendCommand([
            "type": "live_pad",
            "action": "touch_up",
            "touchId": "\(clientId):\(id)",
            "x": touch.x,
            "y": touch.y,
            "cancel": cancel
        ])
    }

    func toggleQuantize() {
        quantize.toggle()
        HapticsEngine.shared.tickSelection()
        sendCommand(["type": "live_pad", "action": "quantize", "value": quantize])
    }

    func toggleHoldLatch() {
        holdLatchMode.toggle()
        HapticsEngine.shared.tickSelection()
        if !holdLatchMode {
            let now = ProcessInfo.processInfo.systemUptime
            for idx in heldPads.keys {
                lastLocalActionUptime[idx] = now
                if pads.indices.contains(idx), !pads[idx].isLoop {
                    activePads.removeValue(forKey: idx)
                }
            }
            heldPads.removeAll()
            sendCommand(["type": "live_pad", "action": "release_all"])
        }
    }

    func toggleBarForSelectedPad(_ barId: String) {
        var pad = selectedPad
        pad.isEmpty = false
        var current = Set(pad.bars.isEmpty ? BarID.allRawIds : pad.bars)
        if current.contains(barId) && current.count > 1 {
            current.remove(barId)
        } else {
            current.insert(barId)
        }
        pad.bars = BarID.allRawIds.filter { current.contains($0) }
        selectedPad = pad
        HapticsEngine.shared.tickSelection()
        syncPadToServer(index: selectedPadIndex)
    }

    func setBarsForSelectedPad(_ bars: [String]) {
        var pad = selectedPad
        pad.isEmpty = false
        pad.bars = bars
        selectedPad = pad
        HapticsEngine.shared.tickSelection()
        syncPadToServer(index: selectedPadIndex)
    }

    func syncPadToServer(index: Int) {
        guard pads.indices.contains(index) else { return }
        savePadsToCache(pads)
        let pad = pads[index]
        if pad.isEmpty {
            sendCommand([
                "type": "live_pad",
                "action": "remove",
                "index": index,
                "pad": index
            ])
            return
        }
        let dict = pad.toServerDictionary()
        sendCommand([
            "type": "live_pad",
            "action": "set",
            "index": index,
            "pad": index,
            "patch": dict,
            "effect": dict
        ])
    }

    internal func housekeepActivePads(now: TimeInterval) {
        // Promote beat-queued pads when beat arrives
        if !queuedPads.isEmpty {
            for (idx, fireTime) in queuedPads where now >= fireTime {
                queuedPads.removeValue(forKey: idx)
                guard pads.indices.contains(idx) else { continue }
                let pad = pads[idx]
                let until = pad.isLoop ? .infinity : (now + pad.hitDuration(bpm: bpm))
                activePads[idx] = ActivePadRun(startedAt: now, until: until, held: heldPads[idx] != nil)
            }
        }

        // Advance or expire active hit pads
        if !activePads.isEmpty {
            for (idx, var run) in activePads {
                guard pads.indices.contains(idx) else {
                    activePads.removeValue(forKey: idx)
                    continue
                }
                let pad = pads[idx]
                if pad.isLoop { continue }
                if now >= run.until {
                    if heldPads[idx] != nil || holdLatchMode {
                        let cycle = pad.hitDuration(bpm: bpm)
                        let elapsed = max(0, now - run.startedAt)
                        let turns = max(1.0, floor(elapsed / cycle))
                        run.startedAt += turns * cycle
                        run.until = run.startedAt + cycle
                        run.repeated = true
                        activePads[idx] = run
                    } else {
                        activePads.removeValue(forKey: idx)
                    }
                }
            }
        }

        // Expire any non-held spatial touches
        if !spatialTouches.isEmpty {
            for (id, touch) in spatialTouches {
                if touch.mode != .hold && now >= touch.until {
                    spatialTouches.removeValue(forKey: id)
                }
            }
        }
    }

    internal func nextBeatUptime(from now: TimeInterval) -> TimeInterval {
        let beatDur = 60.0 / max(40.0, bpm)
        let rem = interpolatedPlayheadSec.truncatingRemainder(dividingBy: beatDur)
        let wait = rem < 0.02 ? 0 : (beatDur - rem)
        return now + min(beatDur, max(0.02, wait))
    }
}
