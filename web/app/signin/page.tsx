import { SignInForm } from "@/components/AuthForms";
import SiteFooter from "@/components/SiteFooter";

export const metadata = { title: "Sign in · E-Cinema" };

export default function SignInPage() {
  return (
    <section className="auth">
      <SignInForm />
      <SiteFooter />
    </section>
  );
}
