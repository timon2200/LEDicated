import SwiftUI

public struct LandscapeHudBar: View {
    @Bindable var client: StudioClient
    @Binding var surfaceMode: String
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
        HStack(spacing: 10) {
            // Left Module: [Status + Song Stack] + [3x3 Bars Preview on the right]
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Button {
                            onOpenMenu("network")
                        } label: {
                            HStack(spacing: 5) {
                                Circle()
                                    .fill(unifiedStatusColor)
                                    .frame(width: 7, height: 7)
                                    .shadow(color: client.isConnected ? unifiedStatusColor : .clear, radius: 4)

                                Image(systemName: unifiedStatusIcon)
                                    .font(.system(size: 10, weight: .bold))

                                Text(unifiedStatusTitle)
                                    .font(.system(size: 10, weight: .black, design: .monospaced))

                                if client.isConnected {
                                    Text("· \(max(1, client.rttMs))ms")
                                        .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(Color.white.opacity(0.75))
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(unifiedStatusColor.opacity(0.16), in: Capsule())
                            .overlay(Capsule().strokeBorder(unifiedStatusColor.opacity(0.45), lineWidth: 1))
                            .foregroundStyle(unifiedStatusColor)
                        }
                        .buttonStyle(.plain)
                        .fixedSize()

                        Text("\(Int(client.bpm.rounded())) BPM")
                            .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }

                    Button {
                        onOpenMenu("library")
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: client.isPlaying ? "play.fill" : "music.note.list")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(client.isPlaying ? Color.green : Color.cyan)
                            Text(client.trackTitle)
                                .font(.system(size: 11.5, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .truncationMode(.tail)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .heavy))
                                .foregroundStyle(Color.cyan.opacity(0.85))
                        }
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    onOpenMenu("stage")
                } label: {
                    MiniStageMatrixView(client: client)
                }
                .buttonStyle(.plain)
                .fixedSize()
            }

            Spacer(minLength: 6)

            // Right Module: Clean Hardware Icon Buttons
            HStack(spacing: 6) {
                TopBarLightSwitchButton(client: client) {
                    onOpenMenu("light")
                }

                HStack(spacing: 2) {
                    hudModeIconButton(icon: "square.grid.3x2.fill", mode: "pads")
                    hudModeIconButton(icon: "scope", mode: "xy")
                }
                .padding(2)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
                .fixedSize()

                HudIconButton(
                    icon: client.isPlaying ? "pause.fill" : "play.fill",
                    active: client.isPlaying,
                    activeColor: .green
                ) {
                    client.togglePlayPause()
                }

                HudIconButton(
                    icon: "music.note.list",
                    active: false,
                    activeColor: .cyan
                ) {
                    onOpenMenu("library")
                }

                HudIconButton(
                    icon: "metronome.fill",
                    active: client.quantize,
                    activeColor: .cyan
                ) {
                    client.toggleQuantize()
                }

                HudIconButton(
                    icon: "lock.fill",
                    active: client.holdLatchMode,
                    activeColor: .cyan
                ) {
                    client.toggleHoldLatch()
                }

                HudIconButton(
                    icon: "slider.horizontal.2.square",
                    active: client.inspectorOnTapMode,
                    activeColor: .cyan
                ) {
                    client.inspectorOnTapMode.toggle()
                    HapticsEngine.shared.tickSelection()
                }

                HudIconButton(
                    icon: "xmark.octagon.fill",
                    active: !client.activePads.isEmpty,
                    activeColor: .orange
                ) {
                    client.stopAllPads()
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
                        .shadow(color: client.blackout ? Color.red.opacity(0.7) : .clear, radius: 6)
                }
                .buttonStyle(.plain)
                .fixedSize()
            }
            .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color(red: 0.05, green: 0.07, blue: 0.12).opacity(0.94), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.09), lineWidth: 1)
        )
    }

    private func hudModeIconButton(icon: String, mode: String) -> some View {
        let active = surfaceMode == mode
        return Button {
            withAnimation(.snappy(duration: 0.18)) {
                surfaceMode = mode
            }
            HapticsEngine.shared.tickSelection()
        } label: {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .frame(width: 30, height: 30)
                .background(active ? Color.cyan.opacity(0.24) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                .foregroundStyle(active ? Color.cyan : Color.secondary)
        }
        .buttonStyle(.plain)
    }
}
