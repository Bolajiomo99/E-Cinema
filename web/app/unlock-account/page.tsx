import Logo from "@/components/landing/Logo";
import { UnlockCard } from "@/components/auth/CardAuth";

export const metadata = { title: "Unlock your account · E-Cinema" };

// Opened from email 33 (Figma 127:215) after five failed face checks lock the account.
export default async function UnlockAccountPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <main className="ca">
      <header className="ca-top"><Logo /></header>
      <UnlockCard initialEmail={typeof email === "string" ? email.slice(0, 254) : ""} />
    </main>
  );
}
