# JARVIS health view model

The JARVIS surface is not a dashboard full of sensor cards. It is a compact decision view that answers five questions in order:

1. **Now** — what is materially different from Bhushan's own baseline, and how fresh/complete is the evidence?
2. **Pattern** — which earlier factors have repeatedly improved prediction of a declared target under forward-only validation?
3. **Memory** — what did Bhushan report, what happened around it, and which prior insights remain active?
4. **Attention** — what important ground truth or source coverage is missing?
5. **Action** — what single question or reversible experiment would reduce uncertainty most?

`GET /api/health/intelligence/context` now returns `kairo.jarvis.health-view.v1` with these sections. It is deliberately derived from the same daily profile and factor tables as the evidence APIs, so prose cannot silently disagree with the numbers.

## Presentation contract

- Lead with no more than 12 notable personal deviations and eight validated patterns.
- Put freshness and coverage beside the conclusion, not in a hidden tooltip.
- Label each statement as observed fact, predictive pattern, or hypothesis.
- Say “unknown” when data is absent; never render it as zero.
- Same-day associations and next-day predictions must have visibly different labels.
- State the target, lag, sample size, validation method, and uncertainty before showing `k`.
- Prefer one high-information follow-up or low-risk N-of-1 experiment over generic advice.
- Retire an insight when its evidence expires or a newer model fails to reproduce it.

## Expansion beyond HealthKit

The same view contract accepts the other JARVIS families:

- **Mind** — declared mood, symptoms, reflection, mistakes, achievements;
- **Attention** — Screen Time, pickups, notifications, focus categories;
- **Work** — timers, coding activity, projects, meetings;
- **Connection** — calls and meaningful interactions, with privacy-preserving summaries;
- **Story** — books, movies, music, blogs, new experiences, and milestones.

Each family gets its own source observations and canonical features. They meet only at the daily profile, factor, insight, and JARVIS view layers; HealthKit never becomes the accidental schema for the whole life model.
