import Foundation
import AppIntents
import SwiftUI

public struct ToggleRoomLightIntent: AppIntent {
    public static var title: LocalizedStringResource = "Prekidač za svjetlo (ON/OFF)"
    public static var description = IntentDescription("Uključi ili ugasi LEDicated uredsku rasvjetu jednim dodirom.")
    public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let current = RoomLightNetworkHelper.savedState()
        let nextOn: Bool
        if let live = await RoomLightNetworkHelper.fetchDirectE8State(e8Host: current.e8Host),
           let e8On = live["on"] as? Bool,
           let isDdp = live["live"] as? Bool {
            nextOn = isDdp ? true : !e8On
        } else {
            nextOn = !current.isOn
        }
        let bri = nextOn && current.brightness < 15 ? 204.0 : current.brightness
        _ = await RoomLightNetworkHelper.sendLightState(
            isOn: nextOn,
            brightness: bri,
            kelvin: current.kelvin,
            studioHost: current.studioHost,
            saveToFlash: true
        )
        await MainActor.run {
            RoomLightController.shared.isOn = nextOn
            RoomLightController.shared.brightness = bri
            RoomLightController.shared.isLiveDdpActive = false
        }
        let msg = nextOn ? "Svjetlo uključeno" : "Svjetlo ugašeno"
        return .result(dialog: IntentDialog(stringLiteral: msg))
    }
}

public struct TurnOnRoomLightIntent: AppIntent {
    public static var title: LocalizedStringResource = "Upali svjetlo"
    public static var description = IntentDescription("Uključi statičko uredsko svjetlo na E8 kontroleru.")
    public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let current = RoomLightNetworkHelper.savedState()
        let bri = current.brightness < 15 ? 204.0 : current.brightness
        _ = await RoomLightNetworkHelper.sendLightState(
            isOn: true,
            brightness: bri,
            kelvin: current.kelvin,
            studioHost: current.studioHost,
            saveToFlash: true
        )
        await MainActor.run {
            RoomLightController.shared.isOn = true
            RoomLightController.shared.brightness = bri
            RoomLightController.shared.isLiveDdpActive = false
        }
        return .result(dialog: "Svjetlo je uključeno.")
    }
}

public struct TurnOffRoomLightIntent: AppIntent {
    public static var title: LocalizedStringResource = "Ugasi svjetlo"
    public static var description = IntentDescription("Ugasi LEDicated uredsku rasvjetu.")
    public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let current = RoomLightNetworkHelper.savedState()
        _ = await RoomLightNetworkHelper.sendLightState(
            isOn: false,
            brightness: current.brightness,
            kelvin: current.kelvin,
            studioHost: current.studioHost,
            saveToFlash: true
        )
        await MainActor.run {
            RoomLightController.shared.isOn = false
            RoomLightController.shared.isLiveDdpActive = false
        }
        return .result(dialog: "Svjetlo je ugašeno.")
    }
}

public struct SetWarmRoomLightIntent: AppIntent {
    public static var title: LocalizedStringResource = "Toplo svjetlo (2700K)"
    public static var description = IntentDescription("Postavi toplu bijelu uredsku rasvjetu (2700K, 70%).")
    public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let current = RoomLightNetworkHelper.savedState()
        _ = await RoomLightNetworkHelper.sendLightState(
            isOn: true,
            brightness: 178,
            kelvin: 2700,
            studioHost: current.studioHost,
            saveToFlash: true
        )
        await MainActor.run {
            RoomLightController.shared.isOn = true
            RoomLightController.shared.brightness = 178
            RoomLightController.shared.kelvin = 2700
            RoomLightController.shared.isLiveDdpActive = false
        }
        return .result(dialog: "Postavljeno toplo svjetlo (2700K).")
    }
}

public struct SetFullPowerRoomLightIntent: AppIntent {
    public static var title: LocalizedStringResource = "Puna rasvjeta (4800K MAX)"
    public static var description = IntentDescription("Uključi punu snagu svih RGBW čipova (4800K, 100%).")
    public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let current = RoomLightNetworkHelper.savedState()
        _ = await RoomLightNetworkHelper.sendLightState(
            isOn: true,
            brightness: 255,
            kelvin: 4800,
            studioHost: current.studioHost,
            saveToFlash: true
        )
        await MainActor.run {
            RoomLightController.shared.isOn = true
            RoomLightController.shared.brightness = 255
            RoomLightController.shared.kelvin = 4800
            RoomLightController.shared.isLiveDdpActive = false
        }
        return .result(dialog: "Uključena puna snaga rasvjete.")
    }
}

public struct LEDicatedShortcutsProvider: AppShortcutsProvider {
    public static var shortcutTileColor: ShortcutTileColor = .yellow

    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ToggleRoomLightIntent(),
            phrases: [
                "Prebaci svjetlo u \(.applicationName)",
                "Upali ili ugasi svjetlo u \(.applicationName)",
                "Toggle light in \(.applicationName)"
            ],
            shortTitle: "Svjetlo ON/OFF",
            systemImageName: "lightbulb.fill"
        )
        AppShortcut(
            intent: TurnOnRoomLightIntent(),
            phrases: [
                "Upali svjetlo u \(.applicationName)",
                "Turn on light in \(.applicationName)"
            ],
            shortTitle: "Upali svjetlo",
            systemImageName: "sun.max.fill"
        )
        AppShortcut(
            intent: TurnOffRoomLightIntent(),
            phrases: [
                "Ugasi svjetlo u \(.applicationName)",
                "Turn off light in \(.applicationName)"
            ],
            shortTitle: "Ugasi svjetlo",
            systemImageName: "lightbulb.slash.fill"
        )
        AppShortcut(
            intent: SetWarmRoomLightIntent(),
            phrases: [
                "Toplo svjetlo u \(.applicationName)"
            ],
            shortTitle: "Topla 2700K",
            systemImageName: "thermometer.sun.fill"
        )
        AppShortcut(
            intent: SetFullPowerRoomLightIntent(),
            phrases: [
                "Puna rasvjeta u \(.applicationName)"
            ],
            shortTitle: "Puna 4800K",
            systemImageName: "bolt.fill"
        )
    }
}
