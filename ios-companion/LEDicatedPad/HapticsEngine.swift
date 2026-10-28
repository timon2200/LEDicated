import Foundation
import UIKit
import CoreHaptics

@MainActor
public final class HapticsEngine {
    public static let shared = HapticsEngine()

    private var engine: CHHapticEngine?
    private let heavyImpact = UIImpactFeedbackGenerator(style: .heavy)
    private let mediumImpact = UIImpactFeedbackGenerator(style: .medium)
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let selectionGen = UISelectionFeedbackGenerator()
    private let notificationGen = UINotificationFeedbackGenerator()

    private init() {
        prepareHaptics()
    }

    public func prepareHaptics() {
        heavyImpact.prepare()
        mediumImpact.prepare()
        lightImpact.prepare()
        selectionGen.prepare()

        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            let eng = try CHHapticEngine()
            eng.isAutoShutdownEnabled = true
            try eng.start()
            self.engine = eng
        } catch {
            self.engine = nil
        }
    }

    public func padHit(intensity: Double = 1.0, isLoop: Bool = false) {
        let clamped = Float(max(0.25, min(1.0, intensity)))
        if let engine, CHHapticEngine.capabilitiesForHardware().supportsHaptics {
            do {
                let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: isLoop ? 0.55 : 0.88)
                let power = CHHapticEventParameter(parameterID: .hapticIntensity, value: clamped)
                let tap = CHHapticEvent(eventType: .hapticTransient, parameters: [sharpness, power], relativeTime: 0)

                var events: [CHHapticEvent] = [tap]
                if isLoop {
                    let confirm = CHHapticEvent(
                        eventType: .hapticTransient,
                        parameters: [
                            CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.75),
                            CHHapticEventParameter(parameterID: .hapticIntensity, value: clamped * 0.7)
                        ],
                        relativeTime: 0.055
                    )
                    events.append(confirm)
                }
                let pattern = try CHHapticPattern(events: events, parameters: [])
                let player = try engine.makePlayer(with: pattern)
                try player.start(atTime: CHHapticTimeImmediate)
                return
            } catch {}
        }
        if isLoop {
            mediumImpact.impactOccurred(intensity: CGFloat(clamped))
        } else {
            heavyImpact.impactOccurred(intensity: CGFloat(clamped))
        }
    }

    public func padRelease() {
        lightImpact.impactOccurred(intensity: 0.45)
    }

    public func tickSelection() {
        selectionGen.selectionChanged()
    }

    public func blackoutTriggered(active: Bool) {
        notificationGen.notificationOccurred(active ? .warning : .success)
    }
}
