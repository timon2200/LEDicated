import SwiftUI

public struct PadInspectorSheet: View {
    @Bindable var client: StudioClient
    @Environment(\.dismiss) private var dismiss

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    heroPreviewCard
                    parametersCard
                    targetBarsCard
                    PadInspectorPresetsAndColors(client: client)
                }
                .padding(16)
            }
            .background(StudioTheme.sheetBackgroundGradient)
            .navigationTitle("Uredi Pad [\(client.selectedPad.key)]")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Gotovo") { dismiss() }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.cyan)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - 1. Hero Preview & Mode Card

    private var heroPreviewCard: some View {
        let accent = client.selectedPad.swiftUIColor
        let secondary = client.selectedPad.swiftUISecondaryColor

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(client.selectedPad.key)
                    .font(.system(size: 18, weight: .black, design: .monospaced))
                    .foregroundStyle(.black)
                    .frame(width: 42, height: 42)
                    .background(
                        LinearGradient(colors: [accent, secondary], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                    .shadow(color: accent.opacity(0.6), radius: 8)

                VStack(alignment: .leading, spacing: 4) {
                    Text("NAZIV PADA")
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(.secondary)

                    TextField("Naziv pada", text: Binding(
                        get: { client.selectedPad.name },
                        set: {
                            client.selectedPad.name = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ))
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(.white)
                }

                Spacer()

                Button { client.pressPad(client.selectedPadIndex) } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "bolt.fill")
                        Text("Test")
                    }
                    .font(.system(size: 12, weight: .heavy))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(accent.opacity(0.24), in: Capsule())
                    .overlay(Capsule().strokeBorder(accent, lineWidth: 1))
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 8) {
                modeOptionButton(title: "⚡ HIT (Bljesak / Drži)", subtitle: "Okida jednokratno ili dok držiš prst", modeValue: "hit", accent: accent)
                modeOptionButton(title: "🔁 LOOP (Prekidač)", subtitle: "Ostaje upaljeno u petlji do idućeg dodira", modeValue: "loop", accent: .cyan)
            }
        }
        .padding(14)
        .background(
            LinearGradient(colors: [accent.opacity(0.16), Color(red: 0.07, green: 0.09, blue: 0.15)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(accent.opacity(0.35), lineWidth: 1))
    }

    // MARK: - 2. Expressive Parameters Card

    private var parametersCard: some View {
        let accent = client.selectedPad.swiftUIColor
        return VStack(alignment: .leading, spacing: 10) {
            inspectorSectionHeader(title: "PARAMETRI EFEKTA", icon: "slider.horizontal.3")

            VStack(spacing: 8) {
                GlassTouchFader(
                    title: "INTENZITET SVJETLA",
                    valueText: "\(Int((client.selectedPad.intensity * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.intensity },
                        set: {
                            client.selectedPad.intensity = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.15...1.0,
                    accent: accent
                )

                GlassTouchFader(
                    title: "BRZINA ANIMACIJE",
                    valueText: String(format: "%.1f×", client.selectedPad.params.speed),
                    value: Binding(
                        get: { client.selectedPad.params.speed },
                        set: {
                            client.selectedPad.params.speed = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.3...3.5,
                    accent: .cyan
                )

                GlassTouchFader(
                    title: "TOPLA BIJELA (W KANAL)",
                    valueText: "\(Int((client.selectedPad.white * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.white },
                        set: {
                            client.selectedPad.white = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.0...1.0,
                    accent: StudioTheme.warmWhiteAccent
                )

                if !client.selectedPad.isLoop {
                    GlassTouchFader(
                        title: "TRAJANJE HIT BLJESKA",
                        valueText: String(format: "%.2f s", client.selectedPad.duration),
                        value: Binding(
                            get: { client.selectedPad.duration },
                            set: {
                                client.selectedPad.duration = $0
                                client.syncPadToServer(index: client.selectedPadIndex)
                            }
                        ),
                        range: 0.2...3.0,
                        accent: .orange
                    )
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    // MARK: - 3. Target Bars Matrix Card

    private var targetBarsCard: some View {
        let activeBars = Set(client.selectedPad.bars.isEmpty ? BarID.allRawIds : client.selectedPad.bars)
        let accent = client.selectedPad.swiftUIColor

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                inspectorSectionHeader(title: "CILJANI BAROVI (3 × 3 POZORNICA)", icon: "square.grid.3x3.fill")
                Spacer()
                Text("\(activeBars.count)/9 aktivno")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(.cyan)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(ZonePreset.allPresets) { preset in
                        zonePresetButton(preset: preset, activeBars: activeBars)
                    }
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(BarID.allCases) { bar in
                    barToggleCell(bar: bar, selected: activeBars.contains(bar.rawValue), accent: accent)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func zonePresetButton(preset: ZonePreset, activeBars: Set<String>) -> some View {
        let isMatch = activeBars == Set(preset.bars)
        return Button {
            client.setBarsForSelectedPad(preset.bars)
        } label: {
            HStack(spacing: 6) {
                ZoneMiniGridIcon(activeBars: Set(preset.bars), accent: isMatch ? .cyan : .white)
                Text(preset.label)
                    .font(.system(size: 11, weight: .bold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                isMatch ? Color.cyan.opacity(0.24) : Color.white.opacity(0.06),
                in: RoundedRectangle(cornerRadius: 9)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(isMatch ? Color.cyan : Color.white.opacity(0.1), lineWidth: 1)
            )
            .foregroundStyle(isMatch ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private func barToggleCell(bar: BarID, selected: Bool, accent: Color) -> some View {
        Button {
            client.toggleBarForSelectedPad(bar.rawValue)
        } label: {
            HStack {
                Text(bar.rawValue)
                    .font(.system(size: 13, weight: .heavy, design: .monospaced))
                Spacer()
                Circle()
                    .fill(selected ? accent : Color.white.opacity(0.15))
                    .frame(width: 9, height: 9)
                    .shadow(color: selected ? accent : .clear, radius: 4)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                selected ? accent.opacity(0.22) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 11)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(selected ? accent : Color.white.opacity(0.09), lineWidth: 1.2)
            )
            .foregroundStyle(selected ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private func modeOptionButton(title: String, subtitle: String, modeValue: String, accent: Color) -> some View {
        let selected = client.selectedPad.mode == modeValue
        return Button {
            client.selectedPad.mode = modeValue
            HapticsEngine.shared.tickSelection()
            client.syncPadToServer(index: client.selectedPadIndex)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11.5, weight: .heavy))
                    .foregroundStyle(selected ? Color.white : Color.secondary)
                Text(subtitle)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(
                selected ? accent.opacity(0.24) : Color.black.opacity(0.28),
                in: RoundedRectangle(cornerRadius: 11)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(selected ? accent : Color.white.opacity(0.08), lineWidth: 1.2)
            )
        }
        .buttonStyle(.plain)
    }
}

internal func inspectorSectionHeader(title: String, icon: String) -> some View {
    HStack(spacing: 6) {
        Image(systemName: icon)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.cyan)
        Text(title)
            .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
            .foregroundStyle(.secondary)
    }
}
