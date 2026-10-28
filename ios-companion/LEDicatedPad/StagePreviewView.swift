import SwiftUI

public struct StagePreviewView: View {
    @Bindable var client: StudioClient
    @State private var showZonePainter: Bool = false
    var onOpenTransport: () -> Void

    public var body: some View {
        TimelineView(.animation) { timeline in
            let now = ProcessInfo.processInfo.systemUptime
            let bars = client.tickAndRenderBars(now: now)
            let stats = computeTelemetry(from: bars)
            let playhead = client.interpolatedPlayheadSec
            let beatDur = 60.0 / max(40.0, client.bpm)
            let beatIndex = Int(floor(playhead / beatDur)) % 4

            VStack(spacing: 7) {
                // Header: Track & Beat Phase HUD
                HStack(spacing: 8) {
                    Button(action: onOpenTransport) {
                        HStack(spacing: 6) {
                            Image(systemName: client.isPlaying ? "play.fill" : "pause.fill")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.cyan)
                            Text(client.trackTitle)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Text(client.sectionName.uppercased())
                                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                                .padding(.horizontal, 6)
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
                                .fill(isLit ? (idx == 0 ? Color.yellow : Color.cyan) : Color.white.opacity(0.16))
                                .frame(width: 7, height: 7)
                                .scaleEffect(isLit ? 1.25 : 1.0)
                                .shadow(color: isLit ? .cyan : .clear, radius: 4)
                        }
                        Text(formatTime(playhead))
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }

                // 3x3 Diffused RGBW Bar Visualizer Canvas + Interactive Zone Painter
                ZStack {
                    Canvas { context, size in
                        let padX: CGFloat = 14
                        let padY: CGFloat = 10
                        let gapX: CGFloat = 14
                        let gapY: CGFloat = 12
                        let barW = (size.width - padX * 2 - gapX * 2) / 3.0
                        let barH = (size.height - padY * 2 - gapY * 2) / 3.0

                        for bar in BarID.allCases {
                            let x = padX + CGFloat(bar.column) * (barW + gapX)
                            let y = padY + CGFloat(bar.row) * (barH + gapY)
                            let barRect = CGRect(x: x, y: y, width: barW, height: barH)

                            // Housing
                            context.fill(
                                Path(roundedRect: barRect.insetBy(dx: -2, dy: -2), cornerRadius: 7),
                                with: .color(Color(red: 0.05, green: 0.07, blue: 0.12))
                            )

                            let pixels = bars[bar] ?? []
                            let segW = barW / 12.0
                            for p in 0..<min(12, pixels.count) {
                                let px = pixels[p]
                                let dispR = min(1.0, px.r + px.w * 0.92)
                                let dispG = min(1.0, px.g + px.w * 0.76)
                                let dispB = min(1.0, px.b + px.w * 0.45)
                                let col = Color(red: dispR, green: dispG, blue: dispB)
                                let segRect = CGRect(x: x + CGFloat(p) * segW + 0.5, y: y, width: max(1, segW - 1), height: barH)
                                context.fill(Path(roundedRect: segRect, cornerRadius: 2), with: .color(col))
                            }
                        }
                    }
                    .frame(height: 82)
                    .background(Color(red: 0.02, green: 0.03, blue: 0.05), in: RoundedRectangle(cornerRadius: 11))
                    .overlay(
                        RoundedRectangle(cornerRadius: 11)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    )

                    if showZonePainter {
                        let selectedBars = Set(client.selectedPad.bars.isEmpty ? BarID.allCases.map(\.rawValue) : client.selectedPad.bars)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 5) {
                            ForEach(BarID.allCases) { bar in
                                let isSelected = selectedBars.contains(bar.rawValue)
                                Button {
                                    client.toggleBarForSelectedPad(bar.rawValue)
                                } label: {
                                    Text(bar.rawValue)
                                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 4)
                                        .background(
                                            isSelected ? Color.cyan.opacity(0.32) : Color.black.opacity(0.65),
                                            in: RoundedRectangle(cornerRadius: 6)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 6)
                                                .strokeBorder(isSelected ? Color.cyan : Color.white.opacity(0.22), lineWidth: 1)
                                        )
                                        .foregroundStyle(isSelected ? .white : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(6)
                        .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 11))
                    }
                }

                // Telemetry & Zone Painter Toggle Row
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        channelPill(label: "R", value: stats.r, color: .red)
                        channelPill(label: "G", value: stats.g, color: .green)
                        channelPill(label: "B", value: stats.b, color: .blue)
                        channelPill(label: "W", value: stats.w, color: .yellow)
                        Text("\(stats.watts) W")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button {
                        withAnimation(.snappy(duration: 0.18)) {
                            showZonePainter.toggle()
                        }
                        HapticsEngine.shared.tickSelection()
                    } label: {
                        let count = client.selectedPad.bars.isEmpty ? 9 : client.selectedPad.bars.count
                        Text("3×3 Zone: \(count == 9 ? "SVI" : "\(count)/9")")
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(showZonePainter ? Color.cyan.opacity(0.22) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7)
                                    .strokeBorder(showZonePainter ? Color.cyan : Color.white.opacity(0.1), lineWidth: 1)
                            )
                            .foregroundStyle(showZonePainter ? .white : .secondary)
                    }
                    .buttonStyle(.plain)

                    Button {
                        client.setBarsForSelectedPad(BarID.allCases.map(\.rawValue))
                    } label: {
                        Text("9/9")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
            .background(
                LinearGradient(
                    colors: [Color(red: 0.08, green: 0.10, blue: 0.16), Color(red: 0.04, green: 0.05, blue: 0.09)],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.white.opacity(0.09), lineWidth: 1)
            )
        }
    }

    private func channelPill(label: String, value: Double, color: Color) -> some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white.opacity(0.07))
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 4)
                    .fill(color.opacity(0.5))
                    .frame(width: geo.size.width * CGFloat(max(0, min(1, value))))
            }
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
        }
        .frame(width: 26, height: 15)
    }

    private func computeTelemetry(from bars: [BarID: [RGBWPixel]]) -> (r: Double, g: Double, b: Double, w: Double, watts: Int) {
        if client.blackout { return (0, 0, 0, 0, 0) }
        var sumR = 0.0, sumG = 0.0, sumB = 0.0, sumW = 0.0
        var count = 0.0
        for pxList in bars.values {
            for px in pxList {
                sumR += px.r
                sumG += px.g
                sumB += px.b
                sumW += px.w
                count += 1
            }
        }
        let denom = max(1.0, count)
        let r = sumR / denom
        let g = sumG / denom
        let b = sumB / denom
        let w = sumW / denom
        let avg = (r + g + b + w) / 4.0
        let watts = Int((8.0 + avg * 192.0).rounded())
        return (r, g, b, w, watts)
    }

    private func formatTime(_ sec: Double) -> String {
        let mins = Int(sec) / 60
        let rem = sec.truncatingRemainder(dividingBy: 60)
        return String(format: "%02d:%04.1f", mins, rem)
    }
}
