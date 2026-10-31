import SwiftUI
import UIKit
import QuartzCore

public struct XYMorphSurfaceView: View {
    @Bindable var client: StudioClient
    var isLandscape: Bool = false

    private var activeLiveColor: Color {
        let c = client.liveColor
        let r = c.count > 0 ? c[0] : 0.0
        let g = c.count > 1 ? c[1] : 0.82
        let b = c.count > 2 ? c[2] : 1.0
        let w = c.count > 3 ? c[3] : 0.0
        return Color(
            red: min(1.0, r + w * 0.85),
            green: min(1.0, g + w * 0.75),
            blue: min(1.0, b + w * 0.55)
        )
    }

    public var body: some View {
        GeometryReader { geo in
            let totalW = max(1, geo.size.width)
            let totalH = max(1, geo.size.height)
            let rightW: CGFloat = isLandscape
                ? min(295, max(230, totalW * 0.36))
                : min(142, max(122, totalW * 0.34))
            let padW = max(140, totalW - rightW - 10)

            HStack(spacing: 10) {
                // LEFT / MAIN: Native 120 FPS 3x3 Guitar / Draw Spatial Touch Pad
                SpatialMultiTouchRepresentable(client: client, isLandscape: isLandscape)
                    .frame(width: padW, height: totalH)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(activeLiveColor.opacity(0.45), lineWidth: 1.6)
                    )

                // RIGHT SIDE: Dual Sliders (INTENZITET + SPREAD) + Effect Dropdown + Color Wheel
                Group {
                    if isLandscape {
                        HStack(spacing: 10) {
                            dualSlidersSection(sliderWidth: 44)
                            colorWheelColumn
                        }
                    } else {
                        VStack(spacing: 10) {
                            colorWheelColumn
                                .frame(height: min(196, totalH * 0.46))
                            dualSlidersSection(sliderWidth: max(42, (rightW - 30) * 0.5))
                                .frame(maxHeight: .infinity)
                        }
                    }
                }
                .padding(10)
                .frame(width: rightW, height: totalH)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(StudioTheme.panelBackground)
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
                        )
                )
            }
            .frame(width: totalW, height: totalH)
        }
    }

    private var currentTouchEffect: SpatialTouchEffect {
        SpatialTouchEffect(rawValue: client.liveEffect) ?? .solid
    }

    private var effectDropdownPicker: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("EFEKT")
                .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                .foregroundStyle(StudioTheme.textMuted)
                .lineLimit(1)

            Menu {
                ForEach(SpatialTouchEffect.allCases) { item in
                    Button {
                        client.setLiveEffect(item.rawValue)
                    } label: {
                        Label(
                            item.label,
                            systemImage: client.liveEffect == item.rawValue ? "checkmark.circle.fill" : item.sfSymbol
                        )
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: currentTouchEffect.sfSymbol)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(activeLiveColor)

                    Text(currentTouchEffect.label)
                        .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)

                    Spacer(minLength: 2)

                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 8.5, weight: .black))
                        .foregroundStyle(StudioTheme.textMuted)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(activeLiveColor.opacity(0.45), lineWidth: 1)
                        )
                )
            }
            .buttonStyle(.plain)
        }
    }

    private func dualSlidersSection(sliderWidth: CGFloat) -> some View {
        HStack(spacing: 8) {
            VStack(spacing: 5) {
                Text("INTENZ.")
                    .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(StudioTheme.textMuted)
                    .lineLimit(1)

                NativeVerticalParamSliderRepresentable(client: client, kind: .intensity)
                    .frame(width: sliderWidth)
                    .frame(maxHeight: .infinity)

                Text("\(Int(round(client.liveIntensity * 100)))%")
                    .font(.system(size: 11.5, weight: .black, design: .monospaced))
                    .foregroundStyle(.white)
                    .monospacedDigit()
            }

            VStack(spacing: 5) {
                Text("SPREAD")
                    .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(StudioTheme.textMuted)
                    .lineLimit(1)

                NativeVerticalParamSliderRepresentable(client: client, kind: .spread)
                    .frame(width: sliderWidth)
                    .frame(maxHeight: .infinity)

                Text("\(Int(round(client.liveSpread * 100)))%")
                    .font(.system(size: 11.5, weight: .black, design: .monospaced))
                    .foregroundStyle(.white)
                    .monospacedDigit()
            }
        }
    }

    private var colorWheelColumn: some View {
        VStack(spacing: 6) {
            effectDropdownPicker

            Text("BOJA")
                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                .foregroundStyle(StudioTheme.textMuted)
                .lineLimit(1)

            NativeColorWheelRepresentable(client: client)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Text(client.liveSat < 0.12 ? "BIJELA" : "\(Int(round(client.liveHue)))°")
                .font(.system(size: 11, weight: .heavy, design: .monospaced))
                .foregroundStyle(.white)
                .monospacedDigit()
        }
    }
}

// MARK: - 120 FPS Native UIKit 3x3 Guitar / Draw Surface + Edge Lock Bubbles

struct SpatialMultiTouchRepresentable: UIViewRepresentable {
    var client: StudioClient
    var isLandscape: Bool

    func makeUIView(context: Context) -> SpatialMultiTouchUIView {
        let view = SpatialMultiTouchUIView(client: client)
        view.isLandscape = isLandscape
        return view
    }

