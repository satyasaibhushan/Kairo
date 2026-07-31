import SwiftUI

@main
struct KairoApp: App {
    @StateObject private var healthStore = HealthStore()

    var body: some Scene {
        WindowGroup {
            HealthDashboardView()
                .environmentObject(healthStore)
                .task {
                    await healthStore.prepare()
                }
        }
    }
}
