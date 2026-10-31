import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DevicesList } from "@/components/AuthForms";
import SiteFooter from "@/components/SiteFooter";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";

export const metadata = { title: "Security and devices · E-Cinema" };
export const dynamic = "force-dynamic";

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ signedOut?: string }> }) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const r = session ? await accountApi("GET", "/v1/devices", undefined, session) : null;
  if (!r || r.status !== 200) redirect("/signin");
  const { devices, max } = r.body as { devices: { id: string; device: string; lastSeenAt: string; current: boolean }[]; max: number };
  const { signedOut } = await searchParams;
  return (
    <section className="auth">
      <p className="eyebrow">Settings</p>
      <h1 className="page-title">Security and devices</h1>
      {signedOut && <p className="pp-note">You were signed in on too many devices, so the oldest one was signed out.</p>}
      <DevicesList devices={devices} max={max} />
      <SiteFooter />
    </section>
  );
}
