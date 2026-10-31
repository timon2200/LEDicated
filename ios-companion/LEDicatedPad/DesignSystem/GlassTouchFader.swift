import SwiftUI

/// Custom tactile glassmorphic touch fader that replaces standard UISlider thumbs
public struct GlassTouchFader: View {
    public let title: String
    public let valueText: String
    @Binding public var value: Double
    public let range: ClosedRange<Double>
    public var accent: Color = .cyan
    public var compact: Bool = false

    public init(
        title: String,
        valueText: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        accent: Color = .cyan,
        compact: Bool = false
    ) {
        self.title = title
        self.valueText = valueText
        self._value = value
        self.range = range
        self.accent = accent
        self.compact = compact
    }

    public var body: some View {
        let span = max(0.0001, range.upperBound - range.lowerBound)
        let normalized = max(0, min(1, (value - range.lowerBound) / span))

        VStack(alignment: .leading, spacing: compact ? 3 : 4) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: compact ? 8.5 : 9.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 2)
                Text(valueText)
                    .font(.system(size: 10, weight: .heavy, design: .monospaced))
                    .foregroundStyle(accent)
            }

            GeometryReader { geo in
                let w = max(1, geo.size.width)
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: compact ? 7 : 9)
                        .fill(Color.black.opacity(0.45))

                    RoundedRectangle(cornerRadius: compact ? 7 : 9)
                        .fill(
                            LinearGradient(
                                colors: [accent.opacity(0.35), accent.opacity(0.85)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(8, w * CGFloat(normalized)))

                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white)
                        .frame(width: 3, height: compact ? 14 : 18)
                        .shadow(color: accent, radius: 4)
                        .offset(x: max(2, min(w - 5, w * CGFloat(normalized) - 2)))
                }
                .overlay(
                    RoundedRectangle(cornerRadius: compact ? 7 : 9)
                        .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                )
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { drag in
                            let frac = max(0, min(1, Double(drag.location.x / w)))
                            value = range.lowerBound + frac * span
                        }
                )
            }
            .frame(height: compact ? 20 : 24)
        }
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.vertical, compact ? 6 : 8)
        .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: compact ? 10 : 12))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
        )
    }
}
