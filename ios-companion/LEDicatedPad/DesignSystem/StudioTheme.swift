import SwiftUI

public enum StudioTheme {
    public static let warmWhiteAccent = Color(red: 1.0, green: 0.82, blue: 0.35)
    public static let textMuted = Color.white.opacity(0.6)
    public static let panelBackground = Color(red: 0.05, green: 0.08, blue: 0.14).opacity(0.92)

    public static var backgroundGradient: some View {
        RadialGradient(
            colors: [Color(red: 0.08, green: 0.11, blue: 0.19), Color(red: 0.02, green: 0.03, blue: 0.06)],
            center: .top,
            startRadius: 20,
            endRadius: 720
        )
        .ignoresSafeArea()
    }

    public static var sheetBackgroundGradient: some View {
        RadialGradient(
            colors: [Color(red: 0.08, green: 0.11, blue: 0.19), Color(red: 0.03, green: 0.04, blue: 0.08)],
            center: .top,
            startRadius: 20,
            endRadius: 680
        )
        .ignoresSafeArea()
    }

    public static let colorSwatches: [(name: String, primary: [Double], secondary: [Double])] = [
        ("Cijan & Led", [0.0, 0.95, 1.0], [0.22, 0.64, 1.0]),
        ("Neon Magenta", [1.0, 0.18, 0.58], [0.66, 0.33, 0.97]),
        ("Zlatni Jantar", [1.0, 0.72, 0.0], [1.0, 0.33, 0.0]),
        ("Smaragd", [0.06, 0.88, 0.56], [0.0, 0.95, 1.0]),
        ("Čista Bijela", [1.0, 1.0, 1.0], [1.0, 0.85, 0.65]),
        ("Indigo & Pink", [0.39, 0.40, 0.95], [0.93, 0.28, 0.60]),
        ("Klupska Crvena", [1.0, 0.16, 0.22], [1.0, 0.58, 0.08]),
        ("Ultraljubičasta", [0.68, 0.32, 1.0], [0.0, 0.92, 1.0])
    ]
}

public struct HudIconButton: View {
    public let icon: String
    public let active: Bool
    public let activeColor: Color
    public let action: () -> Void

    public init(icon: String, active: Bool, activeColor: Color, action: @escaping () -> Void) {
        self.icon = icon
        self.active = active
        self.activeColor = activeColor
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .frame(width: 34, height: 34)
                .background(
                    active ? activeColor.opacity(0.24) : Color.white.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 9)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .strokeBorder(active ? activeColor.opacity(0.7) : Color.white.opacity(0.09), lineWidth: 1)
                )
                .foregroundStyle(active ? activeColor : Color.white.opacity(0.78))
        }
        .buttonStyle(.plain)
        .fixedSize()
    }
}
