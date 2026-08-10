import SwiftUI

@main
struct KairoApp: App {
    @StateObject private var healthStore = HealthStore()
    @StateObject private var contextStore = ContextStore()

    var body: some Scene {
        WindowGroup {
            HealthDashboardView()
                .environmentObject(healthStore)
                .environmentObject(contextStore)
                .task {
                    async let health: Void = healthStore.prepare()
                    async let context: Void = contextStore.prepare()
                    _ = await (health, context)
                }
        }
    }
}
