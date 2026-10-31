import Foundation

public enum AppConfiguration {
    public static let holdThresholdSec: TimeInterval = 0.22
    public static let padsCacheKey = "ledicated.cachedPads.v2"
    public static let studioHostKey = "ledicated.studioHost"
    public static let clientIdKey = "ledicated.clientId"

    public static let defaultPort: Int = 8787
    public static let pixelsPerBar: Int = 12
    public static let totalPadSlots: Int = 12

    public static let defaultServerHostname = "Timons-MacBook-Pro.local"
    public static let defaultServerIp = "192.168.0.85"
    public static let defaultStudioHost = "http://192.168.0.85:8787"
    public static let bonjourStudioHost = "http://Timons-MacBook-Pro.local:8787"

    public static let initialDiscoveredHosts: [String] = [
        defaultStudioHost,
        bonjourStudioHost
    ]
}
