import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Logo from "@/components/landing/Logo";
import AccountMenu from "@/components/AccountMenu";
import { DeleteCard } from "@/components/settings/Sections";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delete your account · E-Cinema", robots: { index: false } };

// Figma "Web / Settings · Delete account" (96:1493).
export default async function DeletePage() {
  const me = await currentAccount();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!me || !session) redirect("/signin?next=/account/delete");
  const [u, p] = await Promise.all([
    accountApi("GET", "/v1/me/upcoming", undefined, session),
    accountApi("GET", "/v1/me/profile", undefined, session),
  ]);
  const tickets = u.status === 200 ? (u.body as { tickets: number }).tickets : 0;
  const plan = p.status === 200 ? (p.body as { plan: string }).plan : "free";
  return (
    <main id="main" className="ca st-del">
      <header className="ca-top st-del-top"><Logo /><AccountMenu name={me.name} email={me.email} /></header>
      <DeleteCard tickets={tickets} plan={plan} />
    </main>
  );
}
