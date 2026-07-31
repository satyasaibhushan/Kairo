"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const destination = safeReturnPath(parameters.get("returnTo") ?? "/health");

    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { authenticated?: boolean }) => {
        if (session.authenticated) window.location.replace(destination);
      })
      .catch(() => undefined);
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const parameters = new URLSearchParams(window.location.search);
    const destination = safeReturnPath(parameters.get("returnTo") ?? "/health");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "That password is not correct." : "Login is unavailable.");
        return;
      }
      window.location.assign(destination);
    } catch {
      setError("Could not reach Kairo. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark">K</span>
          <span>KAIRO / PRIVATE LEDGER</span>
        </div>
        <p className="login-kicker">OWNER ACCESS</p>
        <h1>The private side<br />of your life.</h1>
        <p className="login-copy">
          Health records and personal intelligence stay behind one owner session.
        </p>
        <form onSubmit={signIn}>
          <label htmlFor="password">Dashboard password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
            autoFocus
          />
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Opening…" : "Enter health ledger"} <span>→</span>
          </button>
        </form>
        <Link className="login-back" href="/">← Return to the Kairo vision</Link>
      </section>
    </main>
  );
}

function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/health";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/login") return "/health";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/health";
  }
}
