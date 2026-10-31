import SwiftUI

public struct StagePreviewView: View {
    @Bindable var client: StudioClient
    @State private var showZonePainter: Bool = false
    var onOpenTransport: () -> Void

    public init(client: StudioClient, onOpenTransport: @escaping () -> Void) {
        self.client = client
        self.onOpenTransport = onOpenTransport
    }

    public var body: some View {
        TimelineView(.animation) { _ in
            let now = ProcessInfo.processInfo.systemUptime
            let bars = client.tickAndRenderBars(now: now)
            let stats = StageTelemetryStats.compute(from: bars, blackout: client.blackout)
            let playhead = client.frameStore.interpolatedPlayheadSec(isPlaying: client.isPlaying, durationSec: client.durationSec)
            let beatDur = 60.0 / max(40.0, client.bpm)
            let beatIndex = Int(floor(playhead / beatDur)) % 4

            VStack(spacing: 6) {
                headerRow(playhead: playhead, beatIndex: beatIndex)
                visualizerStack(bars: bars)
                telemetryAndZoneRow(stats: stats)
            }
            .padding(9)
            .background(
                LinearGradient(
                    colors: [Color(red: 0.07, green: 0.09, blue: 0.15), Color(red: 0.04, green: 0.05, blue: 0.09)],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                in: RoundedRectangle(cornerRadius: 15)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 15)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            )
        }
    }