    func updateUIView(_ uiView: SpatialMultiTouchUIView, context: Context) {
        uiView.client = client
        uiView.isLandscape = isLandscape
    }
}

private enum EdgeBubbleTarget: Equatable {
    case column(Int)
    case row(Int)
}

private struct ActiveBubbleHold {
    var target: EdgeBubbleTarget
    var startedAt: TimeInterval
    var initiallyLocked: Bool
    var completed: Bool = false
    var lastHapticStep: Int = 0
}

final class SpatialMultiTouchUIView: UIView {
    weak var client: StudioClient?
    var isLandscape: Bool = false

    private var touchIds: [ObjectIdentifier: String] = [:]
    private var bubbleHolds: [ObjectIdentifier: ActiveBubbleHold] = [:]
    private var nextSeq: Int = 1
    private var displayLink: CADisplayLink?
    private let lockHoldDuration: TimeInterval = 0.40

    private let barIds: [[String]] = [
        ["L1", "C1", "R1"],
        ["L2", "C2", "R2"],
        ["L3", "C3", "R3"]
    ]

    init(client: StudioClient) {
        self.client = client
        super.init(frame: .zero)
        isMultipleTouchEnabled = true
        isExclusiveTouch = false
        isOpaque = true
        backgroundColor = UIColor(red: 0.03, green: 0.05, blue: 0.09, alpha: 1.0)
        contentMode = .redraw
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            startDisplayLink()
        } else {
            stopDisplayLink()
        }
    }

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(onDisplayLinkTick))
        if #available(iOS 15.0, *) {
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        }
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func onDisplayLinkTick() {
        guard let client else {
            setNeedsDisplay()
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        for (key, var hold) in bubbleHolds {
            if hold.completed { continue }
            let elapsed = max(0.0, now - hold.startedAt)
            let progress = min(1.0, elapsed / lockHoldDuration)
            let step = Int(progress * 3.0)
            if step > hold.lastHapticStep && step < 3 {
                hold.lastHapticStep = step
                HapticsEngine.shared.tickSelection()
            }
            if progress >= 1.0 {
                hold.completed = true
                let nextLocked = !hold.initiallyLocked
                switch hold.target {
                case .column(let col):
                    client.setColumnLocked(col, locked: nextLocked)
                case .row(let row):
                    client.setRowLocked(row, locked: nextLocked)
                }
                HapticsEngine.shared.bubbleLockComplete(locked: nextLocked)
            }
            bubbleHolds[key] = hold
        }
        setNeedsDisplay()
    }

    private func columnBubbleCenter(col: Int, width: CGFloat, height: CGFloat) -> CGPoint {
        let cellW = width / 3.0
        return CGPoint(x: (CGFloat(col) + 0.5) * cellW, y: height - 13.0)
    }

    private func rowBubbleCenter(row: Int, width: CGFloat, height: CGFloat) -> CGPoint {
        let cellH = height / 3.0
        return CGPoint(x: 13.0, y: (CGFloat(row) + 0.5) * cellH)
    }

    private func hitTestEdgeBubble(at pt: CGPoint) -> EdgeBubbleTarget? {
        let w = max(1.0, bounds.width)
        let h = max(1.0, bounds.height)
        let hitRadius: CGFloat = 28.0

        for col in 0..<3 {
            let center = columnBubbleCenter(col: col, width: w, height: h)
            if hypot(pt.x - center.x, pt.y - center.y) <= hitRadius {
                return .column(col)
            }
        }
        for row in 0..<3 {
            let center = rowBubbleCenter(row: row, width: w, height: h)
            if hypot(pt.x - center.x, pt.y - center.y) <= hitRadius {
                return .row(row)
            }
        }
        return nil
    }

    private func normalizedPoint(for touch: UITouch) -> CGPoint {
        let pt = touch.location(in: self)
        let w = max(1.0, bounds.width)
        let h = max(1.0, bounds.height)
        return CGPoint(
            x: max(0.0, min(1.0, pt.x / w)),
            y: max(0.0, min(1.0, pt.y / h))
        )
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let client else { return }
        let now = ProcessInfo.processInfo.systemUptime
        for touch in touches {
            let key = ObjectIdentifier(touch)
            let rawPt = touch.location(in: self)
            if let bubbleTarget = hitTestEdgeBubble(at: rawPt) {
                let isLocked: Bool
                switch bubbleTarget {
                case .column(let c):
                    isLocked = client.lockedCols.contains(c)
                case .row(let r):
                    isLocked = client.lockedRows.contains(r)
                }
                bubbleHolds[key] = ActiveBubbleHold(
                    target: bubbleTarget,
                    startedAt: now,
                    initiallyLocked: isLocked
                )
                HapticsEngine.shared.bubbleTouch(locking: !isLocked)
                continue
            }

            let id = "t\(nextSeq)"
            nextSeq += 1
            touchIds[key] = id
            let pt = normalizedPoint(for: touch)
            client.spatialTouchDown(id: id, x: Double(pt.x), y: Double(pt.y))
        }
        setNeedsDisplay()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let client else { return }
        for touch in touches {
            let key = ObjectIdentifier(touch)
            if bubbleHolds[key] != nil { continue }
            guard let id = touchIds[key] else { continue }
            let pt = normalizedPoint(for: touch)
            client.spatialTouchMove(id: id, x: Double(pt.x), y: Double(pt.y))
        }
        setNeedsDisplay()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let client else { return }
        for touch in touches {
            let key = ObjectIdentifier(touch)
            if bubbleHolds.removeValue(forKey: key) != nil {
                continue
            }
            if let id = touchIds.removeValue(forKey: key) {
                let pt = normalizedPoint(for: touch)
                client.spatialTouchMove(id: id, x: Double(pt.x), y: Double(pt.y))
                client.spatialTouchUp(id: id, cancel: false)
            }
        }
        setNeedsDisplay()
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let client else { return }
        for touch in touches {
            let key = ObjectIdentifier(touch)
            bubbleHolds.removeValue(forKey: key)
            if let id = touchIds.removeValue(forKey: key) {
                client.spatialTouchUp(id: id, cancel: true)
            }
        }
        setNeedsDisplay()
    }

    private func uiColorFromRgbw(_ c: [Double], alpha: CGFloat = 1.0) -> UIColor {
        let r = c.count > 0 ? c[0] : 0.0
        let g = c.count > 1 ? c[1] : 0.82
        let b = c.count > 2 ? c[2] : 1.0
        let w = c.count > 3 ? c[3] : 0.0
        return UIColor(
            red: CGFloat(min(1.0, r + w * 0.85)),
            green: CGFloat(min(1.0, g + w * 0.75)),
            blue: CGFloat(min(1.0, b + w * 0.55)),
            alpha: alpha
        )
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let w = bounds.width
        let h = bounds.height
        guard w > 1, h > 1 else { return }

        let now = ProcessInfo.processInfo.systemUptime
        let beatSec = 60.0 / max(40.0, min(240.0, client?.bpm ?? 124.0))
        let liveColor = client?.liveColor ?? [0.0, 0.82, 1.0, 0.0]
        let accentUIColor = uiColorFromRgbw(liveColor, alpha: 1.0)
        let lockedCols = client?.lockedCols ?? []
        let lockedRows = client?.lockedRows ?? []
        let spread = client?.liveSpread ?? 0.0

        // 1. Deep studio background gradient
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bgColors = [
            UIColor(red: 0.065, green: 0.11, blue: 0.19, alpha: 1.0).cgColor,
            UIColor(red: 0.025, green: 0.04, blue: 0.075, alpha: 1.0).cgColor
        ] as CFArray
        if let grad = CGGradient(colorsSpace: colorSpace, colors: bgColors, locations: [0.0, 1.0]) {
            let center = CGPoint(x: w * 0.5, y: h * 0.5)
            ctx.drawRadialGradient(
                grad,
                startCenter: center,
                startRadius: 8,
                endCenter: center,
                endRadius: hypot(w, h) * 0.65,
                options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
            )
        }

        let touches = client?.spatialTouches ?? [:]
        var activeBarStates: [String: (level: Double, vel: Double, touch: SpatialTouchRun)] = [:]
        for (_, touch) in touches {
            for bar in BarID.allCases {
                let barGain = BarSynthesizer.barGainForTouch(
                    touch: touch,
                    bar: bar,
                    now: now,
                    liveSpread: spread,
                    lockedCols: lockedCols,
                    lockedRows: lockedRows
                )
                let lvl = max(0.0, min(1.0, barGain * touch.intensity))
                if lvl > 0.005 {
                    if let prev = activeBarStates[bar.rawValue], prev.level >= lvl {
                        // keep stronger
                    } else {
                        activeBarStates[bar.rawValue] = (lvl, barGain, touch)
                    }
                }
            }
        }

        let cellW = w / 3.0
        let cellH = h / 3.0

        // 2. Draw 3x3 Panels & Velocity-Reactive Illumination (Seamless when columns/rows are locked)
        for row in 0..<3 {
            for col in 0..<3 {
                let barId = barIds[row][col]
                let cellRect = CGRect(x: CGFloat(col) * cellW, y: CGFloat(row) * cellH, width: cellW, height: cellH)
                let isColLocked = lockedCols.contains(col)
                let isRowLocked = lockedRows.contains(row)

                let topInset: CGFloat = (isColLocked && row > 0) ? 0.0 : 4.0
                let botInset: CGFloat = (isColLocked && row < 2) ? 0.0 : 4.0
                let leftInset: CGFloat = (isRowLocked && col > 0) ? 0.0 : 4.0
                let rightInset: CGFloat = (isRowLocked && col < 2) ? 0.0 : 4.0
                let insetRect = CGRect(
                    x: cellRect.minX + leftInset,
                    y: cellRect.minY + topInset,
                    width: cellRect.width - leftInset - rightInset,
                    height: cellRect.height - topInset - botInset
                )

                if let activeInfo = activeBarStates[barId] {
                    let lvl = CGFloat(activeInfo.level)
                    let touch = activeInfo.touch
                    let tColor = uiColorFromRgbw(touch.color, alpha: 1.0)
                    let localTime = max(0.0, now - touch.startAt)

                    ctx.saveGState()
                    let cornerRadius: CGFloat = (isColLocked || isRowLocked) ? 6.0 : 12.0
                    let clipPath = UIBezierPath(roundedRect: insetRect, cornerRadius: cornerRadius)
                    clipPath.addClip()

                    tColor.withAlphaComponent(0.10 + lvl * 0.34).setFill()
                    clipPath.fill()

                    // Draw 12 addressable LED segments inside the active panel
                    let segCount = 12
                    let segGap: CGFloat = 2.0
                    let segPadX: CGFloat = 10.0
                    let totalSegW = max(12.0, insetRect.width - segPadX * 2.0)
                    let segW = (totalSegW - CGFloat(segCount - 1) * segGap) / CGFloat(segCount)
                    let segH: CGFloat = min(20.0, insetRect.height * 0.22)
                    let segY = insetRect.midY - segH * 0.5

                    for p in 0..<segCount {
                        let pat = BarSynthesizer.sampleSpatialPanelEffect(
                            effect: touch.effect,
                            pixel: p,
                            row: row,
                            col: col,
                            barId: barId,
                            timeSec: now,
                            localTime: localTime,
                            beatSec: beatSec
                        )
                        let pxLevel = CGFloat(max(0.0, min(1.0, Double(lvl) * pat)))
                        let sx = insetRect.minX + segPadX + CGFloat(p) * (segW + segGap)
                        let segRect = CGRect(x: sx, y: segY, width: max(2.0, segW), height: segH)
                        let segPath = UIBezierPath(roundedRect: segRect, cornerRadius: 3.0)
                        tColor.withAlphaComponent(0.14 + pxLevel * 0.86).setFill()
                        segPath.fill()
                    }
                    ctx.restoreGState()

                    if !isColLocked && !isRowLocked {
                        ctx.saveGState()
                        let borderPath = UIBezierPath(roundedRect: insetRect, cornerRadius: 12)
                        borderPath.lineWidth = 2.0
                        tColor.withAlphaComponent(min(0.95, 0.35 + lvl * 0.60)).setStroke()
                        borderPath.stroke()
                        ctx.restoreGState()
                    }

                    // Velocity percentage badge on the primary touched panel
                    if touch.col == col && touch.row == row {
                        let velPct = Int(round(activeInfo.vel * 100.0))
                        let statusText = "\(barId) · \(velPct)%"
                        let badgeAttrs: [NSAttributedString.Key: Any] = [
                            .font: UIFont.monospacedSystemFont(ofSize: isLandscape ? 11.5 : 10.0, weight: .black),
                            .foregroundColor: UIColor.white.withAlphaComponent(0.95)
                        ]
                        let strSize = (statusText as NSString).size(withAttributes: badgeAttrs)
                        let badgeRect = CGRect(
                            x: cellRect.maxX - strSize.width - 22,
                            y: cellRect.minY + 8,
                            width: strSize.width + 12,
                            height: strSize.height + 4
                        )
                        let badgePath = UIBezierPath(roundedRect: badgeRect, cornerRadius: badgeRect.height / 2)
                        UIColor.black.withAlphaComponent(0.62).setFill()
                        badgePath.fill()
                        tColor.withAlphaComponent(0.8).setStroke()
                        badgePath.lineWidth = 1.0
                        badgePath.stroke()
                        (statusText as NSString).draw(
                            at: CGPoint(x: badgeRect.minX + 6, y: badgeRect.minY + 2),
                            withAttributes: badgeAttrs
                        )
                    }
                }

                // Corner Bar ID Label (L1 .. R3)
                let isCurrentlyActive = activeBarStates[barId] != nil
                let labelFont = UIFont.monospacedSystemFont(
                    ofSize: isLandscape ? (isCurrentlyActive ? 19 : 15) : (isCurrentlyActive ? 16 : 13.5),
                    weight: .black
                )
                let labelColor = isCurrentlyActive
                    ? UIColor.white
                    : UIColor.white.withAlphaComponent(0.50)
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: labelFont,
                    .foregroundColor: labelColor
                ]
                (barId as NSString).draw(
                    at: CGPoint(x: cellRect.minX + 12, y: cellRect.minY + 8),
                    withAttributes: attrs
                )
            }
        }

        // 3. Draw Grid Dividers: Dashed lines between unlocked panels; ERASED inside locked columns/rows
        ctx.saveGState()
        for colBoundary in 1...2 {
            let xPos = CGFloat(colBoundary) * cellW
            for row in 0..<3 {
                // If this row is locked, erase the vertical divider inside this row!
                if lockedRows.contains(row) { continue }
                let yStart = CGFloat(row) * cellH + 8.0
                let yEnd = CGFloat(row + 1) * cellH - 8.0
                ctx.setLineWidth(1.2)
                ctx.setLineDash(phase: 0, lengths: [6, 5])
                UIColor.white.withAlphaComponent(0.18).setStroke()
                ctx.move(to: CGPoint(x: xPos, y: yStart))
                ctx.addLine(to: CGPoint(x: xPos, y: yEnd))
                ctx.strokePath()
            }
        }

        for rowBoundary in 1...2 {
            let yPos = CGFloat(rowBoundary) * cellH
            for col in 0..<3 {
                // If this column is locked, erase the horizontal divider inside this column!
                if lockedCols.contains(col) { continue }
                let xStart = CGFloat(col) * cellW + 8.0
                let xEnd = CGFloat(col + 1) * cellW - 8.0
                ctx.setLineWidth(1.2)
                ctx.setLineDash(phase: 0, lengths: [6, 5])
                UIColor.white.withAlphaComponent(0.18).setStroke()
                ctx.move(to: CGPoint(x: xStart, y: yPos))
                ctx.addLine(to: CGPoint(x: xEnd, y: yPos))
                ctx.strokePath()
            }
        }
        ctx.setLineDash(phase: 0, lengths: [])
        ctx.restoreGState()

        // 4. Draw Solid Glowing Outer Border around Locked Columns & Locked Rows
        for col in lockedCols.sorted() {
            let colRect = CGRect(x: CGFloat(col) * cellW + 3.5, y: 3.5, width: cellW - 7.0, height: h - 7.0)
            let path = UIBezierPath(roundedRect: colRect, cornerRadius: 16)
            ctx.saveGState()
            ctx.setShadow(offset: .zero, blur: 10, color: accentUIColor.withAlphaComponent(0.65).cgColor)
            accentUIColor.withAlphaComponent(0.82).setStroke()
            path.lineWidth = 2.0
            path.stroke()
            ctx.restoreGState()
        }

        for row in lockedRows.sorted() {
            let rowRect = CGRect(x: 3.5, y: CGFloat(row) * cellH + 3.5, width: w - 7.0, height: cellH - 7.0)
            let path = UIBezierPath(roundedRect: rowRect, cornerRadius: 16)
            ctx.saveGState()
            ctx.setShadow(offset: .zero, blur: 10, color: accentUIColor.withAlphaComponent(0.65).cgColor)
            accentUIColor.withAlphaComponent(0.82).setStroke()
            path.lineWidth = 2.0
            path.stroke()
            ctx.restoreGState()
        }

        // 5. Draw Active Bubble Expansion / Retraction Animation + Subtle Edge Lock Dots
        drawEdgeLockBubbles(ctx: ctx, width: w, height: h, cellW: cellW, cellH: cellH, now: now, accent: accentUIColor, lockedCols: lockedCols, lockedRows: lockedRows)

        // 6. Draw Smooth Guitar Strum Ribbon & Finger Touch Puck
        for (_, touch) in touches {
            let tColor = uiColorFromRgbw(touch.color, alpha: 1.0)
            if touch.trailPoints.count >= 2 {
                ctx.saveGState()
                ctx.setLineCap(.round)
                ctx.setLineJoin(.round)
                for i in 1..<touch.trailPoints.count {
                    let p0 = touch.trailPoints[i - 1]
                    let p1 = touch.trailPoints[i]
                    let age = max(0.0, now - p1.time)
                    let life = max(0.0, min(1.0, 1.0 - age / 0.36))
                    if life <= 0.02 { continue }
                    ctx.setLineWidth(CGFloat(3.0 + life * 9.0 * touch.velocityGain))
                    tColor.withAlphaComponent(CGFloat(life * 0.55)).setStroke()
                    ctx.move(to: CGPoint(x: CGFloat(p0.x) * w, y: CGFloat(p0.y) * h))
                    ctx.addLine(to: CGPoint(x: CGFloat(p1.x) * w, y: CGFloat(p1.y) * h))
                    ctx.strokePath()
                }
                ctx.restoreGState()
            }

            let px = CGFloat(touch.x) * w
            let py = CGFloat(touch.y) * h
            let puckR = CGFloat(9.0 + touch.velocityGain * 5.0)
            let puckRect = CGRect(x: px - puckR, y: py - puckR, width: puckR * 2, height: puckR * 2)
            ctx.saveGState()
            ctx.setShadow(offset: .zero, blur: 10, color: tColor.cgColor)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: puckRect).fill()
            tColor.setStroke()
            let ring = UIBezierPath(ovalIn: puckRect)
            ring.lineWidth = 2.5
            ring.stroke()
            ctx.restoreGState()
        }
    }

    private func drawEdgeLockBubbles(
        ctx: CGContext,
        width w: CGFloat,
        height h: CGFloat,
        cellW: CGFloat,
        cellH: CGFloat,
        now: TimeInterval,
        accent: UIColor,
        lockedCols: Set<Int>,
        lockedRows: Set<Int>
    ) {
        var colHoldMap: [Int: ActiveBubbleHold] = [:]
        var rowHoldMap: [Int: ActiveBubbleHold] = [:]
        for (_, hold) in bubbleHolds {
            switch hold.target {
            case .column(let c): colHoldMap[c] = hold
            case .row(let r): rowHoldMap[r] = hold
            }
        }

        // Bottom edge: 3 Column Lock Bubbles
        for col in 0..<3 {
            let center = columnBubbleCenter(col: col, width: w, height: h)
            let isLocked = lockedCols.contains(col)
            if let hold = colHoldMap[col], !hold.completed {
                let raw = min(1.0, max(0.0, (now - hold.startedAt) / lockHoldDuration))
                let eased = 1.0 - pow(1.0 - raw, 2.2)
                let spanFrac = hold.initiallyLocked ? (1.0 - eased) : eased

                // Expanding / shrinking vertical bubble capsule along the column
                let beamH = max(20.0, (h - 14.0) * CGFloat(spanFrac))
                let beamRect = CGRect(
                    x: CGFloat(col) * cellW + 5.0,
                    y: h - 7.0 - beamH,
                    width: cellW - 10.0,
                    height: beamH
                )
                ctx.saveGState()
                let beamPath = UIBezierPath(roundedRect: beamRect, cornerRadius: 14)
                accent.withAlphaComponent(0.18 + 0.14 * CGFloat(spanFrac)).setFill()
                beamPath.fill()
                ctx.setShadow(offset: .zero, blur: 10, color: accent.withAlphaComponent(0.75).cgColor)
                accent.withAlphaComponent(0.85).setStroke()
                beamPath.lineWidth = 2.0
                beamPath.stroke()
                ctx.restoreGState()

                // Swollen bubble dot at bottom anchor
                let r: CGFloat = 7.5 + 3.5 * CGFloat(sin(raw * .pi))
                let dotRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                ctx.saveGState()
                ctx.setShadow(offset: .zero, blur: 8, color: accent.cgColor)
                accent.setFill()
                UIBezierPath(ovalIn: dotRect).fill()
                UIColor.white.setStroke()
                let ring = UIBezierPath(ovalIn: dotRect)
                ring.lineWidth = 1.8
                ring.stroke()
                ctx.restoreGState()
            } else {
                let r: CGFloat = isLocked ? 6.0 : 4.5
                let dotRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                ctx.saveGState()
                if isLocked {
                    ctx.setShadow(offset: .zero, blur: 6, color: accent.cgColor)
                    accent.withAlphaComponent(0.95).setFill()
                    UIBezierPath(ovalIn: dotRect).fill()
                    UIColor.white.withAlphaComponent(0.9).setStroke()
                    let ring = UIBezierPath(ovalIn: dotRect)
                    ring.lineWidth = 1.4
                    ring.stroke()
                } else {
                    UIColor.white.withAlphaComponent(0.38).setFill()
                    UIBezierPath(ovalIn: dotRect).fill()
                }
                ctx.restoreGState()
            }
        }

        // Left edge: 3 Row Lock Bubbles
        for row in 0..<3 {
            let center = rowBubbleCenter(row: row, width: w, height: h)
            let isLocked = lockedRows.contains(row)
            if let hold = rowHoldMap[row], !hold.completed {
                let raw = min(1.0, max(0.0, (now - hold.startedAt) / lockHoldDuration))
                let eased = 1.0 - pow(1.0 - raw, 2.2)
                let spanFrac = hold.initiallyLocked ? (1.0 - eased) : eased

                // Expanding / shrinking horizontal bubble capsule along the row
                let beamW = max(20.0, (w - 14.0) * CGFloat(spanFrac))
                let beamRect = CGRect(
                    x: 7.0,
                    y: CGFloat(row) * cellH + 5.0,
                    width: beamW,
                    height: cellH - 10.0
                )
                ctx.saveGState()
                let beamPath = UIBezierPath(roundedRect: beamRect, cornerRadius: 14)
                accent.withAlphaComponent(0.18 + 0.14 * CGFloat(spanFrac)).setFill()
                beamPath.fill()
                ctx.setShadow(offset: .zero, blur: 10, color: accent.withAlphaComponent(0.75).cgColor)
                accent.withAlphaComponent(0.85).setStroke()
                beamPath.lineWidth = 2.0
                beamPath.stroke()
                ctx.restoreGState()

                // Swollen bubble dot at left anchor
                let r: CGFloat = 7.5 + 3.5 * CGFloat(sin(raw * .pi))
                let dotRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                ctx.saveGState()
                ctx.setShadow(offset: .zero, blur: 8, color: accent.cgColor)
                accent.setFill()
                UIBezierPath(ovalIn: dotRect).fill()
                UIColor.white.setStroke()
                let ring = UIBezierPath(ovalIn: dotRect)
                ring.lineWidth = 1.8
                ring.stroke()
                ctx.restoreGState()
            } else {
                let r: CGFloat = isLocked ? 6.0 : 4.5
                let dotRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                ctx.saveGState()
                if isLocked {
                    ctx.setShadow(offset: .zero, blur: 6, color: accent.cgColor)
                    accent.withAlphaComponent(0.95).setFill()
                    UIBezierPath(ovalIn: dotRect).fill()
                    UIColor.white.withAlphaComponent(0.9).setStroke()
                    let ring = UIBezierPath(ovalIn: dotRect)
                    ring.lineWidth = 1.4
                    ring.stroke()
                } else {
                    UIColor.white.withAlphaComponent(0.38).setFill()
                    UIBezierPath(ovalIn: dotRect).fill()
                }
                ctx.restoreGState()
            }
        }
    }
}

