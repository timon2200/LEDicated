import SwiftUI

public struct TopBarLightSwitchButton: View {
    @Bindable var client: StudioClient
    var onOpenLightMenu: () -> Void

    public init(client: StudioClient, onOpenLightMenu: @escaping () -> Void) {
        self.client = client
        self.onOpenLightMenu = onOpenLightMenu
    }

    private var isLightOn: Bool {
        client.roomLight.isOn && !client.roomLight.isLiveDdpActive
    }

    private var bulbTint: Color {
        if isLightOn {
            return ColorTempMath.previewColor(for: client.roomLight.kelvin)
        }
        return Color(white: 0.78)
    }

    private var pillBackground: Color {
        if isLightOn {
            return Color(red: 0.98, green: 0.76, blue: 0.28).opacity(0.24)
        }
        return Color.white.opacity(0.08)
    }

    private var pillBorder: Color {
        if isLightOn {
            return Color(red: 0.98, green: 0.78, blue: 0.35).opacity(0.68)
        }
        return Color.white.opacity(0.14)
    }

    public var body: some View {
        HStack(spacing: 0) {
            Button {
                client.roomLight.togglePower(studioHost: client.studioHost)
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: isLightOn ? "lightbulb.fill" : "lightbulb")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(bulbTint)
                        .shadow(color: isLightOn ? bulbTint.opacity(0.75) : .clear, radius: 5)

                    Text(isLightOn ? "ON" : "OFF")
                        .font(.system(size: 9.5, weight: .black, design: .monospaced))
                        .foregroundStyle(isLightOn ? Color.white : Color.secondary)
                }
                .padding(.leading, 9)
                .padding(.trailing, 6)
                .frame(height: 34)
            }
            .buttonStyle(.plain)

            Button {
                onOpenLightMenu()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 8.5, weight: .heavy))
                    .foregroundStyle(isLightOn ? Color.white.opacity(0.85) : Color.secondary)
                    .frame(width: 20, height: 34)
            }
            .buttonStyle(.plain)
        }
        .background(pillBackground, in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .strokeBorder(pillBorder, lineWidth: 1.1)
        )
    }
}

public struct RoomLightSwitchCard: View {
    @Bindable var client: StudioClient

    public init(client: StudioClient) {
        self.client = client
    }

    private var room: RoomLightController {
        client.roomLight
    }

    private var isStaticLightOn: Bool {
        room.isOn && !room.isLiveDdpActive
    }

    private var accentColor: Color {
        ColorTempMath.previewColor(for: room.kelvin)
    }

    private var wattsString: String {
        if room.currentWatts >= 15 {
            return String(format: "%.0f W", room.currentWatts)
        }
        return String(format: "%.1f W", room.currentWatts)
    }

    private var heroBackgroundGradient: LinearGradient {
        if isStaticLightOn {
            return LinearGradient(
                colors: [
                    accentColor.opacity(0.28),
                    Color(red: 0.14, green: 0.16, blue: 0.24).opacity(0.85)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        return LinearGradient(
            colors: [
                Color.white.opacity(0.06),
                Color.white.opacity(0.03)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            headerRow
            heroPowerSwitchButton
            slidersCard
            presetsCard
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(isStaticLightOn ? accentColor.opacity(0.42) : Color.white.opacity(0.08), lineWidth: 1)
        )
        .task {
            await client.roomLight.pollDirectE8()
        }
    }

    private var headerRow: some View {
        HStack {
            HStack(spacing: 6) {
                Circle()
                    .fill(isStaticLightOn ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                Text("UREDSKA RASVJETA (SVJETLO)")
                    .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 4) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(isStaticLightOn ? Color.yellow : Color.secondary)
                Text(wattsString)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(isStaticLightOn ? Color.white : Color.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.07), in: Capsule())
        }
    }

    private var heroPowerSwitchButton: some View {
        Button {
            room.togglePower(studioHost: client.studioHost)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isStaticLightOn ? accentColor : Color.white.opacity(0.1))
                        .frame(width: 44, height: 44)
                        .shadow(color: isStaticLightOn ? accentColor.opacity(0.65) : .clear, radius: 10)

                    Image(systemName: isStaticLightOn ? "lightbulb.fill" : "lightbulb.slash")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(isStaticLightOn ? Color.black.opacity(0.85) : Color.white.opacity(0.65))
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(isStaticLightOn ? "Svjetlo je uključeno" : "Svjetlo je ugašeno")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)

                    Text(room.statusSubtitle)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                roomSwitchPill
            }
            .padding(12)
            .background(heroBackgroundGradient, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(isStaticLightOn ? accentColor.opacity(0.55) : Color.white.opacity(0.1), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var roomSwitchPill: some View {
        ZStack(alignment: isStaticLightOn ? .trailing : .leading) {
            Capsule()
                .fill(isStaticLightOn ? Color.green : Color.white.opacity(0.16))
                .frame(width: 50, height: 29)

            Circle()
                .fill(Color.white)
                .frame(width: 23, height: 23)
                .padding(.horizontal, 3)
                .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
        }
        .animation(.spring(response: 0.22, dampingFraction: 0.78), value: isStaticLightOn)
    }

    private var slidersCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Label("Svjetlina", systemImage: "sun.max.fill")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(room.brightnessPercent)%")
                        .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                }

                Slider(
                    value: Binding(
                        get: { room.brightness },
                        set: { room.updateBrightness($0, isDragging: true, studioHost: client.studioHost) }
                    ),
                    in: 3...255
                ) { editing in
                    if !editing {
                        room.updateBrightness(room.brightness, isDragging: false, studioHost: client.studioHost)
                    }
                }
                .tint(accentColor)
            }

            Divider().background(Color.white.opacity(0.08))

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Label("Toplina bijele", systemImage: "thermometer.sun.fill")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(ColorTempMath.labelForKelvin(room.kelvin))
                        .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(accentColor)
                }

                Slider(
                    value: Binding(
                        get: { room.kelvin },
                        set: { room.updateKelvin($0, isDragging: true, studioHost: client.studioHost) }
                    ),
                    in: 2700...6500,
                    step: 50
                ) { editing in
                    if !editing {
                        room.updateKelvin(room.kelvin, isDragging: false, studioHost: client.studioHost)
                    }
                }
                .tint(accentColor)
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 13))
    }

    private var presetsCard: some View {
        HStack(spacing: 7) {
            ForEach(RoomLightPreset.allCases) { preset in
                presetButton(preset)
            }
        }
    }

    private func presetButton(_ preset: RoomLightPreset) -> some View {
        let isSelected = isStaticLightOn
            && abs(room.kelvin - preset.kelvin) < 120
            && abs(room.brightness - preset.brightness) < 18
        let pColor = ColorTempMath.previewColor(for: preset.kelvin)

        return Button {
            room.applyPreset(preset, studioHost: client.studioHost)
        } label: {
            VStack(spacing: 3) {
                Circle()
                    .fill(pColor)
                    .frame(width: 10, height: 10)
                    .shadow(color: pColor.opacity(0.6), radius: 3)
                Text(preset.title)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                Text(preset.subtitle)
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                isSelected ? pColor.opacity(0.22) : Color.white.opacity(0.05),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(isSelected ? pColor.opacity(0.75) : Color.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
