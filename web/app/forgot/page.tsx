import Logo from "@/components/landing/Logo";
import { ForgotFlow } from "@/components/auth/CardAuth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password · E-Cinema" };

// Figma "Password recovery" 105:1186 → 29:556 / 105:1447 → 105:1239 → 105:1314 → 105:1357, expired 105:1402.
export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ id?: string; code?: string }> }) {
  const { id = "", code = "" } = await searchParams;
  return (
    <main className="ca">
      <header className="ca-top"><Logo /></header>
      <ForgotFlow initialId={id.slice(0, 200)} initialCode={/^\d{6}$/.test(code) ? code : ""} />
    </main>
  );
}
