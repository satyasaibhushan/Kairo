"use client";

import { useMemo, useState } from "react";

type SurfaceStatus = "LIVE" | "BRIDGE" | "API" | "DERIVED" | "LOG";
type Surface = {
  name: string;
  category: string;
  status: SurfaceStatus;
  signal: string;
  route: string;
  note: string;
};

const categories = ["All", "Body", "Attention", "Work", "Mind", "Connection", "Story"];

const surfaces: Surface[] = [
  {
    name: "Progress",
    category: "Mind",
    status: "LIVE",
    signal: "Tasks · habits · goals · checkpoints",
    route: "Existing OAuth + MCP",
    note: "The system of intention. Keep plans and targets here—not raw sensor exhaust.",
  },
  {
    name: "Time",
    category: "Attention",
    status: "LIVE",
    signal: "Focus hours · categories · personal/work",
    route: "Existing Convex + Apple apps",
    note: "The system of attention. Completed timers become evidence against plans.",
  },
  {
    name: "Apple Health",
    category: "Body",
    status: "BRIDGE",
    signal: "Rings · sleep · workouts · calories",
    route: "HealthKit iPhone companion",
    note: "Activity summaries include Move, Exercise and Stand. Sleep stages and workouts are queryable.",
  },
  {
    name: "Mood",
    category: "Body",
    status: "BRIDGE",
    signal: "Valence · emotion · daily mood",
    route: "HealthKit State of Mind + Kairo",
    note: "Two small check-ins create the ground truth the prediction engine needs.",
  },
  {
    name: "Asthma & medication",
    category: "Body",
    status: "BRIDGE",
    signal: "Inhaler puffs · dose events · sick days",
    route: "HealthKit + one-tap log",
    note: "HealthKit includes inhaler usage and medication APIs. Sick days remain a deliberate annotation.",
  },
  {
    name: "iPhone attention",
    category: "Attention",
    status: "BRIDGE",
    signal: "Screen time · categories · pickups",
    route: "Device Activity extension",
    note: "On-device Screen Time reports can expose duration, notifications and pickups with entitlement.",
  },
  {
    name: "Mac activity",
    category: "Attention",
    status: "API",
    signal: "Apps · windows · browser · idle time",
    route: "ActivityWatch local API",
    note: "Keep detailed titles local; sync classified minutes rather than private window text.",
  },
  {
    name: "Coding",
    category: "Work",
    status: "API",
    signal: "Projects · languages · debugging · reviews",
    route: "WakaTime + GitHub",
    note: "Use editor heartbeats for time and GitHub events for shipped evidence. Never infer productivity from commits alone.",
  },
  {
    name: "Work context",
    category: "Work",
    status: "API",
    signal: "Calendar · Jira · deployments · incidents",
    route: "Google Calendar + Jira + New Relic",
    note: "Import metadata and outcomes, not message bodies or production payloads.",
  },
  {
    name: "Music",
    category: "Mind",
    status: "API",
    signal: "Recently played · listening windows",
    route: "MusicKit or Spotify",
    note: "Useful as context. Treat genre or tempo interpretations as hypotheses, not mood labels.",
  },
  {
    name: "Calls & connection",
    category: "Connection",
    status: "LOG",
    signal: "Meaningful calls · people time · social energy",
    route: "Kairo check-in",
    note: "iOS does not provide a clean historical Phone log API. Count meaningful contact, not who said what.",
  },
  {
    name: "Books & learning",
    category: "Mind",
    status: "LOG",
    signal: "Books · piano · Hindi · chess · typing",
    route: "Progress habits + quick evidence",
    note: "Sessions come from Time; milestones and outcomes stay in Progress.",
  },
  {
    name: "Movies & new things",
    category: "Story",
    status: "LOG",
    signal: "Movies · recipes · travel · firsts",
    route: "Kairo natural-language log",
    note: "Subjective life events are easier to say than to integrate. Kairo turns one sentence into an event.",
  },
  {
    name: "Luck, mistakes, wins",
    category: "Story",
    status: "DERIVED",
    signal: "Fortune · lessons · achievements",
    route: "Nightly reflection",
    note: "Keep the original note. Let the model suggest tags, but never rewrite the remembered event.",
  },
  {
    name: "Blog & creation",
    category: "Story",
    status: "API",
    signal: "Drafted · published · ideas captured",
    route: "Git/RSS + Progress",
    note: "Measure the creative loop—idea, draft, publish—not vanity traffic by default.",
  },
  {
    name: "Private habit",
    category: "Body",
    status: "LOG",
    signal: "Day status · urge · recovery",
    route: "Encrypted local count",
    note: "Red-tier data: discreet labels, no content, separate retention and an instant-delete control.",
  },
];