// MARK: - Native UIKit Vertical Parameter Slider (INTENZITET & SPREAD)

enum VerticalSliderParamKind {
    case intensity
    case spread
}

struct NativeVerticalParamSliderRepresentable: UIViewRepresentable {
    var client: StudioClient
    var kind: VerticalSliderParamKind

    func makeUIView(context: Context) -> NativeVerticalParamSliderUIView {
        NativeVerticalParamSliderUIView(client: client, kind: kind)
    }

    func updateUIView(_ uiView: NativeVerticalParamSliderUIView, context: Context) {
        uiView.client = client
        uiView.kind = kind
        uiView.setNeedsDisplay()
    }
}

final class NativeVerticalParamSliderUIView: UIView {
    weak var client: StudioClient?
    var kind: VerticalSliderParamKind
    private var lastTickBucket: Int = -1

    init(client: StudioClient, kind: VerticalSliderParamKind) {
        self.client = client
        self.kind = kind
        super.init(frame: .zero)
        isMultipleTouchEnabled = false
        isExclusiveTouch = false
        backgroundColor = .clear
        contentMode = .redraw
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func handleTouch(_ touch: UITouch) {
        guard let client else { return }
        let h = max(1.0, bounds.height)
        let y = touch.location(in: self).y
        let raw = 1.0 - Double(y / h)
        let clamped = max(0.0, min(1.0, raw))
        let bucket = Int((clamped * 10.0).rounded())
        if bucket != lastTickBucket {
            lastTickBucket = bucket
            if bucket == 0 || bucket == 10 {
                HapticsEngine.shared.dimmerStepTick(progress: 1.0)
            } else {
                HapticsEngine.shared.tickSelection()
            }
        }
        switch kind {
        case .intensity:
            client.setLiveIntensity(clamped)
        case .spread:
            client.setLiveSpread(clamped)
        }
        setNeedsDisplay()
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let w = bounds.width
        let h = bounds.height
        guard w > 2, h > 2 else { return }

        let currentVal: Double = (kind == .intensity)
            ? (client?.liveIntensity ?? 1.0)
            : (client?.liveSpread ?? 0.0)
        let val = CGFloat(max(0.0, min(1.0, currentVal)))
        let c = client?.liveColor ?? [0.0, 0.82, 1.0, 0.0]
        let r = c.count > 0 ? c[0] : 0.0
        let g = c.count > 1 ? c[1] : 0.82
        let b = c.count > 2 ? c[2] : 1.0
        let cw = c.count > 3 ? c[3] : 0.0
        let accent = UIColor(
            red: CGFloat(min(1.0, r + cw * 0.85)),
            green: CGFloat(min(1.0, g + cw * 0.75)),
            blue: CGFloat(min(1.0, b + cw * 0.55)),
            alpha: 1.0
        )

        let trackRect = bounds.insetBy(dx: 2, dy: 2)
        let corner = min(trackRect.width * 0.5, 16)
        let trackPath = UIBezierPath(roundedRect: trackRect, cornerRadius: corner)
        UIColor(white: 0.04, alpha: 0.85).setFill()
        trackPath.fill()

        ctx.saveGState()
        trackPath.addClip()

        let fillH = trackRect.height * val
        let fillRect = CGRect(
            x: trackRect.minX,
            y: trackRect.maxY - fillH,
            width: trackRect.width,
            height: fillH
        )
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let topColor = (kind == .spread)
            ? accent.withAlphaComponent(0.95).cgColor
            : UIColor.white.cgColor
        let colors = [
            topColor,
            accent.cgColor,
            accent.withAlphaComponent(0.32).cgColor
        ] as CFArray
        if let grad = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0.0, 0.4, 1.0]) {
            ctx.drawLinearGradient(
                grad,
                start: CGPoint(x: fillRect.midX, y: fillRect.minY),
                end: CGPoint(x: fillRect.midX, y: fillRect.maxY),
                options: []
            )
        }

