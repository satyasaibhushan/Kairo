import HealthKit

/// The complete standard HealthKit read surface exposed by the installed SDK.
///
/// Raw identifier strings let the app keep an exhaustive catalog while still
/// running on older iOS versions: unsupported identifiers simply fail to
/// produce an object type and are omitted from the authorization request.
enum HealthDataCatalog {
    static var readTypes: Set<HKObjectType> {
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

        return types
    }

    static var availableTypeCount: Int { readTypes.count }
    static var sampleTypes: [HKSampleType] {
        readTypes
            .compactMap { $0 as? HKSampleType }
            .sorted { $0.identifier < $1.identifier }
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
