import { JoinFlow } from "@/components/AuthForms";
import SiteFooter from "@/components/SiteFooter";
import { currentAccount } from "@/lib/auth";

export const metadata = { title: "Join · E-Cinema" };
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const me = await currentAccount();
  return (
    <section className="auth">
      <div className="auth-hero">
        <h1>{me ? "One person, one seat" : "Your seat is waiting"}</h1>
        <p>{me ? "No shared logins, no bots buying up premieres. That is how we keep tickets fair." : "Join free. Upgrade when you want to talk, request older films or bring the whole group."}</p>
      </div>
      <JoinFlow startAt={me ? 2 : 1} identityStatus={me?.faceVerified ? "approved" : undefined} />
      <SiteFooter />
    </section>
  );
}
