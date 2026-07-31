"use client";

import { useEffect, useMemo, useState } from "react";
import type { HealthSummary } from "./data";

export function HealthLiveDashboard({ initial }: { initial: HealthSummary }) {
  const [summary, setSummary] = useState(initial);
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/health/summary", { cache: "no-store" });
        if (!response.ok) throw new Error("Refresh failed");
        const next = (await response.json()) as HealthSummary;
        if (active) {
          setSummary(next);
          setIsLive(true);
        }
      } catch {
        if (active) setIsLive(false);
      }
    };
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const maximumDay = useMemo(
    () => Math.max(1, ...summary.days.map((day) => day.value)),
    [summary.days],
  );

  return (
    <>
      <div className="health-status-row">
        <span className={isLive ? "health-live-dot" : "health-live-dot offline"} />
        <span>{isLive ? "LIVE · REFRESHES EVERY 10 SECONDS" : "RECONNECTING"}</span>
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
          <EmptyLedger />
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
          <EmptyLedger />
        )}
      </section>
    </>
  );
}

function HealthStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptyLedger() {
  return (
    <div className="health-empty">
      <span>WAITING FOR IPHONE</span>
      <p>The ledger is ready. The first acknowledged Kairo upload will appear here.</p>
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