        let thumbY = max(trackRect.minY + 4, min(trackRect.maxY - 10, trackRect.maxY - fillH - 3))
        let thumbRect = CGRect(x: trackRect.minX + 4, y: thumbY, width: trackRect.width - 8, height: 6)
        let thumbPath = UIBezierPath(roundedRect: thumbRect, cornerRadius: 3.0)
        UIColor.white.setFill()
        thumbPath.fill()
        ctx.restoreGState()

        trackPath.lineWidth = 1.4
        UIColor.white.withAlphaComponent(0.22).setStroke()
        trackPath.stroke()
    }
}

// MARK: - Native UIKit Interactive HSV + Warm-White Color Wheel

struct NativeColorWheelRepresentable: UIViewRepresentable {
    var client: StudioClient

    func makeUIView(context: Context) -> NativeColorWheelUIView {
        NativeColorWheelUIView(client: client)
    }

    func updateUIView(_ uiView: NativeColorWheelUIView, context: Context) {
        uiView.client = client
        uiView.setNeedsDisplay()
    }
}

final class NativeColorWheelUIView: UIView {
    weak var client: StudioClient?
    private var cachedWheelImage: CGImage?
    private var cachedSide: Int = 0
    private var wasCenterWhite: Bool = false
    private var lastHueSector: Int = -1

