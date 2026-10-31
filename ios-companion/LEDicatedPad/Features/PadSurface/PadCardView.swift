import SwiftUI

public struct PadCardView: View {
    public let pad: PadConfig
    public let isSelected: Bool
    public let isActive: Bool
    public let isQueued: Bool
    public var isLandscape: Bool = false

    private var accent: Color { pad.swiftUIColor }
    private var secondary: Color { pad.swiftUISecondaryColor }
    private var targetBars: Set<String> { Set(pad.bars.isEmpty ? BarID.allRawIds : pad.bars) }
    private var presetEnum: EffectPreset? { EffectPreset(rawValue: pad.preset) }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topRow
            Spacer(minLength: 2)
            bottomRow
        }
        .padding(isLandscape ? 11 : 9.5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(borderStrokeColor, lineWidth: borderStrokeWidth)
        )
        .shadow(color: isActive ? accent.opacity(0.5) : Color.black.opacity(0.32), radius: isActive ? 12 : 5, y: isActive ? 0 : 3)
        .scaleEffect(isActive ? 0.968 : 1.0)
        .animation(.interactiveSpring(response: 0.13, dampingFraction: 0.72), value: isActive)
    }

    private var topRow: some View {
        HStack(spacing: 6) {
            Text(pad.key)
                .font(.system(size: isLandscape ? 12 : 11, weight: .heavy, design: .monospaced))
                .foregroundStyle(isActive ? Color.black : accent)
                .padding(.horizontal, 6.5)
                .padding(.vertical, 3)
                .background(
                    isActive ? accent : Color.white.opacity(0.09),
                    in: RoundedRectangle(cornerRadius: 6)
                )

            Spacer(minLength: 2)

            if !pad.isEmpty {
                miniZoneGrid
            }

            modeBadge
        }
    }

    private var miniZoneGrid: some View {
        let bars = targetBars
        let cellW: CGFloat = isLandscape ? 5.5 : 4.2
        return VStack(spacing: 2) {
            ForEach(0..<3, id: \.self) { r in
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { c in
                        let bar = BarID.allCases[r * 3 + c]
                        let lit = bars.contains(bar.rawValue)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(lit ? accent : Color.white.opacity(0.14))
                            .frame(width: cellW, height: 3.2)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(Color.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 4))
    }

    private var modeBadge: some View {
        let label: String = pad.isEmpty
            ? "SLOBODNO"
            : (pad.isLoop ? (isActive ? "↻ ON" : "LOOP") : (isActive ? "✦ ON" : "HIT"))
        let bg: Color = pad.isEmpty
            ? Color.white.opacity(0.05)
            : (isActive ? accent.opacity(0.32) : (pad.isLoop ? Color.cyan.opacity(0.22) : Color.white.opacity(0.08)))
        let fg: Color = pad.isEmpty
            ? Color.secondary
            : (isActive ? Color.white : (pad.isLoop ? Color.cyan : Color.secondary))

        return Text(label)
            .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
            .padding(.horizontal, 5.5)
            .padding(.vertical, 2.5)
            .background(bg, in: RoundedRectangle(cornerRadius: 5))
            .foregroundStyle(fg)
    }

    private var bottomRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(pad.isEmpty ? "Prazno" : pad.name)
                .font(.system(size: isLandscape ? 14 : 12.5, weight: .heavy))
                .foregroundStyle(pad.isEmpty ? Color.white.opacity(0.45) : Color.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            HStack(spacing: 4) {
                if pad.isEmpty {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 9, weight: .bold))
                    Text("DODAJ EFEKT")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .lineLimit(1)
                } else {
                    if let sf = presetEnum?.sfSymbol {
                        Image(systemName: sf)
                            .font(.system(size: 9, weight: .bold))
                    }
                    Text((presetEnum?.label ?? pad.preset).uppercased())
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .lineLimit(1)

                    Spacer(minLength: 2)

                    if isLandscape {
                        Text("\(Int((pad.intensity * 100).rounded()))% · \(String(format: "%.1f×", pad.params.speed))")
                            .font(.system(size: 8.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.55))
                    }
                }
            }
            .foregroundStyle(pad.isEmpty ? Color.secondary : accent.opacity(0.95))
        }
    }

    private var cardBackground: some View {
        let gradColors: [Color] = isActive
            ? [accent.opacity(0.46), secondary.opacity(0.24), Color(red: 0.08, green: 0.10, blue: 0.16)]
            : [Color(red: 0.10, green: 0.13, blue: 0.20), Color(red: 0.05, green: 0.07, blue: 0.11)]

        return ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(
                    LinearGradient(
                        colors: gradColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack {
                Capsule()
                    .fill(LinearGradient(colors: [accent, secondary], startPoint: .leading, endPoint: .trailing))
                    .frame(height: isActive ? 4 : 3)
                    .padding(.horizontal, 12)
                    .shadow(color: accent.opacity(isActive ? 0.9 : 0.35), radius: isActive ? 6 : 2)
                Spacer()
            }
        }
    }

    private var borderStrokeColor: Color {
        if isActive { return accent }
        if isQueued { return Color.yellow }
        if isSelected { return accent.opacity(0.75) }
        return Color.white.opacity(0.11)
    }

    private var borderStrokeWidth: CGFloat {
        if isActive { return 2.2 }
        if isSelected || isQueued { return 1.6 }
        return 1.0
    }
}
