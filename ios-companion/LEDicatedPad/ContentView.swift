import SwiftUI

public struct ContentView: View {
    @State private var client = StudioClient()
    @State private var surfaceMode: String = "pads" // "pads" | "xy"
    @State private var showingInspector: Bool = false
    @State private var showingTransportSheet: Bool = false
    @State private var xyPoint: CGPoint = CGPoint(x: 0.5, y: 0.75)

    public init() {}

    public var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height * 1.1
            VStack(spacing: 8) {
                // 1. Top Status & Stage Handover Bar
                topStatusBar

                // 2. 60 FPS 3x3 Diffused RGBW Bar Visualizer
                StagePreviewView(client: client) {
                    showingTransportSheet = true
                }

                // 3. Performance Macro Strip
                macroStrip

                // 4. Main Multi-Touch 12-Pad Performance Grid or XY Morph Surface
                if surfaceMode == "pads" {
                    MultiTouchPadGrid(
                        client: client,
                        columnsCount: isLandscape ? 4 : 3,
                        onOpenInspector: { index in
                            client.selectedPadIndex = index
                            showingInspector = true
                        }
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    xyMorphSurface
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                // 5. Bottom Live Expression & Transport Dock
                bottomExpressionDock
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RadialGradient(
                    colors: [Color(red: 0.08, green: 0.10, blue: 0.18), Color(red: 0.02, green: 0.03, blue: 0.05)],
                    center: .top,
                    startRadius: 20,
                    endRadius: 680
                )
                .ignoresSafeArea()
            )
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingInspector) {
            PadInspectorSheet(client: client)
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showingTransportSheet) {
            StudioTransportSheet(client: client)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Top Status Bar

    private var topStatusBar: some View {
        HStack(spacing: 8) {
            // Connection Indicator & Stage Role
            HStack(spacing: 8) {
                Circle()
                    .fill(client.isConnected ? Color.green : Color.orange)
                    .frame(width: 9, height: 9)
                    .shadow(color: client.isConnected ? .green : .orange, radius: 5)

                VStack(alignment: .leading, spacing: 2) {
                    Text("LEDICATED · LIVE SURFACE")
                        .font(.system(size: 8.5, weight: .heavy, design: .monospaced))
                        .foregroundStyle(.secondary)

                    HStack(spacing: 6) {
                        Button {
                            Task { await client.toggleStageOwnership() }
                        } label: {
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(client.isStageOwner ? Color.green : Color.yellow)
                                    .frame(width: 6, height: 6)
                                Text(client.isStageOwner ? "ON AIR" : "SOLO · PREUZMI")
                                    .font(.system(size: 9.5, weight: .heavy, design: .monospaced))
                            }
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(
                                (client.isStageOwner ? Color.green : Color.yellow).opacity(0.16),
                                in: Capsule()
                            )
                            .foregroundStyle(client.isStageOwner ? .green : .yellow)
                        }
                        .buttonStyle(.plain)

                        Text(client.isConnected ? "LAN \(max(1, client.rttMs)) ms" : "SOLO")
                            .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer(minLength: 4)

            // REC, BPM/Transport, and Blackout
            HStack(spacing: 6) {
                Button {
                    client.isRecordingSession.toggle()
                    HapticsEngine.shared.tickSelection()
                } label: {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 7, height: 7)
                        Text("REC")
                            .font(.system(size: 10.5, weight: .heavy))
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(
                        client.isRecordingSession ? Color.red.opacity(0.26) : Color.white.opacity(0.06),
                        in: RoundedRectangle(cornerRadius: 9)
                    )
                    .foregroundStyle(client.isRecordingSession ? .white : .secondary)
                }
                .buttonStyle(.plain)

                Button {
                    showingTransportSheet = true
                } label: {
                    Text("\(Int(client.bpm.rounded())) BPM")
                        .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)

                Button {
                    client.toggleBlackout()
                } label: {
                    Text("BLACKOUT")
                        .font(.system(size: 10.5, weight: .black))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            client.blackout ? Color.red : Color.red.opacity(0.18),
                            in: RoundedRectangle(cornerRadius: 9)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 9)
                                .strokeBorder(Color.red.opacity(0.6), lineWidth: 1)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13).opacity(0.92), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: - Macro Strip

    private var macroStrip: some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                surfaceTabButton(title: "12 PADOVA", mode: "pads")
                surfaceTabButton(title: "XY MORPH", mode: "xy")
            }
            .padding(2)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    macroPill(title: "⏱ Beat Sync", active: client.quantize) {
                        client.toggleQuantize()
                    }
                    macroPill(title: "🔒 Hold", active: client.holdLatchMode) {
                        client.toggleHoldLatch()
                    }
                    macroPill(title: "⚙ Inspector", active: client.inspectorOnTapMode) {
                        client.inspectorOnTapMode.toggle()
                        HapticsEngine.shared.tickSelection()
                    }
                    Button {
                        client.stopAllPads()
                    } label: {
                        Text("✕ Stop FX")
                            .font(.system(size: 10.5, weight: .bold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 6)
                            .background(Color.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
                            .foregroundStyle(Color(red: 1.0, green: 0.65, blue: 0.7))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func surfaceTabButton(title: String, mode: String) -> some View {
        let active = surfaceMode == mode
        return Button {
            withAnimation(.snappy(duration: 0.18)) {
                surfaceMode = mode
            }
            HapticsEngine.shared.tickSelection()
        } label: {
            Text(title)
                .font(.system(size: 9.5, weight: .heavy))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(active ? Color.cyan.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                .foregroundStyle(active ? .cyan : .secondary)
        }
        .buttonStyle(.plain)
    }

    private func macroPill(title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 10.5, weight: .bold))
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(
                    active ? Color.cyan.opacity(0.22) : Color.white.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 9)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .strokeBorder(active ? Color.cyan : Color.white.opacity(0.08), lineWidth: 1)
                )
                .foregroundStyle(active ? .white : .secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - XY Morph Expressive Surface

    private var xyMorphSurface: some View {
        VStack(spacing: 8) {
            GeometryReader { geo in
                let accent = client.selectedPad.swiftUIColor
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(
                            RadialGradient(
                                colors: [accent.opacity(0.32), Color(red: 0.04, green: 0.06, blue: 0.10)],
                                center: UnitPoint(x: xyPoint.x, y: 1.0 - xyPoint.y),
                                startRadius: 10,
                                endRadius: 260
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .strokeBorder(accent.opacity(0.55), lineWidth: 1.5)
                        )

                    // Puck
                    Circle()
                        .strokeBorder(accent, lineWidth: 2.5)
                        .background(Circle().fill(Color.white))
                        .frame(width: 38, height: 38)
                        .shadow(color: accent, radius: 12)
                        .position(
                            x: xyPoint.x * geo.size.width,
                            y: (1.0 - xyPoint.y) * geo.size.height
                        )
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { val in
                            let nx = max(0, min(1, val.location.x / max(1, geo.size.width)))
                            let ny = max(0, min(1, 1.0 - val.location.y / max(1, geo.size.height)))
                            xyPoint = CGPoint(x: nx, y: ny)

                            var pad = client.selectedPad
                            pad.params.speed = Double((0.4 + nx * 2.8))
                            pad.intensity = Double((0.25 + ny * 0.75))
                            pad.white = Double(max(0, (ny - 0.55) * 1.6))
                            client.selectedPad = pad
                            if client.activePads[client.selectedPadIndex] == nil {
                                client.pressPad(client.selectedPadIndex)
                            }
                        }
                        .onEnded { _ in
                            client.syncPadToServer(index: client.selectedPadIndex)
                            if !client.selectedPad.isLoop && !client.holdLatchMode {
                                client.releasePad(client.selectedPadIndex)
                            }
                        }
                )
            }

            // Quick 6-pad switcher strip
            HStack(spacing: 6) {
                ForEach(0..<6, id: \.self) { idx in
                    let pad = client.pads[idx]
                    let selected = client.selectedPadIndex == idx
                    Button {
                        client.selectedPadIndex = idx
                        HapticsEngine.shared.tickSelection()
                    } label: {
                        Text("\(pad.key) · \(pad.name)")
                            .font(.system(size: 10, weight: .bold))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                selected ? Color.cyan.opacity(0.24) : Color.white.opacity(0.06),
                                in: RoundedRectangle(cornerRadius: 9)
                            )
                            .foregroundStyle(selected ? .white : .secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Bottom Expression & Transport Dock

    private var bottomExpressionDock: some View {
        VStack(spacing: 7) {
            HStack(spacing: 8) {
                expressionSlider(
                    title: "INTENZITET",
                    valueText: "\(Int((client.selectedPad.intensity * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.intensity },
                        set: {
                            client.selectedPad.intensity = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.15...1.0
                )

                expressionSlider(
                    title: "BRZINA FX",
                    valueText: String(format: "%.1f×", client.selectedPad.params.speed),
                    value: Binding(
                        get: { client.selectedPad.params.speed },
                        set: {
                            client.selectedPad.params.speed = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.3...3.5
                )

                expressionSlider(
                    title: "TOPLA W",
                    valueText: "\(Int((client.selectedPad.white * 100).rounded()))%",
                    value: Binding(
                        get: { client.selectedPad.white },
                        set: {
                            client.selectedPad.white = $0
                            client.syncPadToServer(index: client.selectedPadIndex)
                        }
                    ),
                    range: 0.0...1.0
                )
            }

            HStack(spacing: 8) {
                Button {
                    client.togglePlayPause()
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: client.isPlaying ? "pause.fill" : "play.fill")
                        Text(client.isPlaying ? "Pause" : "Play")
                    }
                    .font(.system(size: 12, weight: .heavy))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        client.isPlaying ? Color.green.opacity(0.24) : Color.white.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 11)
                    )
                    .foregroundStyle(client.isPlaying ? .green : .white)
                }
                .buttonStyle(.plain)

                Button {
                    showingInspector = true
                } label: {
                    HStack(spacing: 8) {
                        Text(client.selectedPad.key)
                            .font(.system(size: 12, weight: .heavy, design: .monospaced))
                            .foregroundStyle(client.selectedPad.swiftUIColor)
                            .frame(width: 24, height: 24)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))

                        VStack(alignment: .leading, spacing: 1) {
                            Text(client.selectedPad.name)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Text("\(client.selectedPad.preset.uppercased()) · \(client.selectedPad.mode.uppercased()) · \(client.selectedPad.bars.count)/9 barova")
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)

                Button {
                    showingInspector = true
                } label: {
                    Text("Uredi pad")
                        .font(.system(size: 12, weight: .heavy))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Color.cyan.opacity(0.18), in: RoundedRectangle(cornerRadius: 11))
                        .foregroundStyle(.cyan)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(9)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13).opacity(0.95), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func expressionSlider(title: String, valueText: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                    .font(.system(size: 8.5, weight: .bold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(valueText)
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(.cyan)
            }
            Slider(value: value, in: range)
                .tint(.cyan)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 9))
    }
}

// MARK: - Studio Transport & Connection Sheet

struct StudioTransportSheet: View {
    @Bindable var client: StudioClient
    @Environment(\.dismiss) private var dismiss
    @State private var hostInput: String = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Studio Host Connection
                    VStack(alignment: .leading, spacing: 8) {
                        Text("POVEZIVANJE S MAC STUDIOM (WI-FI / LAN)")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        HStack(spacing: 8) {
                            TextField("http://192.168.18.10:8787", text: $hostInput)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .padding(10)
                                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))

                            Button("Spoji") {
                                client.reconnect(to: hostInput)
                            }
                            .font(.system(size: 12, weight: .bold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.cyan.opacity(0.24), in: RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(.white)
                        }

                        HStack(spacing: 6) {
                            ForEach(client.discoveredHosts, id: \.self) { host in
                                Button {
                                    hostInput = host
                                    client.reconnect(to: host)
                                } label: {
                                    Text(host.replacingOccurrences(of: "http://", with: ""))
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                                        .foregroundStyle(.cyan)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Master Brightness (0 - 60)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("MASTER SVJETLINA POZORNICE (0 – 60)")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(Int(client.masterBrightness.rounded()))%")
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundStyle(.cyan)
                        }
                        Slider(
                            value: Binding(
                                get: { client.masterBrightness },
                                set: { client.setMasterBrightness($0) }
                            ),
                            in: 0...60
                        )
                        .tint(.cyan)
                    }

                    // Transport Controls
                    HStack(spacing: 8) {
                        Button {
                            client.seek(to: 0)
                        } label: {
                            Label("0:00", systemImage: "backward.end.fill")
                                .font(.system(size: 12, weight: .bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 11)
                                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                        }
                        .buttonStyle(.plain)

                        Button {
                            client.togglePlayPause()
                        } label: {
                            Label(client.isPlaying ? "Pause" : "Play", systemImage: client.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 12, weight: .bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 11)
                                .background(Color.cyan.opacity(0.24), in: RoundedRectangle(cornerRadius: 11))
                        }
                        .buttonStyle(.plain)

                        Button {
                            Task { await client.toggleStageOwnership() }
                        } label: {
                            Label(client.isStageOwner ? "Pusti Stage" : "Preuzmi Stage", systemImage: "antenna.radiowaves.left.and.right")
                                .font(.system(size: 12, weight: .bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 11)
                                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                        }
                        .buttonStyle(.plain)
                    }

                    // Track Library
                    VStack(alignment: .leading, spacing: 8) {
                        Text("PJESME U LEDICATED KNJIŽNICI")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.secondary)

                        ForEach(client.libraryTracks) { track in
                            let active = client.trackId == track.id
                            Button {
                                client.selectTrack(track.id, title: track.displayTitle)
                            } label: {
                                HStack {
                                    Text(track.displayTitle)
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(.white)
                                    Spacer()
                                    if let bpm = track.bpm {
                                        Text("\(Int(bpm.rounded())) BPM")
                                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(11)
                                .background(
                                    active ? Color.cyan.opacity(0.2) : Color.white.opacity(0.05),
                                    in: RoundedRectangle(cornerRadius: 10)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(16)
            }
            .background(Color(red: 0.05, green: 0.07, blue: 0.11).ignoresSafeArea())
            .navigationTitle("Studio & Transport")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Gotovo") { dismiss() }
                        .fontWeight(.bold)
                }
            }
            .onAppear {
                hostInput = client.studioHost
                Task { await client.fetchLibraryTracks() }
            }
        }
        .preferredColorScheme(.dark)
    }
}
