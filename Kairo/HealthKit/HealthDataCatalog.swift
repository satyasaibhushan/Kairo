import HealthKit

/// Kairo's retained HealthKit surface.
///
/// Sparse, high-signal records are kept exactly. Dense telemetry is converted
/// into daily statistics before it enters the private ledger. Unsupported,
/// derived, highly sensitive opt-in, and presently unparseable types are not
/// collected. Apple Health remains the source of truth for every raw sample.
enum HealthDataCatalog {
    enum RetentionStrategy: Equatable {
        case raw
        case dailySummary
        case discard
    }

    static var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>(sampleTypes)
        types.formUnion(characteristicIdentifiers.compactMap(HKObjectType.characteristicType(forIdentifier:)))
        types.insert(HKObjectType.activitySummaryType())
        return types
    }

    static var availableTypeCount: Int { allReadTypes.count }
    static var retainedTypeCount: Int { sampleTypes.count }

    /// Source streams observed by Kairo. A stream may be stored raw or reduced
    /// to daily statistics, but is counted only once in import progress.
    static var sampleTypes: [HKSampleType] {
        allSampleTypes
            .filter { retentionStrategy(for: $0) != .discard }
            .sorted { $0.identifier < $1.identifier }
    }

    static var rawSampleTypes: [HKSampleType] {
        sampleTypes.filter { retentionStrategy(for: $0) == .raw }
    }

    static var summarizedQuantityTypes: [HKQuantityType] {
        sampleTypes.compactMap { type in
            guard retentionStrategy(for: type) == .dailySummary else { return nil }
            return type as? HKQuantityType
        }
    }

    static func retentionStrategy(for type: HKSampleType) -> RetentionStrategy {
        if discardedTypeIdentifiers.contains(type.identifier) {
            return .discard
        }
        if let quantity = type as? HKQuantityType {
            return rawQuantityIdentifiers.contains(quantity.identifier) ? .raw : .dailySummary
        }
        return .raw
    }

    private static var allReadTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        types.formUnion(quantityIdentifiers.compactMap(HKObjectType.quantityType(forIdentifier:)))
        types.formUnion(categoryIdentifiers.compactMap(HKObjectType.categoryType(forIdentifier:)))
        types.formUnion(characteristicIdentifiers.compactMap(HKObjectType.characteristicType(forIdentifier:)))
        types.insert(HKObjectType.workoutType())
        types.insert(HKObjectType.activitySummaryType())
        types.insert(HKObjectType.audiogramSampleType())
        types.insert(HKObjectType.electrocardiogramType())
        types.insert(HKObjectType.stateOfMindType())
        types.insert(HKSeriesType.workoutRoute())
        types.insert(HKSeriesType.heartbeat())
        for identifier in scoredAssessmentIdentifiers {
            types.insert(HKScoredAssessmentType(identifier))
        }
        if #available(iOS 26.0, *) {
            types.insert(HKObjectType.medicationDoseEventType())
            types.insert(HKObjectType.userAnnotatedMedicationType())
        }
        return types
    }

    private static var allSampleTypes: [HKSampleType] {
        allReadTypes
            .compactMap { $0 as? HKSampleType }
    }

    static let declaredTypeCount = quantityNames.count
        + categoryNames.count
        + characteristicNames.count
        + scoredAssessmentNames.count
        + 7

    private static let quantityIdentifiers = quantityNames.map {
        HKQuantityTypeIdentifier(rawValue: "HKQuantityTypeIdentifier\($0)")
    }

    private static let categoryIdentifiers = categoryNames.map {
        HKCategoryTypeIdentifier(rawValue: "HKCategoryTypeIdentifier\($0)")
    }

    private static let characteristicIdentifiers = characteristicNames.map {
        HKCharacteristicTypeIdentifier(rawValue: "HKCharacteristicTypeIdentifier\($0)")
    }

    private static let scoredAssessmentIdentifiers = scoredAssessmentNames.map {
        HKScoredAssessmentTypeIdentifier(rawValue: "HKScoredAssessmentTypeIdentifier\($0)")
    }

    private static let rawQuantityIdentifiers = Set(rawQuantityNames.map {
        "HKQuantityTypeIdentifier\($0)"
    })

    private static let discardedTypeIdentifiers = Set(
        discardedQuantityNames.map { "HKQuantityTypeIdentifier\($0)" }
            + discardedCategoryNames.map { "HKCategoryTypeIdentifier\($0)" }
            + [
                HKObjectType.audiogramSampleType().identifier,
                HKSeriesType.heartbeat().identifier,
                HKSeriesType.workoutRoute().identifier,
            ]
    )

    /// Exact events whose timing or individual value is important to later
    /// causal analysis. Every other retained quantity becomes a daily summary.
    private static let rawQuantityNames = words("""
    AppleSleepingBreathingDisturbances AppleSleepingWristTemperature
    AtrialFibrillationBurden BasalBodyTemperature BloodAlcoholContent BloodGlucose
    BloodPressureDiastolic BloodPressureSystolic BodyFatPercentage BodyMass
    BodyTemperature DietaryCaffeine ElectrodermalActivity EstimatedWorkoutEffortScore
    ForcedExpiratoryVolume1 ForcedVitalCapacity HeartRateRecoveryOneMinute
    HeartRateVariabilitySDNN Height InhalerUsage InsulinDelivery LeanBodyMass
    NumberOfAlcoholicBeverages NumberOfTimesFallen OxygenSaturation
    PeakExpiratoryFlowRate PeripheralPerfusionIndex RespiratoryRate RestingHeartRate
    SixMinuteWalkTestDistance VO2Max WaistCircumference WalkingHeartRateAverage
    WorkoutEffortScore
    """)

    /// BMI is derived from retained height and weight. NikeFuel is obsolete.
    /// Wheelchair-only telemetry is opt-in rather than collected by default.
    private static let discardedQuantityNames = words("""
    BodyMassIndex DistanceWheelchair NikeFuel PushCount
    """)

    /// Reproductive and sexual-health streams are deliberately opt-in. They
    /// can be added later without changing the rest of the retention policy.
    private static let discardedCategoryNames = words("""
    BleedingAfterPregnancy BleedingDuringPregnancy BreastPain CervicalMucusQuality
    Contraceptive InfrequentMenstrualCycles IntermenstrualBleeding
    IrregularMenstrualCycles Lactation MenstrualFlow OvulationTestResult
    PersistentIntermenstrualBleeding Pregnancy PregnancyTestResult
    ProgesteroneTestResult ProlongedMenstrualPeriods SexualActivity VaginalDryness
    """)

    private static let quantityNames = words("""
    AppleSleepingWristTemperature BodyFatPercentage BodyMass BodyMassIndex
    ElectrodermalActivity Height LeanBodyMass WaistCircumference ActiveEnergyBurned
    AppleExerciseTime AppleMoveTime AppleStandTime BasalEnergyBurned
    CrossCountrySkiingSpeed CyclingCadence CyclingFunctionalThresholdPower CyclingPower
    CyclingSpeed DistanceCrossCountrySkiing DistanceCycling DistanceDownhillSnowSports
    DistancePaddleSports DistanceRowing DistanceSkatingSports DistanceSwimming
    DistanceWalkingRunning DistanceWheelchair EstimatedWorkoutEffortScore FlightsClimbed
    NikeFuel PaddleSportsSpeed PhysicalEffort PushCount RowingSpeed RunningPower
    RunningSpeed StepCount SwimmingStrokeCount UnderwaterDepth WorkoutEffortScore
    EnvironmentalAudioExposure EnvironmentalSoundReduction HeadphoneAudioExposure
    AtrialFibrillationBurden HeartRate HeartRateRecoveryOneMinute
    HeartRateVariabilitySDNN PeripheralPerfusionIndex RestingHeartRate VO2Max
    WalkingHeartRateAverage AppleWalkingSteadiness RunningGroundContactTime
    RunningStrideLength RunningVerticalOscillation SixMinuteWalkTestDistance
    StairAscentSpeed StairDescentSpeed WalkingAsymmetryPercentage
    WalkingDoubleSupportPercentage WalkingSpeed WalkingStepLength DietaryBiotin
    DietaryCaffeine DietaryCalcium DietaryCarbohydrates DietaryChloride
    DietaryCholesterol DietaryChromium DietaryCopper DietaryEnergyConsumed
    DietaryFatMonounsaturated DietaryFatPolyunsaturated DietaryFatSaturated
    DietaryFatTotal DietaryFiber DietaryFolate DietaryIodine DietaryIron
    DietaryMagnesium DietaryManganese DietaryMolybdenum DietaryNiacin
    DietaryPantothenicAcid DietaryPhosphorus DietaryPotassium DietaryProtein
    DietaryRiboflavin DietarySelenium DietarySodium DietarySugar DietaryThiamin
    DietaryVitaminA DietaryVitaminB12 DietaryVitaminB6 DietaryVitaminC
    DietaryVitaminD DietaryVitaminE DietaryVitaminK DietaryWater DietaryZinc
    BloodAlcoholContent BloodPressureDiastolic BloodPressureSystolic InsulinDelivery
    NumberOfAlcoholicBeverages NumberOfTimesFallen TimeInDaylight UVExposure
    WaterTemperature BasalBodyTemperature AppleSleepingBreathingDisturbances
    ForcedExpiratoryVolume1 ForcedVitalCapacity InhalerUsage OxygenSaturation
    PeakExpiratoryFlowRate RespiratoryRate BloodGlucose BodyTemperature
    """)

    private static let categoryNames = words("""
    AppleStandHour EnvironmentalAudioExposureEvent HeadphoneAudioExposureEvent
    HighHeartRateEvent HypertensionEvent IrregularHeartRhythmEvent
    LowCardioFitnessEvent LowHeartRateEvent MindfulSession AppleWalkingSteadinessEvent
    HandwashingEvent ToothbrushingEvent BleedingAfterPregnancy BleedingDuringPregnancy
    CervicalMucusQuality Contraceptive InfrequentMenstrualCycles
    IntermenstrualBleeding IrregularMenstrualCycles Lactation MenstrualFlow
    OvulationTestResult PersistentIntermenstrualBleeding Pregnancy PregnancyTestResult
    ProgesteroneTestResult ProlongedMenstrualPeriods SexualActivity SleepApneaEvent
    SleepAnalysis AbdominalCramps Acne AppetiteChanges BladderIncontinence Bloating
    BreastPain ChestTightnessOrPain Chills Constipation Coughing Diarrhea Dizziness
    DrySkin Fainting Fatigue Fever GeneralizedBodyAche HairLoss Headache Heartburn
    HotFlashes LossOfSmell LossOfTaste LowerBackPain MemoryLapse MoodChanges Nausea
    NightSweats PelvicPain RapidPoundingOrFlutteringHeartbeat RunnyNose
    ShortnessOfBreath SinusCongestion SkippedHeartbeat SleepChanges SoreThroat
    VaginalDryness Vomiting Wheezing AudioExposureEvent
    """)

    private static let characteristicNames = words("""
    ActivityMoveMode BiologicalSex BloodType DateOfBirth FitzpatrickSkinType WheelchairUse
    """)

    private static let scoredAssessmentNames = words("GAD7 PHQ9")

    private static func words(_ value: String) -> [String] {
        value.split(whereSeparator: \Character.isWhitespace).map(String.init)
    }
}
