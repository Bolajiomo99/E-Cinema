import { SignInForm } from "@/components/AuthForms";
import SiteFooter from "@/components/SiteFooter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · E-Cinema" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <section className="auth">
      <SignInForm initialError={error} />
      <SiteFooter />
    </section>
  );
}
