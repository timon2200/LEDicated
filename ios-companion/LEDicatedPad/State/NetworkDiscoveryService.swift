import Foundation
import Darwin

public enum NetworkDiscoveryService {
    nonisolated public static func probeServer(baseUrl: String, timeout: TimeInterval) async -> DiscoveredStudioServer? {
        guard let url = URL(string: "\(baseUrl)/api/lan/status") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let t0 = ProcessInfo.processInfo.systemUptime
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (json["ok"] as? Bool) == true else { return nil }

            let rtt = max(1, Int(((ProcessInfo.processInfo.systemUptime - t0) * 1000.0).rounded()))
            let hostname = (json["hostname"] as? String) ?? "Mac Studio"
            let ips = (json["ips"] as? [String]) ?? []
            let ip = ips.first ?? baseUrl
                .replacingOccurrences(of: "http://", with: "")
                .replacingOccurrences(of: ":\(AppConfiguration.defaultPort)", with: "")
            let ownerName = json["stageOwnerName"] as? String
            let nowPlaying = json["nowPlaying"] as? [String: Any]
            let trackTitle = nowPlaying?["trackTitle"] as? String
            let preferredUrl = !ip.isEmpty && !ip.contains(".local") ? "http://\(ip):\(AppConfiguration.defaultPort)" : baseUrl

            return DiscoveredStudioServer(
                url: preferredUrl,
                hostname: hostname,
                ip: ip,
                rttMs: rtt,
                stageOwnerName: ownerName,
                trackTitle: trackTitle
            )
        } catch {
            return nil
        }
    }

    nonisolated public static func currentWiFiIPv4() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let interface = ptr.pointee
            let addrFamily = interface.ifa_addr.pointee.sa_family
            if addrFamily == UInt8(AF_INET) {
                let name = String(cString: interface.ifa_name)
                if name == "en0" || name == "en1" || name.hasPrefix("bridge") {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname,
                        socklen_t(hostname.count),
                        nil,
                        socklen_t(0),
                        NI_NUMERICHOST
                    )
                    let ip = String(cString: hostname)
                    if !ip.hasPrefix("127.") && !ip.hasPrefix("169.254.") {
                        address = ip
                        if name == "en0" { break }
                    }
                }
            }
        }
        return address
    }
}

@MainActor
public extension StudioClient {
    func autoDiscoverStudio(switchOnFind: Bool = true) async {
        guard !isSearchingNetwork else { return }
        isSearchingNetwork = true
        lastStatusMessage = "Tražim Mac Studio na lokalnoj Wi-Fi mreži…"
        defer { isSearchingNetwork = false }

        var priorityCandidates: [String] = [
            studioHost,
            AppConfiguration.defaultStudioHost,
            AppConfiguration.bonjourStudioHost
        ]
        for h in discoveredHosts where !priorityCandidates.contains(h) {
            priorityCandidates.append(h)
        }

        var foundList: [DiscoveredStudioServer] = []

        await withTaskGroup(of: DiscoveredStudioServer?.self) { group in
            for candidate in priorityCandidates {
                group.addTask {
                    await NetworkDiscoveryService.probeServer(baseUrl: candidate, timeout: 1.2)
                }
            }
            for await res in group {
                if let server = res {
                    foundList.append(server)
                }
            }
        }

        if foundList.isEmpty, let deviceIp = NetworkDiscoveryService.currentWiFiIPv4() {
            let parts = deviceIp.split(separator: ".")
            if parts.count == 4 {
                let prefix = "\(parts[0]).\(parts[1]).\(parts[2])"
                let allHosts = (1...254).map { "http://\(prefix).\($0):\(AppConfiguration.defaultPort)" }
                let batchSize = 48
                for start in stride(from: 0, to: allHosts.count, by: batchSize) {
                    let slice = allHosts[start..<min(start + batchSize, allHosts.count)]
                    await withTaskGroup(of: DiscoveredStudioServer?.self) { group in
                        for hostUrl in slice {
                            group.addTask {
                                await NetworkDiscoveryService.probeServer(baseUrl: hostUrl, timeout: 0.55)
                            }
                        }
                        for await res in group {
                            if let server = res {
                                foundList.append(server)
                            }
                        }
                    }
                    if !foundList.isEmpty { break }
                }
            }
        }

        foundList.sort { $0.rttMs < $1.rttMs }
        if !foundList.isEmpty {
            discoveredServers = foundList
            var urls = foundList.map(\.url)
            if !urls.contains(AppConfiguration.bonjourStudioHost) {
                urls.append(AppConfiguration.bonjourStudioHost)
            }
            discoveredHosts = urls

            if let best = foundList.first, switchOnFind {
                let changedHost = (studioHost != best.url)
                studioHost = best.url
                serverHostname = best.hostname
                serverIp = best.ip
                rttMs = best.rttMs
                isConnected = true
                lastStatusMessage = "Spojeno s \(best.hostname) (\(best.ip))"
                if changedHost {
                    _ = await fetchInitialPadsAndStatus()
                    await fetchLibraryTracks()
                }
            }
        } else {
            isConnected = false
            lastStatusMessage = "Mac Studio nije pronađen na Wi-Fi mreži (port \(AppConfiguration.defaultPort))."
        }
    }
}
