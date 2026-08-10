import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Kairo",
  description:
    "How Kairo accesses, uses, stores and deletes personal information, including Google Calendar data.",
};

const sections = [
  {
    index: "01",
    title: "What Kairo is",
    body: (
      <>
        <p>
          Kairo is a private personal intelligence system. It combines information you choose to
          provide—including health, activity, location, music and schedule context—to build
          evidence-backed daily summaries for you.
        </p>
        <p>
          Kairo is designed for its owner. It does not sell personal information, run advertising
          profiles or make your private data publicly available.
        </p>
      </>
    ),
  },
  {
    index: "02",
    title: "Google Calendar data",
    body: (
      <>
        <p>
          If you select <strong>Connect Google Calendar</strong>, Kairo requests read-only access to
          your primary calendar. Kairo may receive event title, start and end time, all-day status,
          event type, transparency, recurrence, attendee count and your response status.
        </p>
        <p>
          Kairo uses these fields to calculate schedule timing, event duration, meeting load and
          routine context. It cannot create, modify or delete events in Google Calendar.
        </p>
        <p className="policy-callout">
          Kairo&apos;s use and transfer of information received from Google APIs adheres to the
          {" "}<a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noreferrer"
            target="_blank"
          >
            Google API Services User Data Policy
          </a>, including the Limited Use requirements.
        </p>
      </>
    ),
  },
  {
    index: "03",
    title: "Other information",
    body: (
      <>
        <p>
          With your permission, the Kairo iPhone app may collect approved HealthKit records,
          medication dose events, coarse location visits, Screen Time summaries and recent music
          listening. Weather context may be derived from a coarse location using Open-Meteo.
        </p>
        <p>
          Kairo also records technical information required to operate reliably, such as device and
          batch identifiers, sync timestamps, source identifiers and processing errors.
        </p>
      </>
    ),
  },
  {
    index: "04",
    title: "Storage and security",
    body: (
      <>
        <p>
          Data is transmitted over HTTPS to Kairo&apos;s private database. Google OAuth refresh tokens
          are encrypted with AES-256-GCM before storage. Access to the private dashboard requires an
          authenticated owner session.
        </p>
        <p>
          No system is perfectly secure, but Kairo limits collection, separates health and context
          ledgers and keeps source provenance so information can be inspected and removed.
        </p>
      </>
    ),
  },
  {
    index: "05",
    title: "Sharing and disclosure",
    body: (
      <>
        <p>
          Kairo does not sell Google user data or other personal information. It does not use Google
          user data for advertising, credit decisions or generalized model training.
        </p>
        <p>
          Information is processed by infrastructure providers only as necessary to host and operate
          Kairo, or when disclosure is required by law. Google user data is visible only through the
          owner&apos;s private Kairo experience. Access by another person would occur only when necessary
          for security, legal compliance or an action the owner explicitly requests.
        </p>
      </>
    ),
  },
  {
    index: "06",
    title: "Retention and deletion",
    body: (
      <>
        <p>
          Calendar information is retained while Google Calendar remains connected. Selecting
          <strong> Disconnect</strong> asks Google to revoke the refresh token, deletes the local
          connection and imported Calendar observations, and rebuilds affected daily context without
          those observations.
        </p>
        <p>
          You can also revoke Kairo from your Google Account permissions. To request deletion of
          other Kairo data, contact the address below.
        </p>
      </>
    ),
  },
  {
    index: "07",
    title: "Your choices",
    body: (
      <>
        <p>
          Connecting Google Calendar is optional. You may decline access and continue using Kairo&apos;s
          other features. iPhone permissions can be changed in iOS Settings, and Calendar access can
          be disconnected from Kairo&apos;s private Health dashboard at any time.
        </p>
      </>
    ),
  },
  {
    index: "08",
    title: "Changes and contact",
    body: (
      <>
        <p>
          This policy may change as Kairo evolves. Material changes will be published on this page
          with a revised effective date.
        </p>
        <p>
          For privacy questions or deletion requests, email{" "}
          <a href="mailto:satyasaibhushan@gmail.com">satyasaibhushan@gmail.com</a>.
        </p>
      </>
    ),
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <header className="policy-topbar">
        <Link className="brand" href="/" aria-label="Kairo home">
          <span className="brand-mark">K</span>
          <span>KAIRO</span>
        </Link>
        <span>PUBLIC POLICY / GOOGLE DATA DISCLOSURE</span>
      </header>

      <div className="policy-shell">
        <section className="policy-hero">
          <div>
            <p className="section-index">TRUST / PRIVACY</p>
            <h1>Privacy,<br /><em>made legible.</em></h1>
          </div>
          <div className="policy-summary">
            <strong>Kairo protects context without hiding the terms.</strong>
            <p>
              This policy explains what Kairo collects, why Google Calendar access is requested,
              how information is protected and how you can remove it.
            </p>
            <dl>
              <div><dt>Effective</dt><dd>10 August 2026</dd></div>
              <div><dt>Application</dt><dd>Kairo</dd></div>
              <div><dt>Calendar access</dt><dd>Read only</dd></div>
            </dl>
          </div>
        </section>

        <div className="policy-content">
          <aside>
            <span>POLICY INDEX</span>
            {sections.map((section) => (
              <a href={`#policy-${section.index}`} key={section.index}>
                {section.index} / {section.title}
              </a>
            ))}
          </aside>
          <div className="policy-sections">
            {sections.map((section) => (
              <section id={`policy-${section.index}`} key={section.index}>
                <span>{section.index}</span>
                <div>
                  <h2>{section.title}</h2>
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="policy-footer">
          <div>
            <span>KAIRO / PRIVATE PERSONAL INTELLIGENCE</span>
            <p>Your information remains yours.</p>
          </div>
          <Link href="/">RETURN TO KAIRO ↑</Link>
        </footer>
      </div>
    </main>
  );
}
