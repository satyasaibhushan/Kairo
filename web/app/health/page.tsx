import Link from "next/link";
import { redirect } from "next/navigation";
import { destroyOwnerSession, requireOwner } from "../auth";
import { HealthLiveDashboard } from "./HealthLiveDashboard";
import { loadHealthSummary } from "./data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HealthPage() {
  const owner = await requireOwner("/health");
  const summary = await loadHealthSummary();

  async function signOut() {
    "use server";
    await destroyOwnerSession();
    redirect("/");
  }

  return (
    <main className="health-page">
      <header className="health-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">K</span>
          <span>KAIRO / HEALTH LEDGER</span>
        </Link>
        <div className="health-owner-actions">
          <span className="health-owner">PRIVATE · {owner.displayName}</span>
          <form action={signOut}>
            <button type="submit">LOCK</button>
          </form>
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

        <HealthLiveDashboard initial={summary} />
      </div>
    </main>
  );
}
