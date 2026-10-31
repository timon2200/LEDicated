import SwiftUI

public struct PadInspectorPresetsAndColors: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            presetsCard
            colorsAndDriverCard
        }
    }

    private var presetsCard: some View {
        let accent = client.selectedPad.swiftUIColor
        return VStack(alignment: .leading, spacing: 10) {
            inspectorSectionHeader(title: "SVJETLOSNI EFEKT (16 PRESETA)", icon: "sparkles")

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(EffectPreset.allCases) { preset in
                    presetCell(preset: preset, accent: accent)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func presetCell(preset: EffectPreset, accent: Color) -> some View {
        let isSelected = !client.selectedPad.isEmpty && client.selectedPad.preset == preset.rawValue
        return Button {
            let wasEmpty = client.selectedPad.isEmpty
            let prevPresetLabel = EffectPreset(rawValue: client.selectedPad.preset)?.label ?? ""
            client.selectedPad.isEmpty = false
            client.selectedPad.preset = preset.rawValue
            if wasEmpty || client.selectedPad.name == "Prazno" || client.selectedPad.name == prevPresetLabel {
                client.selectedPad.name = preset.label
            }
            if wasEmpty {
                client.selectedPad.color = [0.0, 0.95, 1.0]
            }
            HapticsEngine.shared.tickSelection()
            client.syncPadToServer(index: client.selectedPadIndex)
        } label: {
            VStack(spacing: 5) {
                Image(systemName: preset.sfSymbol)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(isSelected ? accent : Color.secondary)
                Text(preset.label)
                    .font(.system(size: 10, weight: .bold))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                isSelected ? accent.opacity(0.22) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 11)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(isSelected ? accent : Color.white.opacity(0.08), lineWidth: 1.2)
            )
            .foregroundStyle(isSelected ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private var colorsAndDriverCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            inspectorSectionHeader(title: "PALETA BOJA I AUDIO DRIVER", icon: "paintpalette.fill")

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(0..<StudioTheme.colorSwatches.count, id: \.self) { idx in
                    swatchCell(idx: idx)
                }
            }

            HStack(spacing: 6) {
                ForEach(AudioDriver.allCases) { drv in
                    driverButton(drv: drv)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func swatchCell(idx: Int) -> some View {
        let swatch = StudioTheme.colorSwatches[idx]
        let cA = Color(red: swatch.primary[0], green: swatch.primary[1], blue: swatch.primary[2])
        let cB = Color(red: swatch.secondary[0], green: swatch.secondary[1], blue: swatch.secondary[2])
        return Button {
            client.selectedPad.color = swatch.primary
            client.selectedPad.colorSecondary = swatch.secondary
            HapticsEngine.shared.tickSelection()
            client.syncPadToServer(index: client.selectedPadIndex)
        } label: {
            VStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(LinearGradient(colors: [cA, cB], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(height: 26)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.white.opacity(0.28), lineWidth: 1)
                    )
                Text(swatch.name)
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }

    private func driverButton(drv: AudioDriver) -> some View {
        let selected = client.selectedPad.driver == drv.rawValue
        return Button {
            client.selectedPad.driver = drv.rawValue
            HapticsEngine.shared.tickSelection()
            client.syncPadToServer(index: client.selectedPadIndex)
        } label: {
            VStack(spacing: 3) {
                Image(systemName: drv.icon)
                    .font(.system(size: 11, weight: .bold))
                Text(drv.label)
                    .font(.system(size: 10, weight: .bold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                selected ? Color.cyan.opacity(0.24) : Color.white.opacity(0.05),
                in: RoundedRectangle(cornerRadius: 9)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(selected ? Color.cyan : Color.white.opacity(0.08), lineWidth: 1)
            )
            .foregroundStyle(selected ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }
}