const statusCopy: Record<SurfaceStatus, string> = {
  LIVE: "Already exists",
  BRIDGE: "Native bridge",
  API: "Direct API",
  DERIVED: "Computed",
  LOG: "Quick log",
};

const factors = [
  { label: "Sleep regularity", value: 0.71, tint: "cyan" },
  { label: "Late phone use", value: -0.63, tint: "red" },
  { label: "Exercise minutes", value: 0.46, tint: "green" },
  { label: "Deep work", value: 0.39, tint: "cyan" },
  { label: "Sick-day signal", value: -0.52, tint: "amber" },
] as const;

const phases = [
  {
    n: "00",
    time: "Week 1",
    title: "Prove the loop",
    copy: "Create the event contract, connect read-only Progress and Time, and collect morning/evening mood. Produce one nightly brief.",
    done: ["Canonical event ledger", "2× daily mood", "Progress + Time summaries", "Kairo nightly note"],
  },
  {
    n: "01",
    time: "Weeks 2–4",
    title: "Add the body",
    copy: "Ship a small iPhone companion that reads only approved HealthKit types and uploads daily aggregates.",
    done: ["Rings and workouts", "Sleep and calories", "State of Mind", "Inhaler + medication"],
  },
  {
    n: "02",
    time: "Weeks 5–8",
    title: "Add attention",
    copy: "Connect Screen Time reports, Mac activity and coding. Keep detailed app and window evidence on the originating device.",
    done: ["Phone duration", "Notifications + pickups", "Mac categories", "WakaTime + GitHub"],
  },
  {
    n: "03",
    time: "After 60–90 days",
    title: "Learn your k",
    copy: "Train a personal model with time-blocked validation. Publish only factors that beat the naïve baseline and remain stable.",
    done: ["Lagged features", "Elastic Net baseline", "Stability score", "Plain-language drivers"],
  },
  {
    n: "04",
    time: "Then",
    title: "Close the loop",
    copy: "Let Kairo run small, reversible experiments and suggest the next best action without turning your life into an alarm system.",
    done: ["Morning forecast", "One nudge maximum", "Weekly review", "N-of-1 experiments"],
  },
];

