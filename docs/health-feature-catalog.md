# Kairo health feature catalog

All keys are namespaced, versioned daily features. `_baseline_28d`, `_delta_28d`, and `_zscore_28d` variants are derived only from prior observations.

## Mind

| Feature | Grain | Meaning |
|---|---|---|
| `mind.valence.mean` | personal day | Mean declared State of Mind valence |
| `mind.valence.latest` | personal day | Last declared valence that day |
| `mind.valence.count` | personal day | Number of State of Mind entries |
| Mood event labels and associations | event | Apple-provided self-reported context retained in metadata |

## Sleep

Sleep is reconstructed as a wake-day episode from the selected source, not by summing overlapping devices.

| Feature | Unit |
|---|---|
| `sleep.duration.asleep_hours` | h |
| `sleep.duration.in_bed_hours` | h |
| `sleep.duration.awake_hours` | h |
| `sleep.stage.core_hours` | h |
| `sleep.stage.deep_hours` | h |
| `sleep.stage.rem_hours` | h |
| `sleep.window.hours` | h |
| `sleep.efficiency.ratio` | ratio |
| `sleep.stage.deep_ratio`, `sleep.stage.rem_ratio` | ratio |
| `sleep.onset.local_hour`, `sleep.wake.local_hour`, `sleep.midpoint.local_hour` | local hour |

## Recovery and cardiovascular

Daily mean/min/max or latest values are built for heart rate, resting heart rate, walking heart rate, HRV, oxygen saturation, wrist/body temperature, respiratory rate, and related catalogued signals. A later model can combine their personal z-scores into a transparent recovery estimate; the raw components remain visible.

## Activity and workouts

Daily totals include steps, walking/running and cycling distance, flights, active/basal energy, exercise minutes, stand minutes, stand-hour success/idle counts, and physical effort. Workout features include count, total duration, activity-type mix, distance, and energy when supplied by HealthKit.

## Body, respiratory, nutrition, and environment

The catalog includes measurements such as weight and body composition; respiratory and inhaler-related records; nutrition quantities; environmental and headphone audio exposure; walking mobility; and other authorized HealthKit types. Each definition declares its canonical domain, statistic, and unit policy.

## Quality fields

Every feature row also stores source count, source sample count, coverage, quality, provenance, calculation version, and source run. A value marked `partial` or `suspect` must be surfaced with that caveat to both the dashboard and the assistant.