    init(client: StudioClient) {
        self.client = client
        super.init(frame: .zero)
        isMultipleTouchEnabled = false
        isExclusiveTouch = false
        backgroundColor = .clear
        contentMode = .redraw
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func handleTouch(_ touch: UITouch) {
        guard let client else { return }
        let pt = touch.location(in: self)
        let side = min(bounds.width, bounds.height)
        let radius = max(1.0, side * 0.5 - 4.0)
        let cx = bounds.midX
        let cy = bounds.midY
        let dx = Double(pt.x - cx)
        let dy = Double(pt.y - cy)
        let sat = max(0.0, min(1.0, hypot(dx, dy) / Double(radius)))
        let hue = (atan2(dy, dx) * 180.0 / .pi + 360.0).truncatingRemainder(dividingBy: 360.0)

        let isWhite = sat < 0.12
        if isWhite != wasCenterWhite {
            wasCenterWhite = isWhite
            if isWhite {
                HapticsEngine.shared.dimmerStepTick(progress: 0.9)
            } else {
                HapticsEngine.shared.tickSelection()
            }
        } else if !isWhite {
            let sector = Int((hue / 30.0).rounded()) % 12
            if sector != lastHueSector {
                lastHueSector = sector
                HapticsEngine.shared.tickSelection()
            }
        }

        client.setLiveColorFromWheel(hue: hue, sat: sat)
        setNeedsDisplay()
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTouch(t) }
    }