const sourceLinks = [
  ["Apple HealthKit", "https://developer.apple.com/documentation/healthkit"],
  ["Apple activity summaries", "https://developer.apple.com/documentation/healthkit/hkactivitysummary"],
  ["Apple State of Mind", "https://developer.apple.com/documentation/healthkit/hkstateofmind"],
  ["Apple Device Activity", "https://developer.apple.com/documentation/deviceactivity"],
  ["Apple MusicKit", "https://developer.apple.com/documentation/musickit"],
  ["WakaTime API", "https://wakatime.com/developers"],
  ["ActivityWatch", "https://activitywatch.net/"],
  ["Personalized mood modeling", "https://www.jmir.org/2022/4/e34015"],
  ["Mood sensing caution", "https://pubmed.ncbi.nlm.nih.gov/27025287/"],
  ["Google Calendar sync", "https://developers.google.com/workspace/calendar/api/guides/sync"],
];

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [activePhase, setActivePhase] = useState(0);
  const [modelMode, setModelMode] = useState<"predict" | "explain">("predict");

  const filteredSurfaces = useMemo(
    () =>
      activeCategory === "All"
        ? surfaces
        : surfaces.filter((surface) => surface.category === activeCategory),
    [activeCategory],
  );

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Kairo home">
          <span className="brand-mark">K</span>
          <span>KAIRO</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#surfaces">Surfaces</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#architecture">Architecture</a>
          <a href="#roadmap">Roadmap</a>
          <a href="/health">Health live</a>
        </nav>
        <a className="status-pill" href="#roadmap">
          <span />
          VISION 01
        </a>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="eyebrow">KAIRO · PRIVATE PERSONAL INTELLIGENCE</div>
          <h1>
            Kairo is the system that
            <br />
            <em>notices.</em>
          </h1>
          <p className="hero-lede">
            Kairo is a private personal intelligence system that connects what you planned, where
            your time went, how your body felt, and what actually changed. It turns consented health,
            attention and schedule signals into evidence-backed daily context—not surveillance.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#architecture">
              See how it works <span>→</span>
            </a>
            <a className="text-button" href="#roadmap">
              Build order <span>↘</span>
            </a>
          </div>
          <div className="system-spine" aria-label="Existing system foundation">
            <div>
              <small>01 · INTENTION</small>
              <strong>Progress</strong>
              <span>Goals, tasks, habits</span>
            </div>
            <i />
            <div>
              <small>02 · ATTENTION</small>
              <strong>Time</strong>
              <span>Hours, focus, context</span>
            </div>
            <i />
            <div>
              <small>03 · OPERATOR</small>
              <strong>Kairo</strong>
              <span>Conversation, review, action</span>
            </div>
          </div>
        </div>

        <div className="hero-orbit" aria-label="Conceptual daily intelligence display">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <span className="orbit-node node-a">SLEEP</span>
          <span className="orbit-node node-b">FOCUS</span>
          <span className="orbit-node node-c">BODY</span>
          <span className="orbit-node node-d">PHONE</span>
          <div className="core">
            <span>FRI · 31 JUL</span>
            <strong>+0.62</strong>
            <small>MOOD SIGNAL</small>
          </div>
          <div className="forecast-card glass-card">
            <div className="card-kicker">
              <span className="live-dot" /> ILLUSTRATIVE FORECAST
            </div>
            <p>
              Your energy is likely to hold through <strong>16:30</strong>.
            </p>
            <div className="signal-row">
              <span>Sleep regularity</span>
              <b>↑ 18%</b>
            </div>
            <div className="signal-row">
              <span>Late phone use</span>
              <b className="negative">↓ 11%</b>
            </div>
            <div className="card-action">Suggested: protect one 75-minute work block.</div>
          </div>
        </div>
      </section>

      <section className="manifesto">
        <div className="shell manifesto-grid">
          <p className="section-index">00 / THESIS</p>
          <div>
            <h2>
              You already built the first
              <br />
              three organs.
            </h2>
            <p>
              Progress knows what matters. Time knows where attention went. Kairo knows how to talk
              with you. The missing piece is memory: a common event layer that can connect them to
              health, devices, work and lived experience—without forcing every signal into one app.
            </p>
          </div>
          <div className="thesis-note">
            <span>THE SIMPLE RULE</span>
            <strong>Integrate systems of record. Do not replace them.</strong>
          </div>
        </div>
      </section>

      <section className="section shell" id="surfaces">
        <div className="section-heading">
          <div>
            <p className="section-index">01 / LIFE SURFACES</p>
            <h2>One life. Six signal families.</h2>
          </div>
          <p>
            Every surface has a different honest path: existing system, direct API, native bridge,
            derived signal, or a two-second human log.
          </p>
        </div>

        <div className="filter-row" role="group" aria-label="Filter life surfaces">
          {categories.map((category) => (
            <button
              className={activeCategory === category ? "active" : ""}
              key={category}
              onClick={() => setActiveCategory(category)}
              type="button"
            >
              {category}
            </button>
          ))}
        </div>

        <div className="surface-grid">
          {filteredSurfaces.map((surface, index) => (
            <article className="surface-card" key={surface.name}>
              <div className="surface-top">
                <span className={`status status-${surface.status.toLowerCase()}`}>
                  {statusCopy[surface.status]}
                </span>
                <span className="surface-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3>{surface.name}</h3>
              <p className="surface-signal">{surface.signal}</p>
              <div className="surface-route">{surface.route}</div>
              <p className="surface-note">{surface.note}</p>
            </article>
          ))}
        </div>

        <div className="reality-strip">
          <span>APPLE REALITY CHECK</span>
          <p>
            HealthKit is strong. Screen Time is possible but privacy-sandboxed and entitlement-gated.
            Historical Phone call details are not a clean public API. The correct fallback is a
            meaningful-call count, not brittle scraping.
          </p>
        </div>
      </section>

      <section className="intelligence-section" id="intelligence">
        <div className="shell">
          <div className="section-heading inverse">
            <div>
              <p className="section-index">02 / MOOD INTELLIGENCE</p>
              <h2>Find your k. Earn the conclusion.</h2>
            </div>
            <p>
              The goal is not to guess your mood from a universal formula. It is to learn which
              factors predict your own reported mood, at which lag, and with what confidence.
            </p>
          </div>

          <div className="model-grid">
            <div className="model-card">
              <div className="model-card-top">
                <div>
                  <span>PERSONAL MODEL / V0</span>
                  <h3>Signal contribution</h3>
                </div>
                <div className="segmented">
                  <button
                    className={modelMode === "predict" ? "active" : ""}
                    onClick={() => setModelMode("predict")}
                    type="button"
                  >
                    Predict
                  </button>
                  <button
                    className={modelMode === "explain" ? "active" : ""}
                    onClick={() => setModelMode("explain")}
                    type="button"
                  >
                    Explain
                  </button>
                </div>
              </div>
              <p className="model-caption">
                {modelMode === "predict"
                  ? "Illustrative coefficients—not your data. Positive bars predict a more pleasant mood."
                  : "k rewards out-of-sample lift and stability. A large correlation that disappears next month scores low."}
              </p>
              <div className="factor-list">
                {factors.map((factor) => (
                  <div className="factor" key={factor.label}>
                    <div className="factor-label">
                      <span>{factor.label}</span>
                      <b>
                        {factor.value > 0 ? "+" : ""}
                        {factor.value.toFixed(2)}
                      </b>
                    </div>
                    <div className="factor-track">
                      <span
                        className={`factor-bar ${factor.tint} ${factor.value < 0 ? "left" : ""}`}
                        style={{ width: `${Math.abs(factor.value) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="formula">
                <span>FACTOR SCORE</span>
                <code>kᵢ = direction × ΔCV error × stability × coverage</code>
              </div>
            </div>

            <div className="method-stack">
              {[
                ["1", "Label reality", "Morning energy + evening mood, ideally backed by Apple State of Mind valence."],
                ["2", "Build lagged features", "Today, yesterday, 3-day and 7-day baselines. Standardize against your own normal."],
                ["3", "Validate through time", "Train on the past, test on the future. Never random-shuffle a life timeline."],
                ["4", "Beat simple baselines", "The model must outperform “same as yesterday” and your rolling weekly average."],
                ["5", "Explain cautiously", "Start with Elastic Net. Report stable predictive drivers, not invented causes."],
              ].map(([n, title, copy]) => (
                <div className="method-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="model-warning">
            <strong>What the model may say:</strong>
            <span>“Late phone use predicted lower next-morning energy in 7 of 9 held-out weeks.”</span>
            <strong>What it must not say:</strong>
            <span>“Your phone caused your mood.”</span>
          </div>
        </div>
      </section>

      <section className="section shell" id="architecture">
        <div className="section-heading">
          <div>
            <p className="section-index">03 / ARCHITECTURE</p>
            <h2>A small spine, not a data empire.</h2>
          </div>
          <p>
            At personal scale, Postgres, scheduled jobs and three thin collectors are enough. No
            Kafka. No universal rewrite. No LLM sitting in front of raw health data.
          </p>
        </div>

        <div className="architecture">
          <div className="architecture-row source-row">
            {["iPhone + Watch", "Mac + Devbox", "Cloud services", "Human moments"].map((item) => (
              <div className="architecture-node" key={item}>
                <span>SOURCE</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
          <div className="flow-label">
            <i /> MINIMUM NECESSARY DATA <i />
          </div>
          <div className="architecture-row collector-row">
            {[
              ["Health bridge", "HealthKit"],
              ["Attention bridge", "Screen Time + Mac"],
              ["Connector jobs", "APIs + webhooks"],
            ].map(([title, copy]) => (
              <div className="architecture-node collector" key={title}>
                <span>EDGE COLLECTOR</span>
                <strong>{title}</strong>
                <small>{copy}</small>
              </div>
            ))}
          </div>
          <div className="flow-label">
            <i /> NORMALIZED EVENTS <i />
          </div>
          <div className="ledger-node">
            <div>
              <span>THE NEW PIECE</span>
              <h3>Life Event Ledger</h3>
              <p>Immutable source events, daily aggregates, consent, retention and provenance.</p>
            </div>
            <pre>
{`{
  type: "health.sleep",
  start: "2026-07-30T23:41+05:30",
  duration_min: 392,
  value: 0.81,
  privacy: "amber",
  source: "healthkit",
  confidence: 1.0
}`}
            </pre>
          </div>
          <div className="flow-label">
            <i /> QUERY · LEARN · ACT <i />
          </div>
          <div className="architecture-row outcome-row">
            {[
              ["Progress", "Intent vs reality"],
              ["Time", "Attention evidence"],
              ["Insight worker", "Features + k"],
              ["Kairo", "Briefs + experiments"],
            ].map(([title, copy]) => (
              <div className="architecture-node outcome" key={title}>
                <strong>{title}</strong>
                <small>{copy}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="ownership-grid">
          <article>
            <span>PROGRESS OWNS</span>
            <h3>What you intend to change.</h3>
            <p>Goals, tasks, habits, deadlines, Bingo checkpoints and explicit commitments.</p>
          </article>
          <article>
            <span>TIME OWNS</span>
            <h3>Where attention actually went.</h3>
            <p>Timers, categories, projects, focus sessions and personal/work boundaries.</p>
          </article>
          <article>
            <span>LEDGER OWNS</span>
            <h3>What happened.</h3>
            <p>Source events, aggregates, mood labels, evidence links and retention rules.</p>
          </article>
          <article>
            <span>KAIRO OWNS</span>
            <h3>What happens next.</h3>
            <p>Questions, briefings, one useful nudge, weekly diagnosis and small experiments.</p>
          </article>
        </div>
      </section>

      <section className="privacy-section">
        <div className="shell privacy-grid">
          <div>
            <p className="section-index">04 / TRUST MODEL</p>
            <h2>
              The most personal data
              <br />
              gets the least exposure.
            </h2>
            <p className="privacy-lede">
              “Jarvis” fails if it becomes surveillance with nicer typography. Raw data stays close
              to the device; the shared system receives aggregates whenever detail is unnecessary.
            </p>
          </div>
          <div className="privacy-tiers">
            <div className="privacy-tier green-tier">
              <span>GREEN</span>
              <strong>Operational</strong>
              <p>Steps, focus totals, task completion. Cloud sync allowed.</p>
            </div>
            <div className="privacy-tier amber-tier">
              <span>AMBER</span>
              <strong>Sensitive</strong>
              <p>Mood, sleep, illness, medication. Encrypted; explicit source consent.</p>
            </div>
            <div className="privacy-tier red-tier">
              <span>RED</span>
              <strong>Intimate</strong>
              <p>Private habit, notes, people. Local/default aggregate; separate delete control.</p>
            </div>
          </div>
          <div className="privacy-rules">
            {[
              ["01", "No message or call content"],
              ["02", "No raw window titles in cloud"],
              ["03", "No health data in general LLM context"],
              ["04", "Every insight links to provenance"],
              ["05", "Delete by source, category or date"],
              ["06", "Model opt-out leaves tracking intact"],
            ].map(([n, rule]) => (
              <div key={n}>
                <span>{n}</span>
                <p>{rule}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="calendar-trust-section" id="google-calendar-access">
        <div className="shell calendar-trust-grid">
          <div className="calendar-trust-intro">
            <p className="section-index">GOOGLE DATA ACCESS / READ ONLY</p>
            <h2>
              Calendar context,
              <br />
              never calendar control.
            </h2>
            <p>
              When you connect Google Calendar, Kairo reads a limited set of event details to
              understand schedule timing and meeting load. It cannot create, edit or delete events.
            </p>
            <div className="calendar-trust-actions">
              <a className="primary-button" href="/privacy">
                Read the privacy policy <span>→</span>
              </a>
              <a className="text-button" href="/health">
                Open private dashboard <span>↗</span>
              </a>
            </div>
          </div>
          <div className="calendar-trust-cards">
            <article>
              <span>01 / READS</span>
              <h3>Only useful event context.</h3>
              <p>
                Event title, start and end time, all-day status, recurrence, transparency,
                attendee count and your response status from your primary calendar.
              </p>
            </article>
            <article>
              <span>02 / USES</span>
              <h3>Daily schedule summaries.</h3>
              <p>
                Kairo derives meeting minutes, schedule timing and routine context so you can
                compare demanding days with sleep, activity and recovery.
              </p>
            </article>
            <article>
              <span>03 / PROTECTS</span>
              <h3>Encrypted and owner-controlled.</h3>
              <p>
                OAuth credentials are encrypted. Google data is not sold, used for advertising or
                shared publicly. Disconnect revokes access and removes imported events.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section shell" id="roadmap">
        <div className="section-heading">
          <div>
            <p className="section-index">05 / BUILD ORDER</p>
            <h2>Useful in a week. Intelligent in a season.</h2>
          </div>
          <p>
            Data collection is not the milestone. A useful daily loop is. Each phase must produce a
            visible benefit before another collector is added.
          </p>
        </div>

        <div className="roadmap">
          <div className="phase-tabs" role="tablist" aria-label="Roadmap phases">
            {phases.map((phase, index) => (
              <button
                aria-selected={activePhase === index}
                className={activePhase === index ? "active" : ""}
                key={phase.n}
                onClick={() => setActivePhase(index)}
                role="tab"
                type="button"
              >
                <span>{phase.n}</span>
                <div>
                  <strong>{phase.title}</strong>
                  <small>{phase.time}</small>
                </div>
              </button>
            ))}
          </div>
          <div className="phase-detail" role="tabpanel">
            <div className="phase-watermark">{phases[activePhase].n}</div>
            <span>{phases[activePhase].time}</span>
            <h3>{phases[activePhase].title}</h3>
            <p>{phases[activePhase].copy}</p>
            <div className="phase-checks">
              {phases[activePhase].done.map((item) => (
                <div key={item}>
                  <span>✓</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="day-loop">
          <div>
            <span>08:00</span>
            <strong>How are you starting?</strong>
            <p>Energy, mood, sleep confidence. Ten seconds.</p>
          </div>
          <i>→</i>
          <div>
            <span>DAY</span>
            <strong>Systems observe quietly.</strong>
            <p>Health, attention, progress and context.</p>
          </div>
          <i>→</i>
          <div>
            <span>21:30</span>
            <strong>What mattered today?</strong>
            <p>Mood, win, mistake, luck, new thing.</p>
          </div>
          <i>→</i>
          <div>
            <span>SUNDAY</span>
            <strong>Kairo explains the week.</strong>
            <p>Patterns, uncertainty and one experiment.</p>
          </div>
        </div>
      </section>

      <section className="anti-section">
        <div className="shell anti-grid">
          <div>
            <p className="section-index">06 / RESTRAINT</p>
            <h2>What we deliberately do not build.</h2>
          </div>
          <div className="anti-list">
            {[
              ["A universal new app", "Progress and Time remain independent products with clear jobs."],
              ["A giant streaming stack", "Personal scale needs boring jobs and a reliable database."],
              ["A productivity score", "Mood, health and focus are different signals—not one moral grade."],
              ["Invisible mood diagnosis", "Self-report remains ground truth; prediction is assistive and uncertain."],
              ["An LLM memory dump", "Kairo receives summaries and provenance, never every raw event by default."],
              ["An alert for everything", "One useful nudge beats a life full of notifications."],
            ].map(([title, copy], index) => (
              <div key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="final-section">
        <div className="shell final-grid">
          <div>
            <p className="section-index">07 / THE DESTINATION</p>
            <h2>
              A life you can query—
              <br />
              without reducing it to data.
            </h2>
          </div>
          <div className="query-card">
            <span>KAIRO / WEEKLY REVIEW</span>
            <p className="query">“Why did last week feel better?”</p>
            <div className="answer-line">
              <i />
              <p>
                Three factors were unusually aligned: sleep timing varied by only 34 minutes, phone
                use after midnight fell on five nights, and you completed four focused work blocks.
              </p>
            </div>
            <div className="answer-line muted">
              <i />
              <p>
                This is predictive, not causal. Confidence: moderate. Best next test: preserve the
                sleep window while allowing normal phone use for one week.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="shell footer-grid">
          <div>
            <a className="brand footer-brand" href="#top">
              <span className="brand-mark">K</span>
              <span>KAIRO</span>
            </a>
            <p>A private personal intelligence system for evidence-backed daily context.</p>
          </div>
          <div className="source-list">
            <span>PRIMARY SOURCES</span>
            {sourceLinks.map(([label, href]) => (
              <a href={href} key={href} rel="noreferrer" target="_blank">
                {label} ↗
              </a>
            ))}
          </div>
          <div className="footer-meta">
            <span>VISION 01</span>
            <span>31 JUL 2026</span>
            <a href="/privacy">PRIVACY POLICY →</a>
            <a href="#top">BACK TO TOP ↑</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
