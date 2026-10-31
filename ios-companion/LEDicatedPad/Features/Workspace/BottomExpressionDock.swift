import SwiftUI

public struct BottomExpressionDock: View {
    @Bindable var client: StudioClient
    var onOpenInspector: () -> Void

    public var body: some View {
        let accent = client.selectedPad.swiftUIColor
        VStack(spacing: 7) {
            HStack(spacing: 7) {
                GlassTouchFader(
                    title: "INTENZITET",
                    valueText: "\(Int((client.selectedPad.intensity * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.intensity },
                        set: {
                            client.selectedPad.intensity = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.15...1.0,
                    accent: accent,
                    compact: true
                )

                GlassTouchFader(
                    title: "BRZINA FX",
                    valueText: String(format: "%.1f×", client.selectedPad.params.speed),
                    value: Binding(
                        get: { client.selectedPad.params.speed },
                        set: {
                            client.selectedPad.params.speed = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.3...3.5,
                    accent: .cyan,
                    compact: true
                )

                GlassTouchFader(
                    title: "TOPLA W",
                    valueText: "\(Int((client.selectedPad.white * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.white },
                        set: {
                            client.selectedPad.white = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.0...1.0,
                    accent: StudioTheme.warmWhiteAccent,
                    compact: true
                )
            }

            HStack(spacing: 8) {
                Button {
                    client.togglePlayPause()
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: client.isPlaying ? "pause.fill" : "play.fill")
                        Text(client.isPlaying ? "Pause" : "Play")
                    }
                    .font(.system(size: 12, weight: .heavy))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        client.isPlaying ? Color.green.opacity(0.24) : Color.white.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .foregroundStyle(client.isPlaying ? Color.green : Color.white)
                }
                .buttonStyle(.plain)

                Button(action: onOpenInspector) {
                    HStack(spacing: 8) {
                        Text(client.selectedPad.key)
                            .font(.system(size: 11.5, weight: .heavy, design: .monospaced))
                            .foregroundStyle(.black)
                            .frame(width: 24, height: 24)
                            .background(accent, in: RoundedRectangle(cornerRadius: 6))

                        VStack(alignment: .leading, spacing: 1) {
                            Text(client.selectedPad.name)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Text("\(client.selectedPad.preset.uppercased()) · \(client.selectedPad.mode.uppercased()) · \(client.selectedPad.bars.count)/9 barova")
                                .font(.system(size: 8.5, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)

                Button(action: onOpenInspector) {
                    HStack(spacing: 4) {
                        Image(systemName: "slider.horizontal.2.square")
                        Text("Uredi pad")
                    }
                    .font(.system(size: 11.5, weight: .heavy))
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .background(Color.cyan.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.cyan.opacity(0.35), lineWidth: 1))
                    .foregroundStyle(.cyan)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13).opacity(0.95), in: RoundedRectangle(cornerRadius: 15))
        .overlay(
            RoundedRectangle(cornerRadius: 15)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}
