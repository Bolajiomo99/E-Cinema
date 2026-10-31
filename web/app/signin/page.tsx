import { redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import { SignInCard } from "@/components/auth/CardAuth";
import { currentAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · E-Cinema" };

// Figma "Sign in" 16:296.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  if (!error && (await currentAccount())) redirect("/home");
  return (
    <main className="ca">
      <header className="ca-top"><Logo /></header>
      <SignInCard initialError={error} next={next} />
    </main>
  );
}
