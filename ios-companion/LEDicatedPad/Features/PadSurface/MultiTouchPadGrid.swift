import SwiftUI
import UIKit

public struct MultiTouchPadGrid: View {
    @Bindable var client: StudioClient
    var columnsCount: Int = 3
    var isLandscape: Bool = false
    var onOpenInspector: (Int) -> Void = { _ in }

    public var body: some View {
        let rowsCount = 12 / max(1, columnsCount)
        GeometryReader { geo in
            let spacing: CGFloat = isLandscape ? 10 : 8
            let totalW = max(1, geo.size.width)
            let totalH = max(1, geo.size.height)
            let cellW = max(24, (totalW - spacing * CGFloat(columnsCount - 1)) / CGFloat(columnsCount))
            let cellH = max(24, (totalH - spacing * CGFloat(rowsCount - 1)) / CGFloat(rowsCount))

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
                                        isQueued: client.queuedPads[index] != nil,
                                        isLandscape: isLandscape
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
                        if client.inspectorOnTapMode || (client.pads.indices.contains(index) && client.pads[index].isEmpty) {
                            client.selectedPadIndex = index
                            HapticsEngine.shared.tickSelection()
                            onOpenInspector(index)
                        } else {
                            client.pressPad(index)
                        }
                    },
                    onPadRelease: { index in
                        client.releasePad(index)
                    }
                )
            }
            .frame(width: totalW, height: totalH)
            .clipped()
        }
    }
}

// MARK: - Native UIKit Multi-Touch Responder for the 12 Effect Panels

struct MultiTouchOverlayRepresentable: UIViewRepresentable {
    var columns: Int
    var rows: Int
    var spacing: CGFloat
    var onPadPress: (Int) -> Void
    var onPadRelease: (Int) -> Void

    func makeUIView(context: Context) -> MultiTouchPadUIView {
        let view = MultiTouchPadUIView()
        view.isMultipleTouchEnabled = true
        view.isExclusiveTouch = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: MultiTouchPadUIView, context: Context) {
        uiView.columns = columns
        uiView.rows = rows
        uiView.spacing = spacing
        uiView.onPadPress = onPadPress
        uiView.onPadRelease = onPadRelease
    }
}

final class MultiTouchPadUIView: UIView {
    var columns: Int = 3
    var rows: Int = 4
    var spacing: CGFloat = 9
    var onPadPress: ((Int) -> Void)?
    var onPadRelease: ((Int) -> Void)?

    private var touchMap: [ObjectIdentifier: Int] = [:]

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
            if let idx = touchMap.removeValue(forKey: key) {
                onPadRelease?(idx)
            }
        }
    }
}
