import Foundation
import UIKit
import CoreHaptics

@MainActor
public final class HapticsEngine {
    public static let shared = HapticsEngine()

    private var engine: CHHapticEngine?
    private var isEngineRunning: Bool = false
    private let rigidImpact = UIImpactFeedbackGenerator(style: .rigid)
    private let heavyImpact = UIImpactFeedbackGenerator(style: .heavy)
    private let mediumImpact = UIImpactFeedbackGenerator(style: .medium)
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let selectionGen = UISelectionFeedbackGenerator()
    private let notificationGen = UINotificationFeedbackGenerator()

    private init() {
        prepareHaptics()
    }

    public func prepareHaptics() {
        rigidImpact.prepare()
        heavyImpact.prepare()
        mediumImpact.prepare()
        lightImpact.prepare()
        selectionGen.prepare()
        notificationGen.prepare()

        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        if let engine {
            if !isEngineRunning {
                do {
                    try engine.start()
                    isEngineRunning = true
                } catch {}
            }
            return
        }
        do {
            let eng = try CHHapticEngine()
            eng.playsHapticsOnly = true
            eng.isAutoShutdownEnabled = false
            eng.stoppedHandler = { [weak self] _ in
                Task { @MainActor in
                    self?.isEngineRunning = false
                }
            }
            eng.resetHandler = { [weak self] in
                Task { @MainActor in
                    guard let self, let eng = self.engine else { return }
                    do {
                        try eng.start()
                        self.isEngineRunning = true
                    } catch {
                        self.isEngineRunning = false
                    }
                }
            }
            try eng.start()
            self.engine = eng
            self.isEngineRunning = true
        } catch {
            self.engine = nil
            self.isEngineRunning = false
        }
    }

    private func ensureEngineStarted() -> CHHapticEngine? {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return nil }
        if engine == nil {
            prepareHaptics()
        }
        guard let engine else { return nil }
        if !isEngineRunning {
            do {
                try engine.start()
                isEngineRunning = true
            } catch {
                return nil
            }
        }
        return engine
    }

    /// Strong mechanical snap feedback when crossing between L / C / R panels on the large pad.
    public func panelSnap() {
        // Immediate hardware Taptic punch (0ms latency)
        rigidImpact.impactOccurred(intensity: 1.0)
        heavyImpact.impactOccurred(intensity: 1.0)
        rigidImpact.prepare()
        heavyImpact.prepare()

        // Layered CoreHaptics mechanical detent snap
        guard let eng = ensureEngineStarted() else { return }
        do {
            let sharpClick = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 1.0)
                ],
                relativeTime: 0.0
            )
            let heavyDetent = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.32)
                ],
                relativeTime: 0.016
            )
            let snapBody = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.95),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.82)
                ],
                relativeTime: 0.0,
                duration: 0.042
            )
            let pattern = try CHHapticPattern(events: [sharpClick, heavyDetent, snapBody], parameters: [])
            let player = try eng.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {}
    }

    /// Tactile step tick while dragging downward to dim faster.
    public func dimmerStepTick(progress: Double) {
        let strength = CGFloat(max(0.45, min(0.95, 0.5 + progress * 0.45)))
        rigidImpact.impactOccurred(intensity: strength)
        rigidImpact.prepare()
    }

    /// Expressive guitar-string pluck haptic when strumming/drawing into a panel at a given velocity (0..1).
    public func guitarStrum(velocity: Double) {
        let v = Float(max(0.25, min(1.0, velocity)))
        rigidImpact.impactOccurred(intensity: CGFloat(v))
        rigidImpact.prepare()

        guard let eng = ensureEngineStarted() else { return }
        do {
            let pluck = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: v),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.72 + v * 0.25)
                ],
                relativeTime: 0.0
            )
            let resonance = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: v * 0.65),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.38)
                ],
                relativeTime: 0.008,
                duration: 0.038
            )
            let pattern = try CHHapticPattern(events: [pluck, resonance], parameters: [])
            let player = try eng.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {}
    }

    /// Subtle bubble pop when pressing a column/row lock dot on the edge.
    public func bubbleTouch(locking: Bool) {
        mediumImpact.impactOccurred(intensity: locking ? 0.75 : 0.6)
        mediumImpact.prepare()
    }

    /// Confirmation haptic when a column/row bubble finishes expanding (lock) or shrinking (unlock).
    public func bubbleLockComplete(locked: Bool) {
        if locked {
            heavyImpact.impactOccurred(intensity: 1.0)
            rigidImpact.impactOccurred(intensity: 0.9)
            heavyImpact.prepare()
            rigidImpact.prepare()
        } else {
            mediumImpact.impactOccurred(intensity: 0.7)
            lightImpact.impactOccurred(intensity: 0.6)
            mediumImpact.prepare()
            lightImpact.prepare()
        }
    }

    /// Rapid tactile flutter when a quick press triggers the 18 Hz strobe burst.
    public func strobeBurst() {
        rigidImpact.impactOccurred(intensity: 1.0)
        rigidImpact.prepare()
        guard let eng = ensureEngineStarted() else { return }
        do {
            let events: [CHHapticEvent] = [0.0, 0.045, 0.090].map { t in
                CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.95)
                    ],
                    relativeTime: t
                )
            }
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try eng.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {}
    }

    public func padHit(intensity: Double = 1.0, isLoop: Bool = false) {
        let clamped = Float(max(0.45, min(1.0, intensity)))
        heavyImpact.impactOccurred(intensity: CGFloat(clamped))
        heavyImpact.prepare()

        if let eng = ensureEngineStarted() {
            do {
                let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: isLoop ? 0.55 : 0.92)
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
                let player = try eng.makePlayer(with: pattern)
                try player.start(atTime: CHHapticTimeImmediate)
            } catch {}
        }
    }

    public func padRelease() {
        lightImpact.impactOccurred(intensity: 0.5)
        lightImpact.prepare()
    }

    public func tickSelection() {
        selectionGen.selectionChanged()
        selectionGen.prepare()
    }

    public func blackoutTriggered(active: Bool) {
        notificationGen.notificationOccurred(active ? .warning : .success)
        notificationGen.prepare()
    }
}
