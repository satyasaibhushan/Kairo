import SwiftUI

struct HealthDashboardView: View {
    @EnvironmentObject private var healthStore: HealthStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var isShowingPairing = false
    @State private var pairingCode = ""
    @State private var pairingError: String?
    @State private var isPairing = false

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
                        collectionCard
                        cloudSyncCard
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
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await healthStore.refresh() }
        }
        .sheet(isPresented: $isShowingPairing) {
            pairingSheet
        }
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

                Text("\(HealthDataCatalog.availableTypeCount) HealthKit data types available on this iPhone")
                    .font(.caption.monospaced())
                    .foregroundStyle(KairoPalette.tertiaryText)
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

    private var collectionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("On-device collection", systemImage: "lock.shield")
                    .font(.footnote.weight(.semibold))
                Spacer()
                Text(collectionLabel)
                    .font(.caption2.monospaced().weight(.bold))
                    .foregroundStyle(
                        healthStore.collectionStatus.isHealthy
                            ? KairoPalette.mint
                            : Color.orange
                    )
            }

            HStack(spacing: 0) {
                collectionValue(
                    String(healthStore.collectionStatus.queuedChanges),
                    label: "protected changes"
                )
                Divider().overlay(KairoPalette.panelBorder)
                collectionValue(
                    "\(healthStore.collectionStatus.typesScanned)/\(HealthDataCatalog.sampleTypes.count)",
                    label: "types reconciled"
                )
            }
            .frame(maxWidth: .infinity)

            Text(healthStore.collectionStatus.message)
                .font(.caption)
                .foregroundStyle(KairoPalette.secondaryText)

            Text(
                healthStore.isSyncConfigured
                    ? "Removed locally only after the private ledger acknowledges each batch."
                    : "Stored with iPhone Data Protection. Nothing is uploaded until you pair."
            )
                .font(.caption2)
                .foregroundStyle(KairoPalette.tertiaryText)
        }
        .padding(16)
        .background(KairoPalette.panel)
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(KairoPalette.panelBorder, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var cloudSyncCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Private Health Ledger", systemImage: "cloud.fill")
                    .font(.footnote.weight(.semibold))
                Spacer()
                Text(healthStore.syncStatus.label)
                    .font(.caption2.monospaced().weight(.bold))
                    .foregroundStyle(
                        healthStore.syncStatus.isFailure ? Color.orange : KairoPalette.mint
                    )
            }

            Text(healthStore.syncStatus.detail)
                .font(.caption)
                .foregroundStyle(KairoPalette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            if healthStore.isSyncConfigured {
                Button {
                    Task { await healthStore.uploadQueuedChanges() }
                } label: {
                    HStack {
                        Text("Sync now")
                        Spacer()
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KairoPalette.background)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(KairoPalette.mint)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                }
                .disabled(healthStore.isRefreshing)
            } else {
                Button {
                    pairingError = nil
                    isShowingPairing = true
                } label: {
                    HStack {
                        Text("Pair private ledger")
                        Spacer()
                        Image(systemName: "link")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KairoPalette.mint)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .overlay {
                        RoundedRectangle(cornerRadius: 11)
                            .stroke(KairoPalette.mint.opacity(0.55), lineWidth: 1)
                    }
                }
            }
        }
        .padding(16)
        .background(KairoPalette.panel)
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(KairoPalette.panelBorder, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var pairingSheet: some View {
        NavigationStack {
            ZStack {
                KairoPalette.background.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "lock.icloud.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(KairoPalette.mint)

                    Text("Pair this iPhone")
                        .font(.title2.weight(.semibold))

                    Text("Paste the one-time Kairo pairing code. The endpoint credentials are stored only in this iPhone's Keychain.")
                        .font(.subheadline)
                        .foregroundStyle(KairoPalette.secondaryText)

                    SecureField("Pairing code", text: $pairingCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.caption.monospaced())
                        .padding(14)
                        .background(KairoPalette.panel)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    if let pairingError {
                        Text(pairingError)
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    if isPairing {
                        Text(healthStore.syncStatus.detail)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(KairoPalette.mint)
                            .contentTransition(.numericText())
                    }

                    Button {
                        isPairing = true
                        pairingError = nil
                        Task {
                            do {
                                try await healthStore.pairPrivateLedger(using: pairingCode)
                                pairingCode = ""
                                isPairing = false
                                isShowingPairing = false
                            } catch {
                                pairingError = error.localizedDescription
                                isPairing = false
                            }
                        }
                    } label: {
                        HStack {
                            Text(isPairing ? "Pairing and syncing…" : "Pair and upload")
                            Spacer()
                            if isPairing {
                                ProgressView().tint(KairoPalette.background)
                            } else {
                                Image(systemName: "arrow.right")
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KairoPalette.background)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 13)
                        .background(KairoPalette.mint)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(pairingCode.isEmpty || isPairing)

                    Spacer()
                }
                .padding(22)
            }
            .preferredColorScheme(.dark)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isShowingPairing = false }
                }
            }
        }
    }

    private func collectionValue(_ value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.title3.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
            Text(label)
                .font(.caption2)
                .foregroundStyle(KairoPalette.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

    private var collectionLabel: String {
        if healthStore.isRefreshing {
            return "SCANNING"
        }
        return healthStore.collectionStatus.isHealthy ? "READY" : "RETRYING"
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
