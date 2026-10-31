import SwiftUI

/// Visual 3x3 LED bar grid icon matching the desktop DAW zone buttons
public struct ZoneMiniGridIcon: View {
    public let activeBars: Set<String>
    public var accent: Color = .cyan

    public init(activeBars: Set<String>, accent: Color = .cyan) {
        self.activeBars = activeBars
        self.accent = accent
    }

    public var body: some View {
        VStack(spacing: 1.5) {
            ForEach(0..<3, id: \.self) { r in
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { c in
                        let bar = BarID.allCases[r * 3 + c]
                        let lit = activeBars.contains(bar.rawValue)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(lit ? accent : Color.white.opacity(0.18))
                            .frame(width: 4.5, height: 2.5)
                    }
                }
            }
        }
    }
}
