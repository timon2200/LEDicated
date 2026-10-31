import SwiftUI

public struct PortraitTopStatusBar: View {
    @Bindable var client: StudioClient
    var onOpenMenu: (String) -> Void

    private var unifiedStatusColor: Color {
        if !client.isConnected {
            return client.isSearchingNetwork ? .cyan : Color(white: 0.55)
        }
        return client.isStageOwner ? .green : .yellow
    }

    private var unifiedStatusTitle: String {
        if !client.isConnected {
            return client.isSearchingNetwork ? "TRAŽIM MAC…" : "OFFLINE"
        }
        return client.isStageOwner ? "ON AIR" : "SOLO"
    }

    private var unifiedStatusIcon: String {
        if !client.isConnected {
            return client.isSearchingNetwork ? "dot.radiowaves.left.and.right" : "wifi.slash"
        }
        return client.isStageOwner ? "dot.radiowaves.left.and.right" : "headphones"
    }

    public var body: some View {
        HStack(spacing: 8) {
            Button {
                onOpenMenu("network")
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(unifiedStatusColor)
                        .frame(width: 8, height: 8)
                        .shadow(color: client.isConnected ? unifiedStatusColor : .clear, radius: 4)

                    Image(systemName: unifiedStatusIcon)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(unifiedStatusColor)

                    Text(unifiedStatusTitle)
                        .font(.system(size: 10.5, weight: .black, design: .monospaced))
                        .foregroundStyle(unifiedStatusColor)

                    Text(client.isConnected ? "· \(max(1, client.rttMs))ms" : "· Spoji")
                        .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(unifiedStatusColor.opacity(0.14), in: Capsule())
                .overlay(Capsule().strokeBorder(unifiedStatusColor.opacity(0.45), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .fixedSize()

            Spacer(minLength: 4)

            HStack(spacing: 6) {
                TopBarLightSwitchButton(client: client) {
                    onOpenMenu("light")
                }

                HudIconButton(
                    icon: "music.note.list",
                    active: false,
                    activeColor: .cyan
                ) {
                    onOpenMenu("library")
                }

                HudIconButton(
                    icon: "record.circle",
                    active: client.isRecordingSession,
                    activeColor: .red
                ) {
                    client.toggleRecordingSession()
                }

                HudIconButton(
                    icon: "gearshape.fill",
                    active: false,
                    activeColor: .cyan
                ) {
                    onOpenMenu("network")
                }

                Button {
                    client.toggleBlackout()
                } label: {
                    Image(systemName: "bolt.slash.fill")
                        .font(.system(size: 13.5, weight: .black))
                        .frame(width: 36, height: 34)
                        .background(
                            client.blackout ? Color.red : Color.red.opacity(0.22),
                            in: RoundedRectangle(cornerRadius: 9)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 9)
                                .strokeBorder(Color.red.opacity(0.7), lineWidth: 1.2)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
            .fixedSize()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13).opacity(0.92), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

public struct PortraitMacroStrip: View {
    @Bindable var client: StudioClient
    @Binding var surfaceMode: String

    public var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                surfaceTabButton(title: "PADOVI", icon: "square.grid.3x2.fill", mode: "pads")
                surfaceTabButton(title: "XY", icon: "scope", mode: "xy")
            }
            .padding(2)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
            .fixedSize()

            Spacer(minLength: 2)

            HudIconButton(icon: "metronome.fill", active: client.quantize, activeColor: .cyan) {
                client.toggleQuantize()
            }
            HudIconButton(icon: "lock.fill", active: client.holdLatchMode, activeColor: .cyan) {
                client.toggleHoldLatch()
            }
            HudIconButton(icon: "slider.horizontal.2.square", active: client.inspectorOnTapMode, activeColor: .cyan) {
                client.inspectorOnTapMode.toggle()
                HapticsEngine.shared.tickSelection()
            }
            HudIconButton(icon: "xmark.octagon.fill", active: !client.activePads.isEmpty, activeColor: .orange) {
                client.stopAllPads()
            }
        }
    }

    private func surfaceTabButton(title: String, icon: String, mode: String) -> some View {
        let active = surfaceMode == mode
        return Button {
            withAnimation(.snappy(duration: 0.18)) {
                surfaceMode = mode
            }
            HapticsEngine.shared.tickSelection()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .bold))
                Text(title)
                    .font(.system(size: 9.5, weight: .heavy))
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(active ? Color.cyan.opacity(0.24) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
            .foregroundStyle(active ? Color.cyan : Color.secondary)
        }
        .buttonStyle(.plain)
        .fixedSize()
    }
}
