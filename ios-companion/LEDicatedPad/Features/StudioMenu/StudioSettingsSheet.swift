import SwiftUI

public struct StudioSettingsSheet: View {
    @Bindable var client: StudioClient
    public var initialSection: String = "library"
    @Environment(\.dismiss) private var dismiss
    @State private var selectedSection: String = "library" // "library" | "stage" | "network"

    public init(client: StudioClient, initialSection: String = "library") {
        self.client = client
        self.initialSection = initialSection
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack(spacing: 4) {
                    sectionTab(id: "light", title: "Svjetlo", icon: "lightbulb.fill")
                    sectionTab(id: "library", title: "Show (\(client.libraryTracks.count))", icon: "music.note.list")
                    sectionTab(id: "stage", title: "Pozornica", icon: "light.panel.fill")
                    sectionTab(id: "network", title: "Mreža", icon: "wifi")
                }
                .padding(4)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 13))
                .padding(.horizontal, 16)
                .padding(.top, 6)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if selectedSection == "light" {
                            RoomLightSwitchCard(client: client)
                            widgetShortcutTipCard
                        } else if selectedSection == "network" {
                            NetworkDiagnosticsTab(client: client)
                            StageQuickSummaryCard(client: client)
                        } else if selectedSection == "stage" {
                            StageControlTab(client: client)
                        } else {
                            LibraryLauncherTab(client: client)
                        }
                    }
                    .padding(16)
                }
            }
            .background(StudioTheme.sheetBackgroundGradient)
            .navigationTitle("LEDicated Light Show & Meni")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Gotovo") { dismiss() }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.cyan)
                }
            }
            .onAppear {
                selectedSection = initialSection
                Task {
                    await client.fetchLibraryTracks()
                    if !client.isConnected {
                        await client.autoDiscoverStudio(switchOnFind: true)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var widgetShortcutTipCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("iOS WIDGET & PREČACI (BEZ OTVARANJA APLIKACIJE)", systemImage: "square.grid.2x2.fill")
                .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                .foregroundStyle(.cyan)

            Text("Prekidač 'Svjetlo ON/OFF' dostupan je kao iOS Widget na početnom ili zaključanom zaslonu, u Kontrolnom centru i na Action gumbu (putem aplikacije Prečaci / Shortcuts → LEDicated Pad). Radi izravno prema E8 kontroleru čak i kad je MacBook ugašen.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func sectionTab(id: String, title: String, icon: String) -> some View {
        let active = selectedSection == id
        return Button {
            withAnimation(.snappy(duration: 0.18)) {
                selectedSection = id
            }
            HapticsEngine.shared.tickSelection()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .bold))
                Text(title)
                    .font(.system(size: 11.5, weight: .heavy))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(
                active ? Color.cyan.opacity(0.24) : Color.clear,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(active ? Color.cyan.opacity(0.5) : Color.clear, lineWidth: 1)
            )
            .foregroundStyle(active ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }
}
