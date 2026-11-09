import Logo from "@/components/landing/Logo";
import { LockCard } from "@/components/auth/CardAuth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lock your account · E-Cinema", robots: { index: false } };

// Opened from "This wasn't me" in the password-changed email. Locking needs a tap,
// so mail scanners that open links cannot lock the account by themselves.
export default async function LockPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  return (
    <main id="main" className="ca">
      <header className="ca-top"><Logo /></header>
      <LockCard token={t.slice(0, 200)} />
    </main>
  );
}
