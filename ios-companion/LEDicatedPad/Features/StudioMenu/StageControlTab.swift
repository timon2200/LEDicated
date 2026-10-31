import SwiftUI

public struct StageQuickSummaryCard: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("BRZA KONTROLA POZORNICE")
                .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                .foregroundStyle(.secondary)

            GlassTouchFader(
                title: "MASTER SVJETLINA ZIDA (0 – 60%)",
                valueText: "\(Int(client.masterBrightness.rounded()))%",
                value: Binding(
                    get: { client.masterBrightness },
                    set: { client.setMasterBrightness($0) }
                ),
                range: 0...60,
                accent: .cyan
            )

            HStack(spacing: 8) {
                Button {
                    client.togglePlayPause()
                } label: {
                    Label(client.isPlaying ? "Pauziraj pjesmu" : "Pokreni pjesmu", systemImage: client.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Color.cyan.opacity(0.22), in: RoundedRectangle(cornerRadius: 11))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)

                Button {
                    client.stopAllPads()
                } label: {
                    Label("Ugasi aktivne padove", systemImage: "xmark.circle.fill")
                        .font(.system(size: 12, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Color.red.opacity(0.18), in: RoundedRectangle(cornerRadius: 11))
                        .foregroundStyle(Color(red: 1.0, green: 0.65, blue: 0.7))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }
}

public struct StageControlTab: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            RoomLightSwitchCard(client: client)

            StageQuickSummaryCard(client: client)

            VStack(alignment: .leading, spacing: 10) {
                Text("BRZI PRESETI SVJETLINE")
                    .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    brightnessPresetButton(label: "Ambijent (15%)", value: 15)
                    brightnessPresetButton(label: "Studio (35%)", value: 35)
                    brightnessPresetButton(label: "Klub Max (60%)", value: 60)
                }
            }
            .padding(14)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))

            VStack(alignment: .leading, spacing: 10) {
                Text("TRANSPORT & SIGURNOST")
                    .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Button {
                        client.seek(to: 0)
                    } label: {
                        Label("Od početka (0:00)", systemImage: "backward.end.fill")
                            .font(.system(size: 12, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                    }
                    .buttonStyle(.plain)

                    Button {
                        client.stopAllPads()
                    } label: {
                        Label("Ugasi sve padove", systemImage: "xmark.circle.fill")
                            .font(.system(size: 12, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(Color.orange.opacity(0.18), in: RoundedRectangle(cornerRadius: 11))
                            .foregroundStyle(.orange)
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    client.toggleBlackout()
                } label: {
                    HStack {
                        Image(systemName: "bolt.slash.fill")
                        Text(client.blackout ? "BLACKOUT JE AKTIVAN — DODIRNI ZA POVRATAK" : "HITNI BLACKOUT (UGASI SVE BAROVE)")
                    }
                    .font(.system(size: 12.5, weight: .black))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(client.blackout ? Color.red : Color.red.opacity(0.22), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.red.opacity(0.65), lineWidth: 1))
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        }
    }

    private func brightnessPresetButton(label: String, value: Double) -> some View {
        let active = Int(client.masterBrightness.rounded()) == Int(value)
        return Button {
            client.setMasterBrightness(value)
            HapticsEngine.shared.tickSelection()
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(active ? Color.cyan.opacity(0.24) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(active ? Color.cyan : Color.white.opacity(0.08), lineWidth: 1))
                .foregroundStyle(active ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }
}