    private func ensureWheelImage(sidePx: Int) -> CGImage? {
        if let cachedWheelImage, cachedSide == sidePx {
            return cachedWheelImage
        }
        guard sidePx > 8 else { return nil }
        var pixels = [UInt8](repeating: 0, count: sidePx * sidePx * 4)
        let rMax = Double(sidePx) * 0.5
        for py in 0..<sidePx {
            for px in 0..<sidePx {
                let dx = Double(px) - rMax + 0.5
                let dy = Double(py) - rMax + 0.5
                let dist = hypot(dx, dy)
                if dist > rMax { continue }
                let sat = max(0.0, min(1.0, dist / max(1.0, rMax - 1.0)))
                let hue = (atan2(dy, dx) * 180.0 / .pi + 360.0).truncatingRemainder(dividingBy: 360.0)
                let rgbw = StudioClient.hsvToRgbw(hue: hue, sat: sat, val: 1.0)
                let r = min(1.0, rgbw[0] + rgbw[3] * 0.85)
                let g = min(1.0, rgbw[1] + rgbw[3] * 0.75)
                let b = min(1.0, rgbw[2] + rgbw[3] * 0.55)
                let edgeAlpha = dist > (rMax - 1.5) ? max(0.0, min(1.0, rMax - dist)) : 1.0
                let idx = (py * sidePx + px) * 4
                pixels[idx] = UInt8((r * edgeAlpha * 255.0).rounded())
                pixels[idx + 1] = UInt8((g * edgeAlpha * 255.0).rounded())
                pixels[idx + 2] = UInt8((b * edgeAlpha * 255.0).rounded())
                pixels[idx + 3] = UInt8((edgeAlpha * 255.0).rounded())
            }
        }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let cgImg = CGImage(
                  width: sidePx,
                  height: sidePx,
                  bitsPerComponent: 8,
                  bitsPerPixel: 32,
                  bytesPerRow: sidePx * 4,
                  space: colorSpace,
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                  provider: provider,
                  decode: nil,
                  shouldInterpolate: true,
                  intent: .defaultIntent
              ) else { return nil }
        cachedWheelImage = cgImg
        cachedSide = sidePx
        return cgImg
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let side = min(bounds.width, bounds.height) - 6
        guard side > 12 else { return }

        let wheelRect = CGRect(
            x: bounds.midX - side * 0.5,
            y: bounds.midY - side * 0.5,
            width: side,
            height: side
        )

        if let cgImg = ensureWheelImage(sidePx: min(220, max(64, Int(side * 2)))) {
            UIImage(cgImage: cgImg).draw(in: wheelRect)
        }

        let ringPath = UIBezierPath(ovalIn: wheelRect)
        ringPath.lineWidth = 2.0
        UIColor.white.withAlphaComponent(0.28).setStroke()
        ringPath.stroke()

        let hue = client?.liveHue ?? 195.0
        let sat = client?.liveSat ?? 1.0
        let c = client?.liveColor ?? [0.0, 0.82, 1.0, 0.0]
        let puckColor = UIColor(
            red: CGFloat(min(1.0, (c.count > 0 ? c[0] : 0) + (c.count > 3 ? c[3] * 0.85 : 0))),
            green: CGFloat(min(1.0, (c.count > 1 ? c[1] : 0.8) + (c.count > 3 ? c[3] * 0.75 : 0))),
            blue: CGFloat(min(1.0, (c.count > 2 ? c[2] : 1.0) + (c.count > 3 ? c[3] * 0.55 : 0))),
            alpha: 1.0
        )

        let angleRad = hue * .pi / 180.0
        let maxR = side * 0.5 - 8.0
        let puckX = bounds.midX + CGFloat(cos(angleRad)) * CGFloat(sat) * maxR
        let puckY = bounds.midY + CGFloat(sin(angleRad)) * CGFloat(sat) * maxR
        let puckRect = CGRect(x: puckX - 11, y: puckY - 11, width: 22, height: 22)
        let puckPath = UIBezierPath(ovalIn: puckRect)

        ctx.saveGState()
        ctx.setShadow(offset: .zero, blur: 6, color: UIColor.black.withAlphaComponent(0.85).cgColor)
        puckColor.setFill()
        puckPath.fill()
        ctx.restoreGState()

        UIColor.white.setStroke()
        puckPath.lineWidth = 2.5
        puckPath.stroke()
    }
}