    private func headerRow(playhead: Double, beatIndex: Int) -> some View {
        HStack(spacing: 8) {
            Button(action: onOpenTransport) {
                HStack(spacing: 6) {
                    Image(systemName: client.isPlaying ? "play.fill" : "pause.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(client.isPlaying ? Color.green : Color.cyan)
                    Text(client.trackTitle)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(client.sectionName.uppercased())
                        .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.cyan.opacity(0.16), in: RoundedRectangle(cornerRadius: 5))
                        .foregroundStyle(.cyan)
                }
            }
            .buttonStyle(.plain)

            Spacer(minLength: 4)

            HStack(spacing: 5) {
                ForEach(0..<4, id: \.self) { idx in
                    let isLit = idx == beatIndex && (client.isPlaying || !client.activePads.isEmpty)
                    Circle()
                        .fill(isLit ? (idx == 0 ? Color.yellow : Color.cyan) : Color.white.opacity(0.15))
                        .frame(width: 6.5, height: 6.5)
                        .scaleEffect(isLit ? 1.25 : 1.0)
                        .shadow(color: isLit ? Color.cyan : .clear, radius: 4)
                }
                Text(formatTime(playhead))
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func visualizerStack(bars: [BarID: [RGBWPixel]]) -> some View {
        ZStack {
            Canvas { context, size in
                let padX: CGFloat = 12
                let padY: CGFloat = 9
                let gapX: CGFloat = 12
                let gapY: CGFloat = 10
                let barW = (size.width - padX * 2 - gapX * 2) / 3.0
                let barH = (size.height - padY * 2 - gapY * 2) / 3.0

                for bar in BarID.allCases {
                    let x = padX + CGFloat(bar.column) * (barW + gapX)
                    let y = padY + CGFloat(bar.row) * (barH + gapY)
                    let barRect = CGRect(x: x, y: y, width: barW, height: barH)

                    let pixels = bars[bar] ?? []
                    var barPeakEnergy = 0.0
                    var barPeakR = 0.0, barPeakG = 0.0, barPeakB = 0.0
                    for px in pixels {
                        let d = px.displayRGB
                        if d.energy > barPeakEnergy {
                            barPeakEnergy = d.energy
                            barPeakR = d.r
                            barPeakG = d.g
                            barPeakB = d.b
                        }
                    }

                    if barPeakEnergy > 0.05 {
                        let glowRect = barRect.insetBy(dx: -3.5, dy: -3.0)
                        let glowColor = Color(red: barPeakR, green: barPeakG, blue: barPeakB).opacity(0.28 * barPeakEnergy)
                        context.fill(Path(roundedRect: glowRect, cornerRadius: 8), with: .color(glowColor))
                    }

                    let housingPath = Path(roundedRect: barRect.insetBy(dx: -2, dy: -2), cornerRadius: 6)
                    context.fill(housingPath, with: .color(Color(red: 0.03, green: 0.04, blue: 0.07)))
                    context.stroke(
                        housingPath,
                        with: .color(
                            barPeakEnergy > 0.05
                                ? Color(red: barPeakR, green: barPeakG, blue: barPeakB).opacity(0.45)
                                : Color.white.opacity(0.09)
                        ),
                        lineWidth: 0.9
                    )

                    let segW = barW / CGFloat(AppConfiguration.pixelsPerBar)
                    for p in 0..<min(AppConfiguration.pixelsPerBar, pixels.count) {
                        let disp = pixels[p].displayRGB
                        let segRect = CGRect(x: x + CGFloat(p) * segW + 0.5, y: y, width: max(1, segW - 1), height: barH)
                        if disp.energy > 0.01 {
                            let col = Color(red: disp.r, green: disp.g, blue: disp.b)
                            context.fill(Path(roundedRect: segRect, cornerRadius: 2), with: .color(col))
                            if disp.energy > 0.55 {
                                let coreRect = segRect.insetBy(dx: 0.4, dy: barH * 0.24)
                                context.fill(
                                    Path(roundedRect: coreRect, cornerRadius: 1),
                                    with: .color(Color.white.opacity((disp.energy - 0.55) * 0.65))
                                )
                            }
                        } else {
                            context.fill(
                                Path(roundedRect: segRect, cornerRadius: 2),
                                with: .color(Color(red: 0.05, green: 0.06, blue: 0.10).opacity(0.75))
                            )
                        }
                    }
                }
            }
            .frame(height: 68)
            .background(Color(red: 0.02, green: 0.03, blue: 0.05), in: RoundedRectangle(cornerRadius: 11))
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            )

            if showZonePainter {
                let selectedBars = Set(client.selectedPad.bars.isEmpty ? BarID.allRawIds : client.selectedPad.bars)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 4) {
                    ForEach(BarID.allCases) { bar in
                        let isSelected = selectedBars.contains(bar.rawValue)
                        Button {
                            client.toggleBarForSelectedPad(bar.rawValue)
                        } label: {
                            Text(bar.rawValue)
                                .font(.system(size: 9.5, weight: .heavy, design: .monospaced))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 3)
                                .background(
                                    isSelected ? Color.cyan.opacity(0.32) : Color.black.opacity(0.72),
                                    in: RoundedRectangle(cornerRadius: 5)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 5)
                                        .strokeBorder(isSelected ? Color.cyan : Color.white.opacity(0.22), lineWidth: 1)
                                )
                                .foregroundStyle(isSelected ? Color.white : Color.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(5)
                .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 11))
            }
        }
    }

    private func telemetryAndZoneRow(stats: StageTelemetryStats) -> some View {
        HStack(spacing: 6) {
            HStack(spacing: 4) {
                channelPill(label: "R", value: stats.r, color: .red)
                channelPill(label: "G", value: stats.g, color: .green)
                channelPill(label: "B", value: stats.b, color: .blue)
                channelPill(label: "W", value: stats.w, color: .yellow)
                Text(String(format: "%3d W", stats.watts))
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(width: 38, alignment: .trailing)
                    .foregroundStyle(stats.watts > 0 ? Color.cyan : Color.secondary)
            }
            .fixedSize(horizontal: true, vertical: false)

            Spacer(minLength: 4)

            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    showZonePainter.toggle()
                }
                HapticsEngine.shared.tickSelection()
            } label: {
                let count = client.selectedPad.bars.isEmpty ? 9 : client.selectedPad.bars.count
                HStack(spacing: 4) {
                    Image(systemName: "square.grid.3x3.fill")
                        .font(.system(size: 9))
                    Text("Zone: \(count == 9 ? "SVI" : "\(count)/9")")
                        .font(.system(size: 9.5, weight: .bold))
                        .lineLimit(1)
                }
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(showZonePainter ? Color.cyan.opacity(0.22) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .strokeBorder(showZonePainter ? Color.cyan : Color.white.opacity(0.1), lineWidth: 1)
                )
                .foregroundStyle(showZonePainter ? Color.white : Color.secondary)
            }
            .buttonStyle(.plain)

            Button {
                client.setBarsForSelectedPad(BarID.allRawIds)
            } label: {
                Text("9/9")
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
    }

    private func channelPill(label: String, value: Double, color: Color) -> some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white.opacity(0.07))
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 4)
                    .fill(color.opacity(0.55))
                    .frame(width: geo.size.width * CGFloat(max(0, min(1, value))))
            }
            Text(label)
                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
        }
        .frame(width: 24, height: 14)
    }

    private func formatTime(_ sec: Double) -> String {
        let mins = Int(sec) / 60
        let rem = sec.truncatingRemainder(dividingBy: 60)
        return String(format: "%02d:%04.1f", mins, rem)
    }
}
