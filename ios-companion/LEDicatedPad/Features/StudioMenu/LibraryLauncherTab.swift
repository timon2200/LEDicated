import SwiftUI

public struct LibraryLauncherTab: View {
    @Bindable var client: StudioClient
    @State private var searchQuery: String = ""

    public init(client: StudioClient) {
        self.client = client
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            NowPlayingShowCard(client: client)
            librarySection
        }
    }

    private var filteredLibraryTracks: [LibraryTrack] {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return client.libraryTracks }
        return client.libraryTracks.filter {
            $0.displayTitle.lowercased().contains(q) ||
            ($0.author?.lowercased().contains(q) == true)
        }
    }

    private var librarySearchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.secondary)

            TextField("Pretraži light show u bazi…", text: $searchQuery)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)

            if !searchQuery.isEmpty {
                Button {
                    searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
    }

    private var librarySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("BAZA LIGHT SHOWOVA (\(filteredLibraryTracks.count))")
                    .font(.system(size: 10.5, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task { await client.fetchLibraryTracks() }
                } label: {
                    Label("Osvježi bazu", systemImage: "arrow.clockwise")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.cyan)
                }
                .buttonStyle(.plain)
            }

            librarySearchBar

            if client.libraryTracks.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "music.note.house")
                        .font(.system(size: 26))
                        .foregroundStyle(.secondary)
                    Text(client.isConnected ? "Učitavam bazu light showova s Maca…" : "Spoji se s Mac Studiom za pregled baze showova.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
            } else {
                ForEach(filteredLibraryTracks) { track in
                    libraryTrackRow(track: track)
                }
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }

    private func trackSubtitleText(for track: LibraryTrack) -> String {
        var parts: [String] = []
        if let dur = track.durationSec, dur > 0 {
            parts.append(String(format: "%d:%02d", Int(dur) / 60, Int(dur) % 60))
        }
        if let bpm = track.bpm, bpm > 0 {
            parts.append("\(Int(bpm.rounded())) BPM")
        }
        if let clips = track.clipCount, clips > 0 {
            parts.append("\(clips) clipova")
        }
        if let author = track.author, !author.isEmpty {
            if let ver = track.version {
                parts.append("\(author) · v\(ver)")
            } else {
                parts.append(author)
            }
        } else if track.isSharedOnly == true {
            parts.append("Cloud baza")
        }
        return parts.joined(separator: " · ")
    }

    private func libraryTrackRow(track: LibraryTrack) -> some View {
        let active: Bool = !track.effectiveTrackId.isEmpty && (client.trackId == track.effectiveTrackId) && (track.isSharedOnly != true)
        let isPlayingThis: Bool = active && client.isPlaying
        let isLaunchingThis: Bool = (client.launchingTrackId == track.id)
        let rowAccent: Color = isPlayingThis ? .green : (active ? .cyan : .white)

        return Button {
            client.playShow(track)
        } label: {
            HStack(spacing: 10) {
                trackLeadingIcon(active: active, isPlayingThis: isPlayingThis, isLaunchingThis: isLaunchingThis)

                VStack(alignment: .leading, spacing: 3) {
                    Text(track.displayTitle)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Text(trackSubtitleText(for: track))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(active ? rowAccent.opacity(0.9) : Color.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                trackPlayBadge(active: active, isPlayingThis: isPlayingThis)
            }
            .padding(10)
            .background(
                active ? rowAccent.opacity(0.14) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 13)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(active ? rowAccent.opacity(0.55) : Color.white.opacity(0.07), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func trackLeadingIcon(active: Bool, isPlayingThis: Bool, isLaunchingThis: Bool) -> some View {
        let rowAccent: Color = isPlayingThis ? .green : (active ? .cyan : .white)
        return ZStack {
            RoundedRectangle(cornerRadius: 9)
                .fill(active ? rowAccent.opacity(0.22) : Color.white.opacity(0.06))
                .frame(width: 34, height: 34)
            if isLaunchingThis {
                ProgressView()
                    .tint(.cyan)
                    .scaleEffect(0.75)
            } else {
                Image(systemName: isPlayingThis ? "speaker.wave.3.fill" : (active ? "pause.circle.fill" : "sparkles"))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(isPlayingThis ? Color.green : Color.cyan)
            }
        }
    }

    private func trackPlayBadge(active: Bool, isPlayingThis: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: isPlayingThis ? "pause.fill" : "play.fill")
                .font(.system(size: 10, weight: .black))
            Text(isPlayingThis ? "PAUZA" : (active ? "NASTAVI" : "PUSTI"))
                .font(.system(size: 10.5, weight: .black, design: .monospaced))
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(
            isPlayingThis ? Color.green : (active ? Color.cyan : Color.cyan.opacity(0.22)),
            in: Capsule()
        )
        .overlay(
            Capsule()
                .strokeBorder(isPlayingThis ? Color.green : Color.cyan.opacity(0.55), lineWidth: 1)
        )
        .foregroundStyle(isPlayingThis || active ? Color.black : Color.cyan)
        .fixedSize()
    }
}
