import SwiftUI

/// Compact live 3x3 LED bar preview placed next to the Status + Song stack in Landscape HUD and Studio Menu
public struct MiniStageMatrixView: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        TimelineView(.animation) { _ in
            let now = ProcessInfo.processInfo.systemUptime
            let bars = client.tickAndRenderBars(now: now)
            Canvas { context, size in
                let padX: CGFloat = 6
                let padY: CGFloat = 5
                let gapX: CGFloat = 3.5
                let gapY: CGFloat = 3.0
                let barW = (size.width - padX * 2 - gapX * 2) / 3.0
                let barH = (size.height - padY * 2 - gapY * 2) / 3.0

                for bar in BarID.allCases {
                    let x = padX + CGFloat(bar.column) * (barW + gapX)
                    let y = padY + CGFloat(bar.row) * (barH + gapY)
                    let barRect = CGRect(x: x, y: y, width: barW, height: barH)
                    let pixels = bars[bar] ?? []
                    let peak = pixels.peakDisplayRGB

                    if peak.energy > 0.02 {
                        let glowRect = barRect.insetBy(dx: -1.5, dy: -1.2)
                        let glowColor = Color(red: peak.r, green: peak.g, blue: peak.b).opacity(0.42 * peak.energy)
                        context.fill(Path(roundedRect: glowRect, cornerRadius: 3), with: .color(glowColor))
                    }

                    // Base fill using peak energy so even single-pixel sparkles light up the mini bar clearly
                    let baseColor = peak.energy > 0.01
                        ? Color(red: peak.r * 0.48, green: peak.g * 0.48, blue: peak.b * 0.48)
                        : Color.white.opacity(0.14)
                    context.fill(Path(roundedRect: barRect, cornerRadius: 2), with: .color(baseColor))

                    // Draw individual pixel segments so chases/sweeps visibly travel across each mini bar
                    let segW = barW / CGFloat(AppConfiguration.pixelsPerBar)
                    for p in 0..<min(AppConfiguration.pixelsPerBar, pixels.count) {
                        let d = pixels[p].displayRGB
                        if d.energy > 0.01 {
                            let segRect = CGRect(x: x + CGFloat(p) * segW, y: y, width: max(1.0, segW), height: barH)
                            context.fill(
                                Path(roundedRect: segRect, cornerRadius: 1),
                                with: .color(Color(red: d.r, green: d.g, blue: d.b))
                            )
                        }
                    }
                }
            }
            .frame(width: 63, height: 34.5)
            .background(Color(red: 0.03, green: 0.04, blue: 0.08), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
    }
}

private extension Array where Element == RGBWPixel {
    var peakDisplayRGB: (r: Double, g: Double, b: Double, energy: Double) {
        var best: (r: Double, g: Double, b: Double, energy: Double) = (0, 0, 0, 0)
        for px in self {
            let d = px.displayRGB
            if d.energy > best.energy {
                best = d
            }
        }
        return best
    }
}
