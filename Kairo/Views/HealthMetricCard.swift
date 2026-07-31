import SwiftUI

struct HealthMetricCard: View {
    let reading: HealthReading

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: reading.metric.symbol)
                    .foregroundStyle(accent)

                Spacer()

                if reading.measuredAt != nil {
                    Circle()
                        .fill(accent)
                        .frame(width: 5, height: 5)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(reading.metric.title)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.58))

                Text(reading.value)
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .minimumScaleFactor(0.72)
                    .lineLimit(1)

                Text(reading.unit)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 116, alignment: .leading)
        .padding(16)
        .background(Color.white.opacity(0.045))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.075), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var accent: Color {
        switch reading.metric {
        case .move: .red
        case .exercise: .green
        case .stand: .cyan
        case .sleep: .indigo
        case .mood: .yellow
        case .weight: .mint
        case .heartRate, .restingHeartRate, .heartRateVariability: .pink
        }
    }
}
