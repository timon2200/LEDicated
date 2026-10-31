import SwiftUI

public struct NetworkDiagnosticsTab: View {
    @Bindable var client: StudioClient
    @State private var hostInput: String = ""
    @State private var showManualIpField: Bool = false

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            connectionHeroCard
            discoveredServersCard
            manualIpCard
        }
        .onAppear {
            hostInput = client.studioHost
        }
    }

    private var connectionHeroCard: some View {
        let statusColor: Color = client.isConnected ? .green : (client.isSearchingNetwork ? .cyan : .orange)
        let iconName = client.isConnected
            ? "wifi.circle.fill"
            : (client.isSearchingNetwork ? "dot.radiowaves.left.and.right" : "wifi.exclamationmark")
        let titleText = client.isConnected
            ? "SPOJENO S MAC STUDIOM"
            : (client.isSearchingNetwork ? "TRAŽIM MAC STUDIO…" : "NIJE SPOJENO S MACOM")

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(statusColor.opacity(0.22))
                        .frame(width: 46, height: 46)
                    Image(systemName: iconName)
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(statusColor)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(titleText)
                        .font(.system(size: 13, weight: .black, design: .monospaced))
                        .foregroundStyle(statusColor)

                    Text(client.lastStatusMessage)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.85))
                }

                Spacer()
            }

            if client.isConnected {
                HStack(spacing: 8) {
                    telemetryTile(label: "MAC SERVER", value: client.serverHostname.replacingOccurrences(of: ".local", with: ""))
                    telemetryTile(label: "LAN IP ADRESA", value: client.serverIp)
                    telemetryTile(label: "LATENCIJA", value: "\(max(1, client.rttMs)) ms")
                }
            }

            autoDiscoverButton
        }
        .padding(15)
        .background(
            LinearGradient(
                colors: [statusColor.opacity(0.14), Color(red: 0.06, green: 0.08, blue: 0.14)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(statusColor.opacity(0.4), lineWidth: 1.2)
        )
    }

    private var autoDiscoverButton: some View {
        Button {
            Task {
                await client.autoDiscoverStudio(switchOnFind: true)
                hostInput = client.studioHost
            }
        } label: {
            HStack(spacing: 8) {
                if client.isSearchingNetwork {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.85)
                } else {
                    Image(systemName: "sparkle.magnifyingglass")
                        .font(.system(size: 14, weight: .bold))
                }
                Text(client.isSearchingNetwork ? "Pretražujem lokalnu Wi-Fi mrežu…" : "Automatski pronađi Mac na Wi-Fi mreži")
                    .font(.system(size: 13, weight: .heavy))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                LinearGradient(
                    colors: [Color.cyan.opacity(0.32), Color.blue.opacity(0.24)],
                    startPoint: .leading,
                    endPoint: .trailing
                ),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.cyan.opacity(0.55), lineWidth: 1)
            )
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
    }

    private var discoveredServersCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DOSTUPNI MAC POSLUŽITELJI NA MREŽI")
                .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                .foregroundStyle(.secondary)

            ForEach(client.discoveredHosts, id: \.self) { hostUrl in
                discoveredHostRow(hostUrl: hostUrl)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func discoveredHostRow(hostUrl: String) -> some View {
        let isActiveHost = (client.studioHost == hostUrl) && client.isConnected
        let badgeColor: Color = isActiveHost ? .green : .cyan
        return Button {
            hostInput = hostUrl
            client.reconnect(to: hostUrl)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isActiveHost ? "checkmark.circle.fill" : "desktopcomputer")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(badgeColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text(hostUrl.replacingOccurrences(of: "http://", with: ""))
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                    Text(hostUrl.contains(".local") ? "Bonjour mDNS naziv" : "Izravni lokalni Wi-Fi IP")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(isActiveHost ? "Aktivno" : "Spoji")
                    .font(.system(size: 11, weight: .heavy))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(badgeColor.opacity(0.2), in: Capsule())
                    .foregroundStyle(badgeColor)
            }
            .padding(12)
            .background(
                (client.studioHost == hostUrl) ? Color.cyan.opacity(0.12) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder((client.studioHost == hostUrl) ? Color.cyan.opacity(0.45) : Color.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var manualIpCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    showManualIpField.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: "network")
                        .foregroundStyle(.cyan)
                    Text("Ručni unos IP adrese poslužitelja")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                    Spacer()
                    Image(systemName: showManualIpField ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if showManualIpField {
                HStack(spacing: 8) {
                    TextField("npr. 192.168.0.85:8787", text: $hostInput)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .padding(11)
                        .background(Color.black.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))

                    Button("Spoji") {
                        client.reconnect(to: hostInput)
                    }
                    .font(.system(size: 13, weight: .heavy))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Color.cyan.opacity(0.28), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func telemetryTile(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 11, weight: .heavy, design: .monospaced))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(Color.black.opacity(0.32), in: RoundedRectangle(cornerRadius: 10))
    }
}
