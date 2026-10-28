import SwiftUI
import UIKit

public struct MultiTouchPadGrid: View {
    @Bindable var client: StudioClient
    var columnsCount: Int = 3
    var onOpenInspector: (Int) -> Void

    public var body: some View {
        let rowsCount = 12 / max(1, columnsCount)
        GeometryReader { geo in
            let spacing: CGFloat = 9
            let totalW = geo.size.width
            let totalH = geo.size.height
            let cellW = max(44, (totalW - spacing * CGFloat(columnsCount - 1)) / CGFloat(columnsCount))
            let cellH = max(44, (totalH - spacing * CGFloat(rowsCount - 1)) / CGFloat(rowsCount))

            ZStack {
                VStack(spacing: spacing) {
                    ForEach(0..<rowsCount, id: \.self) { row in
                        HStack(spacing: spacing) {
                            ForEach(0..<columnsCount, id: \.self) { col in
                                let index = row * columnsCount + col
                                if client.pads.indices.contains(index) {
                                    PadCardView(
                                        pad: client.pads[index],
                                        isSelected: client.selectedPadIndex == index,
                                        isActive: client.activePads[index] != nil,
                                        isQueued: client.queuedPads[index] != nil
                                    )
                                    .frame(width: cellW, height: cellH)
                                }
                            }
                        }
                    }
                }

                MultiTouchOverlayRepresentable(
                    columns: columnsCount,
                    rows: rowsCount,
                    spacing: spacing,
                    onPadPress: { index in
                        if client.inspectorOnTapMode {
                            client.selectedPadIndex = index
                            HapticsEngine.shared.tickSelection()
                            onOpenInspector(index)
                        } else {
                            client.pressPad(index)
                        }
                    },
                    onPadRelease: { index in
                        client.releasePad(index)
                    },
                    onPadLongPress: { index in
                        client.selectedPadIndex = index
                        HapticsEngine.shared.padHit(intensity: 0.9, isLoop: true)
                        onOpenInspector(index)
                    }
                )
            }
        }
    }
}

struct PadCardView: View {
    let pad: PadConfig
    let isSelected: Bool
    let isActive: Bool
    let isQueued: Bool

    var body: some View {
        let accent = pad.swiftUIColor
        let secondary = pad.swiftUISecondaryColor
        let targetBars = Set(pad.bars.isEmpty ? BarID.allCases.map(\.rawValue) : pad.bars)
        let presetEnum = EffectPreset(rawValue: pad.preset)

        VStack(alignment: .leading, spacing: 0) {
            // Top bar: Key badge + 3x3 mini matrix + HIT/LOOP badge
            HStack(spacing: 6) {
                Text(pad.key)
                    .font(.system(size: 11, weight: .heavy, design: .monospaced))
                    .foregroundStyle(accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))

                Spacer(minLength: 2)

                // Mini 3x3 zone matrix indicator
                VStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { r in
                        HStack(spacing: 2) {
                            ForEach(0..<3, id: \.self) { c in
                                let bar = BarID.allCases[r * 3 + c]
                                let lit = targetBars.contains(bar.rawValue)
                                Circle()
                                    .fill(lit ? accent : Color.white.opacity(0.14))
                                    .frame(width: 3.8, height: 3.8)
                            }
                        }
                    }
                }

                Text(pad.isLoop ? "LOOP" : "HIT")
                    .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        pad.isLoop ? Color.cyan.opacity(0.2) : Color.black.opacity(0.4),
                        in: RoundedRectangle(cornerRadius: 5)
                    )
                    .foregroundStyle(pad.isLoop ? .cyan : .secondary)
            }

            Spacer(minLength: 4)

            // Bottom title & preset label
            VStack(alignment: .leading, spacing: 2) {
                Text(pad.name)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)

                HStack(spacing: 4) {
                    if let sf = presetEnum?.sfSymbol {
                        Image(systemName: sf)
                            .font(.system(size: 9, weight: .bold))
                    }
                    Text((presetEnum?.label ?? pad.preset).uppercased())
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .lineLimit(1)
                }
                .foregroundStyle(accent.opacity(0.9))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 17)
                    .fill(
                        LinearGradient(
                            colors: isActive
                                ? [accent.opacity(0.42), secondary.opacity(0.22), Color(red: 0.07, green: 0.09, blue: 0.14)]
                                : [Color(red: 0.10, green: 0.13, blue: 0.20), Color(red: 0.06, green: 0.07, blue: 0.12)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                // Top Neon Accent Lip
                VStack {
                    Capsule()
                        .fill(LinearGradient(colors: [accent, secondary], startPoint: .leading, endPoint: .trailing))
                        .frame(height: 3)
                        .padding(.horizontal, 12)
                    Spacer()
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 17)
                .strokeBorder(
                    isActive
                        ? accent
                        : (isQueued ? Color.yellow : (isSelected ? accent.opacity(0.75) : Color.white.opacity(0.11))),
                    lineWidth: isActive ? 2.2 : (isSelected || isQueued ? 1.6 : 1.0)
                )
        )
        .shadow(color: isActive ? accent.opacity(0.55) : .black.opacity(0.35), radius: isActive ? 14 : 6, y: isActive ? 0 : 4)
        .scaleEffect(isActive ? 0.965 : 1.0)
        .animation(.interactiveSpring(response: 0.14, dampingFraction: 0.72), value: isActive)
    }
}

