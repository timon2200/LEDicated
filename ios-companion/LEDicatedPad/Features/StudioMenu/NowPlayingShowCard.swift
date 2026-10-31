import SwiftUI

public struct NowPlayingShowCard: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    private func formatClock(_ sec: Double) -> String {
        let s = max(0, Int(sec.rounded(.down)))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }

    public var body: some View {
        let badgeColor: Color = client.isPlaying ? Color.green : Color.cyan
        let maxDur = max(10.0, client.durationSec)
        let currentPos = min(maxDur, max(0.0, client.frameStore.interpolatedPlayheadSec(isPlaying: client.isPlaying, durationSec: client.durationSec)))

        VStack(alignment: .leading, spacing: 12) {
            nowPlayingHeaderRow(badgeColor: badgeColor)

            GlassTouchFader(
                title: "POZICIJA U PJESMI",
                valueText: "\(formatClock(currentPos)) / \(formatClock(maxDur))",
                value: Binding(
                    get: { min(maxDur, max(0.0, client.frameStore.timeSec)) },
                    set: { client.seek(to: $0) }
                ),
                range: 0...maxDur,
                accent: badgeColor,
                compact: true
            )

            nowPlayingTransportButtons
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [badgeColor.opacity(0.14), Color(red: 0.05, green: 0.07, blue: 0.13)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(Color.cyan.opacity(0.38), lineWidth: 1.2)
        )
    }

    private func nowPlayingHeaderRow(badgeColor: Color) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(badgeColor)
                        .frame(width: 7, height: 7)
                    Text(client.isPlaying ? "AKTIVNI LIGHT SHOW SVIRA" : "ODABRANI LIGHT SHOW")
                        .font(.system(size: 10, weight: .black, design: .monospaced))
                        .foregroundStyle(badgeColor)
                    Text("· \(Int(client.bpm.rounded())) BPM")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                Text(client.trackTitle)
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }

            Spacer(minLength: 4)

            MiniStageMatrixView(client: client)
                .fixedSize()
        }
    }

    private var nowPlayingTransportButtons: some View {
        HStack(spacing: 8) {
            Button {
                client.restartShow()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "backward.end.fill")
                    Text("0:00")
                }
                .font(.system(size: 12.5, weight: .heavy, design: .monospaced))
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                .foregroundStyle(.white)
            }
            .buttonStyle(.plain)

            Button {
                client.togglePlayPause()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: client.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .black))
                    Text(client.isPlaying ? "PAUZIRAJ LIGHT SHOW" : "PUSTI LIGHT SHOW")
                        .font(.system(size: 13, weight: .black))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    client.isPlaying ? Color.green.opacity(0.28) : Color.cyan.opacity(0.28),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(client.isPlaying ? Color.green.opacity(0.75) : Color.cyan.opacity(0.75), lineWidth: 1.2)
                )
                .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
        }
    }
}
