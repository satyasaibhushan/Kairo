import SwiftUI

struct HealthDashboardView: View {
    @EnvironmentObject private var healthStore: HealthStore

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        ZStack {
            KairoPalette.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    connectionCard

                    if healthStore.authorizationState == .requested {
                        readings
                        syncNote
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .refreshable {
                await healthStore.refresh()
            }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(KairoPalette.mint)
                    .frame(width: 7, height: 7)
                    .shadow(color: KairoPalette.mint, radius: 6)

                Text("KAIRO / HEALTH BRIDGE")
                    .font(.caption2.monospaced().weight(.bold))
                    .tracking(1.4)
                    .foregroundStyle(KairoPalette.mint)
            }

            Text("Your body,\nmade legible.")
                .font(.system(size: 42, weight: .medium, design: .rounded))
                .tracking(-1.6)
                .foregroundStyle(.white)

            Text("A private, event-driven view of the health signals already living on your iPhone.")
                .font(.subheadline)
                .foregroundStyle(KairoPalette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: "heart.text.clipboard")
                    .font(.title2)
                    .foregroundStyle(KairoPalette.mint)

                Spacer()

                Text(connectionLabel)
                    .font(.caption2.monospaced().weight(.semibold))
                    .foregroundStyle(connectionColor)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(healthStore.authorizationState.title)
                    .font(.title3.weight(.semibold))

                Text(healthStore.authorizationState.detail)
                    .font(.footnote)
                    .foregroundStyle(KairoPalette.secondaryText)
            }

            if healthStore.authorizationState == .notRequested
                || healthStore.authorizationState.isFailure {
                Button {
                    Task {
                        await healthStore.requestAuthorization()
                    }
                } label: {
                    HStack {
                        Text("Choose health signals")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KairoPalette.background)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                    .background(KairoPalette.mint)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(20)
        .background(KairoPalette.panel)
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(KairoPalette.panelBorder, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var readings: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Today")
                    .font(.title2.weight(.semibold))

                Spacer()

                if healthStore.isRefreshing {
                    ProgressView()
                        .tint(KairoPalette.mint)
                } else {
                    Text(healthStore.snapshot.refreshedAt, style: .time)
                        .font(.caption.monospaced())
                        .foregroundStyle(KairoPalette.tertiaryText)
                }
            }

            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(healthStore.snapshot.readings) { reading in
                    HealthMetricCard(reading: reading)
                }
            }
        }
    }

    private var syncNote: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bolt.horizontal.circle")
                .foregroundStyle(KairoPalette.mint)

            VStack(alignment: .leading, spacing: 4) {
                Text("Event-driven sync")
                    .font(.footnote.weight(.semibold))

                Text("HealthKit wakes Kairo when selected signals change. Pull to refresh forces a reconciliation.")
                    .font(.caption)
                    .foregroundStyle(KairoPalette.secondaryText)
            }
        }
        .padding(.bottom, 12)
    }

    private var connectionLabel: String {
        switch healthStore.authorizationState {
        case .requested: "CONNECTED"
        case .requesting: "CONNECTING"
        case .failed: "ACTION NEEDED"
        case .notRequested: "NOT CONNECTED"
        case .unavailable: "UNAVAILABLE"
        }
    }

    private var connectionColor: Color {
        healthStore.authorizationState == .requested ? KairoPalette.mint : KairoPalette.tertiaryText
    }
}

private extension HealthAuthorizationState {
    var isFailure: Bool {
        if case .failed = self {
            return true
        }
        return false
    }
}

private enum KairoPalette {
    static let background = Color(red: 0.035, green: 0.055, blue: 0.071)
    static let panel = Color(red: 0.068, green: 0.095, blue: 0.112)
    static let panelBorder = Color.white.opacity(0.09)
    static let mint = Color(red: 0.36, green: 0.90, blue: 0.86)
    static let secondaryText = Color.white.opacity(0.66)
    static let tertiaryText = Color.white.opacity(0.43)
}