// MARK: - Native UIKit Multi-Touch Responder

struct MultiTouchOverlayRepresentable: UIViewRepresentable {
    var columns: Int
    var rows: Int
    var spacing: CGFloat
    var onPadPress: (Int) -> Void
    var onPadRelease: (Int) -> Void
    var onPadLongPress: (Int) -> Void

    func makeUIView(context: Context) -> MultiTouchPadUIView {
        let view = MultiTouchPadUIView()
        view.isMultipleTouchEnabled = true
        view.isExclusiveTouch = true
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: MultiTouchPadUIView, context: Context) {
        uiView.columns = columns
        uiView.rows = rows
        uiView.spacing = spacing
        uiView.onPadPress = onPadPress
        uiView.onPadRelease = onPadRelease
        uiView.onPadLongPress = onPadLongPress
    }
}

final class MultiTouchPadUIView: UIView {
    var columns: Int = 3
    var rows: Int = 4
    var spacing: CGFloat = 9
    var onPadPress: ((Int) -> Void)?
    var onPadRelease: ((Int) -> Void)?
    var onPadLongPress: ((Int) -> Void)?

    private var touchMap: [ObjectIdentifier: Int] = [:]
    private var longPressTimers: [ObjectIdentifier: Timer] = [:]

    private func padIndex(at point: CGPoint) -> Int? {
        guard bounds.contains(point), columns > 0, rows > 0 else { return nil }
        let cellW = (bounds.width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        let cellH = (bounds.height - spacing * CGFloat(rows - 1)) / CGFloat(rows)
        guard cellW > 0, cellH > 0 else { return nil }

        let col = min(columns - 1, max(0, Int(point.x / (cellW + spacing))))
        let row = min(rows - 1, max(0, Int(point.y / (cellH + spacing))))
        let idx = row * columns + col
        return (0..<12).contains(idx) ? idx : nil
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            let key = ObjectIdentifier(touch)
            let pt = touch.location(in: self)
            if let idx = padIndex(at: pt) {
                touchMap[key] = idx
                onPadPress?(idx)

                let timer = Timer.scheduledTimer(withTimeInterval: 0.55, repeats: false) { [weak self] _ in
                    Task { @MainActor in
                        self?.onPadLongPress?(idx)
                    }
                }
                longPressTimers[key] = timer
            }
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            let key = ObjectIdentifier(touch)
            let pt = touch.location(in: self)
            let nextIdx = padIndex(at: pt)
            let prevIdx = touchMap[key]
            if nextIdx != prevIdx {
                longPressTimers[key]?.invalidate()
                longPressTimers.removeValue(forKey: key)
                if let prev = prevIdx {
                    onPadRelease?(prev)
                }
                if let next = nextIdx {
                    touchMap[key] = next
                    onPadPress?(next)
                } else {
                    touchMap.removeValue(forKey: key)
                }
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        cleanupTouches(touches)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        cleanupTouches(touches)
    }

    private func cleanupTouches(_ touches: Set<UITouch>) {
        for touch in touches {
            let key = ObjectIdentifier(touch)
            longPressTimers[key]?.invalidate()
            longPressTimers.removeValue(forKey: key)
            if let idx = touchMap.removeValue(forKey: key) {
                onPadRelease?(idx)
            }
        }
    }
}
