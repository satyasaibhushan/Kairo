"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { emptyHealthSummary, type HealthSummary } from "./health-summary";

export function HealthLiveDashboard() {
  const [summary, setSummary] = useState(emptyHealthSummary);
  const [ownerName, setOwnerName] = useState("OWNER");
  const [connection, setConnection] = useState<"loading" | "live" | "offline">("loading");

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await fetch("/api/health/summary", { cache: "no-store" });
        if (response.status === 401) {
          window.location.replace("/login?returnTo=%2Fhealth");
          return;
        }
        if (!response.ok) throw new Error("Refresh failed");
        const next = (await response.json()) as HealthSummary;
        if (active) {
          setSummary(next);
          setConnection("live");
        }
      } catch {
        if (active) setConnection("offline");
      }
    };

    const start = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const session = (await response.json()) as {
          authenticated?: boolean;
          owner?: { displayName?: string };
        };
        if (!session.authenticated) {
          window.location.replace("/login?returnTo=%2Fhealth");
          return;
        }
        if (active) setOwnerName(session.owner?.displayName || "OWNER");
        await refresh();
        if (active) timer = window.setInterval(refresh, 10_000);
      } catch {
        if (active) setConnection("offline");
      }
    };

    void start();
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  const maximumDay = useMemo(
    () => Math.max(1, ...summary.days.map((day) => day.value)),
    [summary.days],
  );

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  }

  return (
    <main className="health-page">
      <header className="health-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">K</span>
          <span>KAIRO / HEALTH LEDGER</span>
        </Link>
        <div className="health-owner-actions">
          <span className="health-owner">PRIVATE · {ownerName}</span>
          <button type="button" onClick={signOut}>LOCK</button>
        </div>
      </header>

      <div className="health-shell">
        <section className="health-hero">
          <div>
            <span className="health-kicker">BODY / LIVE EVIDENCE</span>
            <h1>Your health data,<br /><em>arriving alive.</em></h1>
          </div>
          <p>
            The private receiving end of Kairo&apos;s iPhone bridge. Every record remains traceable
            to HealthKit, its source app, and the device that observed it.
          </p>
        </section>

        <div className="health-status-row">
          <span className={connection === "live" ? "health-live-dot" : "health-live-dot offline"} />
          <span>{statusLabel(connection)}</span>
          <time>{formatDate(summary.latestReceivedAt)}</time>
        </div>

        <section className="health-stat-grid" aria-label="Health ingestion status">
          <HealthStat value={summary.totalSamples.toLocaleString()} label="samples in ledger" />
          <HealthStat value={summary.trackedTypes.toLocaleString()} label="signal types observed" />
          <HealthStat value={summary.batchesReceived.toLocaleString()} label="batches acknowledged" />
        </section>

        <section className="health-panel health-volume-panel">
          <div className="health-panel-heading">
            <div>
              <span>INGESTION / 14 DAYS</span>
              <h2>Evidence arriving over time</h2>
            </div>
            <p>Raw sample count by HealthKit start date.</p>
          </div>
          {summary.days.length ? (
            <div className="health-bars">
              {summary.days.map((day) => (
                <div className="health-bar-item" key={day.day}>
                  <span style={{ height: `${Math.max(5, (day.value / maximumDay) * 100)}%` }} />
                  <small>{shortDay(day.day)}</small>
                  <b>{day.value}</b>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLedger loading={connection === "loading"} />
          )}
        </section>

        <section className="health-panel">
          <div className="health-panel-heading">
            <div>
              <span>LATEST EVIDENCE</span>
              <h2>Most recent HealthKit records</h2>
            </div>
            <p>Values remain attributable to their source app.</p>
          </div>
          {summary.latest.length ? (
            <div className="health-event-list">
              {summary.latest.map((event, index) => (
                <article key={`${event.typeIdentifier}-${event.startDate}-${index}`}>
                  <div>
                    <span>{humanType(event.typeIdentifier)}</span>
                    <small>{event.sourceName ?? "Apple Health"}</small>
                  </div>
                  <strong>{formatValue(event)}</strong>
                  <time>{formatDate(event.startDate)}</time>
                </article>
              ))}
            </div>
          ) : (
            <EmptyLedger loading={connection === "loading"} />
          )}
        </section>
      </div>
    </main>
  );
}

function statusLabel(connection: "loading" | "live" | "offline"): string {
  if (connection === "loading") return "CONNECTING TO PRIVATE LEDGER";
  if (connection === "live") return "LIVE · REFRESHES EVERY 10 SECONDS";
  return "RECONNECTING";
}

function HealthStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptyLedger({ loading }: { loading: boolean }) {
  return (
    <div className="health-empty">
      <span>{loading ? "LOADING PRIVATE LEDGER" : "WAITING FOR IPHONE"}</span>
      <p>
        {loading
          ? "The page is ready. Private data is arriving separately."
          : "The ledger is ready. The first acknowledged Kairo upload will appear here."}
      </p>
    </div>
  );
}

function humanType(identifier: string): string {
  return identifier
    .replace(/^HK(?:Quantity|Category|Data|Workout|ScoredAssessment)?TypeIdentifier/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || identifier;
}

function formatValue(event: HealthSummary["latest"][number]): string {
  if (event.numericValue !== null) {
    return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(event.numericValue)}${event.unit ? ` ${event.unit}` : ""}`;
  }
  if (event.categoryValue !== null) return `State ${event.categoryValue}`;
  return "Recorded";
}

function formatDate(value: string | null): string {
  if (!value) return "No uploads yet";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}
