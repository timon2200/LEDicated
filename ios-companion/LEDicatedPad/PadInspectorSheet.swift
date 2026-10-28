import SwiftUI

public struct PadInspectorSheet: View {
    @Bindable var client: StudioClient
    @Environment(\.dismiss) private var dismiss

    private let colorSwatches: [([Double], [Double])] = [
        ([0.0, 0.95, 1.0], [0.22, 0.74, 0.98]),
        ([1.0, 0.18, 0.58], [0.66, 0.33, 0.97]),
        ([1.0, 0.72, 0.0], [1.0, 0.33, 0.0]),
        ([0.06, 0.73, 0.51], [0.0, 0.95, 1.0]),
        ([1.0, 1.0, 1.0], [1.0, 0.85, 0.65]),
        ([0.39, 0.40, 0.95], [0.93, 0.28, 0.60]),
        ([0.94, 0.27, 0.27], [0.96, 0.62, 0.04]),
        ([0.66, 0.33, 0.97], [0.0, 0.95, 1.0])
    ]

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Pad Name & Mode
                    VStack(alignment: .leading, spacing: 10) {
                        Text("NAZIV I NAČIN OKIDANJA")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        TextField("Naziv pada", text: Binding(
                            get: { client.selectedPad.name },
                            set: {
                                client.selectedPad.name = $0
                                client.syncPadToServer(index: client.selectedPadIndex)
                            }
                        ))
                        .padding(11)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 11))
                        .foregroundStyle(.white)

                        Picker("Način", selection: Binding(
                            get: { client.selectedPad.mode },
                            set: {
                                client.selectedPad.mode = $0
                                HapticsEngine.shared.tickSelection()
                                client.syncPadToServer(index: client.selectedPadIndex)
                            }
                        )) {
                            Text("⚡ HIT (Drži / Bljesak)").tag("hit")
                            Text("🔁 LOOP (Prekidač)").tag("loop")
                        }
                        .pickerStyle(.segmented)
                    }

                    // 3x3 Target Bars Matrix
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("CILJANI BAROVI (3 × 3 MATRICA)")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Svi (9)") {
                                client.setBarsForSelectedPad(BarID.allCases.map(\.rawValue))
                            }
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.cyan)
                        }

                        HStack(spacing: 6) {
                            quickZoneButton("Gornji", bars: ["L1", "C1", "R1"])
                            quickZoneButton("Sredina", bars: ["L2", "C2", "R2"])
                            quickZoneButton("Donji", bars: ["L3", "C3", "R3"])
                            quickZoneButton("Stupac C", bars: ["C1", "C2", "C3"])
                            quickZoneButton("Vanjski L+R", bars: ["L1", "L2", "L3", "R1", "R2", "R3"])
                        }

                        let activeBars = Set(client.selectedPad.bars.isEmpty ? BarID.allCases.map(\.rawValue) : client.selectedPad.bars)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                            ForEach(BarID.allCases) { bar in
                                let selected = activeBars.contains(bar.rawValue)
                                Button {
                                    client.toggleBarForSelectedPad(bar.rawValue)
                                } label: {
                                    HStack {
                                        Text(bar.rawValue)
                                            .font(.system(size: 13, weight: .heavy, design: .monospaced))
                                        Spacer()
                                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                            .font(.system(size: 13))
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 10)
                                    .background(
                                        selected ? Color.cyan.opacity(0.24) : Color.white.opacity(0.05),
                                        in: RoundedRectangle(cornerRadius: 10)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .strokeBorder(selected ? Color.cyan : Color.white.opacity(0.1), lineWidth: 1)
                                    )
                                    .foregroundStyle(selected ? .white : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // 16 Lighting Presets
                    VStack(alignment: .leading, spacing: 10) {
                        Text("SVJETLOSNI EFEKT (16 PRESETA)")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 7), count: 4), spacing: 7) {
                            ForEach(EffectPreset.allCases) { preset in
                                let isSelected = client.selectedPad.preset == preset.rawValue
                                Button {
                                    client.selectedPad.preset = preset.rawValue
                                    HapticsEngine.shared.tickSelection()
                                    client.syncPadToServer(index: client.selectedPadIndex)
                                } label: {
                                    VStack(spacing: 4) {
                                        Image(systemName: preset.sfSymbol)
                                            .font(.system(size: 14, weight: .bold))
                                        Text(preset.label)
                                            .font(.system(size: 10, weight: .bold))
                                            .lineLimit(1)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 9)
                                    .background(
                                        isSelected ? Color.cyan.opacity(0.24) : Color.white.opacity(0.05),
                                        in: RoundedRectangle(cornerRadius: 10)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .strokeBorder(isSelected ? Color.cyan : Color.white.opacity(0.09), lineWidth: 1)
                                    )
                                    .foregroundStyle(isSelected ? .white : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // RGBW Color Swatches
                    VStack(alignment: .leading, spacing: 10) {
                        Text("RGBW PALETA BOJA")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                            ForEach(0..<colorSwatches.count, id: \.self) { idx in
                                let pair = colorSwatches[idx]
                                let cA = Color(red: pair.0[0], green: pair.0[1], blue: pair.0[2])
                                let cB = Color(red: pair.1[0], green: pair.1[1], blue: pair.1[2])
                                Button {
                                    client.selectedPad.color = pair.0
                                    client.selectedPad.colorSecondary = pair.1
                                    HapticsEngine.shared.tickSelection()
                                    client.syncPadToServer(index: client.selectedPadIndex)
                                } label: {
                                    RoundedRectangle(cornerRadius: 9)
                                        .fill(LinearGradient(colors: [cA, cB], startPoint: .topLeading, endPoint: .bottomTrailing))
                                        .frame(height: 30)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 9)
                                                .strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Audio Stem Driver & Hit Duration
                    VStack(alignment: .leading, spacing: 10) {
                        Text("AUDIO STEM DRIVER & TRAJANJE")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        HStack(spacing: 6) {
                            ForEach(AudioDriver.allCases) { drv in
                                let selected = client.selectedPad.driver == drv.rawValue
                                Button {
                                    client.selectedPad.driver = drv.rawValue
                                    HapticsEngine.shared.tickSelection()
                                    client.syncPadToServer(index: client.selectedPadIndex)
                                } label: {
                                    Text(drv.label)
                                        .font(.system(size: 11, weight: .bold))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(
                                            selected ? Color.cyan.opacity(0.24) : Color.white.opacity(0.05),
                                            in: RoundedRectangle(cornerRadius: 8)
                                        )
                                        .foregroundStyle(selected ? .white : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Trajanje HIT bljeska")
                                    .font(.system(size: 12, weight: .semibold))
                                Spacer()
                                Text(String(format: "%.2f s", client.selectedPad.duration))
                                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                                    .foregroundStyle(.cyan)
                            }
                            Slider(
                                value: Binding(
                                    get: { client.selectedPad.duration },
                                    set: {
                                        client.selectedPad.duration = $0
                                        client.syncPadToServer(index: client.selectedPadIndex)
                                    }
                                ),
                                in: 0.2...3.0
                            )
                            .tint(.cyan)
                        }
                    }
                }
                .padding(16)
            }
            .background(Color(red: 0.05, green: 0.07, blue: 0.11).ignoresSafeArea())
            .navigationTitle("Pad \(client.selectedPad.key) · \(client.selectedPad.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("⚡ Test") {
                        client.pressPad(client.selectedPadIndex)
                    }
                    .foregroundStyle(.cyan)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Gotovo") {
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func quickZoneButton(_ title: String, bars: [String]) -> some View {
        Button {
            client.setBarsForSelectedPad(bars)
        } label: {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 7))
                .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
    }
}
