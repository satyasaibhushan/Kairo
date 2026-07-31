import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticateOwner, createOwnerSession, getOwner, safeReturnPath } from "../auth";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const returnTo = safeReturnPath(parameters.returnTo ?? "/health");
  if (await getOwner()) redirect(returnTo);

  async function signIn(formData: FormData) {
    "use server";
    const password = formData.get("password");
    const destination = safeReturnPath(String(formData.get("returnTo") ?? "/health"));
    if (typeof password !== "string" || !(await authenticateOwner(password))) {
      redirect(`/login?error=invalid&returnTo=${encodeURIComponent(destination)}`);
    }
    await createOwnerSession();
    redirect(destination);
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
        <form action={signIn}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="password">Dashboard password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
          {parameters.error === "invalid" ? (
            <p className="login-error" role="alert">That password is not correct.</p>
          ) : null}
          <button type="submit">Enter health ledger <span>→</span></button>
        </form>
        <Link className="login-back" href="/">← Return to the Kairo vision</Link>
      </section>
    </main>
  );
}
