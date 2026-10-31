import SwiftUI

public struct ContentView: View {
    @State private var client = StudioClient()
    @State private var surfaceMode: String = "pads" // "pads" (12 Effect Panels) | "xy" (Large Spatial 3x3 Pad)
    @State private var showingInspector: Bool = false
    @State private var showingSettingsSheet: Bool = false
    @State private var settingsInitialSection: String = "library"

    public init() {}

    private func openMenu(section: String) {
        settingsInitialSection = section
        showingSettingsSheet = true
        HapticsEngine.shared.tickSelection()
    }

    public var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height * 1.05

            if isLandscape {
                // MARK: - HORIZONTAL (LANDSCAPE) MODE: 12 Effect Panels (4x3) OR Large Spatial Pad (XY)
                VStack(spacing: 8) {
                    LandscapeHudBar(
                        client: client,
                        surfaceMode: $surfaceMode,
                        onOpenMenu: openMenu
                    )

                    if surfaceMode == "pads" {
                        MultiTouchPadGrid(
                            client: client,
                            columnsCount: 4,
                            isLandscape: true,
                            onOpenInspector: { index in
                                client.selectedPadIndex = index
                                showingInspector = true
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        XYMorphSurfaceView(
                            client: client,
                            isLandscape: true
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(width: geo.size.width, height: geo.size.height)
            } else {
                // MARK: - PORTRAIT MODE: Complete Live Controller (12 Effect Panels OR Large Spatial Pad)
                VStack(spacing: 7) {
                    PortraitTopStatusBar(
                        client: client,
                        onOpenMenu: openMenu
                    )

                    StagePreviewView(client: client) {
                        openMenu(section: "library")
                    }

                    PortraitMacroStrip(
                        client: client,
                        surfaceMode: $surfaceMode
                    )

                    if surfaceMode == "pads" {
                        MultiTouchPadGrid(
                            client: client,
                            columnsCount: 3,
                            isLandscape: false,
                            onOpenInspector: { index in
                                client.selectedPadIndex = index
                                showingInspector = true
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        BottomExpressionDock(client: client) {
                            showingInspector = true
                        }
                    } else {
                        XYMorphSurfaceView(
                            client: client,
                            isLandscape: false
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .frame(width: geo.size.width, height: geo.size.height)
            }
        }
        .background(StudioTheme.backgroundGradient)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingInspector) {
            PadInspectorSheet(client: client)
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showingSettingsSheet) {
            StudioSettingsSheet(client: client, initialSection: settingsInitialSection)
                .presentationDetents([.large])
        }
        .onOpenURL { url in
            let host = (url.host ?? url.path).lowercased()
            if host.contains("toggle-light") {
                client.roomLight.togglePower(studioHost: client.studioHost)
            } else if host.contains("light-on") {
                client.roomLight.setPower(true, studioHost: client.studioHost)
            } else if host.contains("light-off") {
                client.roomLight.setPower(false, studioHost: client.studioHost)
            } else if host.contains("light") {
                openMenu(section: "light")
            }
        }
    }
}
