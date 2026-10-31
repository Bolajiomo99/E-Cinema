import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { findShowtime } from "@/lib/catalog";
import { countryName, currencyFor, money, PLANS, priceOf, type PlanId } from "@/lib/plans";
import {
  AccountSection, DataSaverSection, LanguageSection, NotificationsSection, PlanSection, PrivacySection, SecuritySection,
  type Bill, type ProfileData, type SettingsData,
} from "@/components/settings/Sections";

export const dynamic = "force-dynamic";

const TITLES: Record<string, string> = {
  account: "Account", security: "Security and devices", language: "Language and region", plan: "Plan and payments",
  notifications: "Notifications", "data-saver": "Data saver", privacy: "Privacy and data",
};

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  return { title: `${TITLES[(await params).section] ?? "Settings"} · Settings · E-Cinema` };
}

export default async function SettingsSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ signedOut?: string }> }) {
  const { section } = await params;
  if (!TITLES[section]) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const me = await currentAccount();
  if (!me || !session) redirect(`/signin?next=/settings/${section}`);
  const [s, p] = await Promise.all([
    accountApi("GET", "/v1/me/settings", undefined, session),
    accountApi("GET", "/v1/me/profile", undefined, session),
  ]);
  if (s.status !== 200) redirect(`/signin?next=/settings/${section}`);
  const settings = s.body as SettingsData;
  const profile = (p.status === 200 ? p.body : { plan: "free", planStatus: "active" }) as ProfileData;
  const currency = currencyFor(profile.country);
  const countryLabel = profile.country ? `${countryName(profile.country)} · prices in ${currency === "NGN" ? "naira" : currency === "EUR" ? "euro" : "US dollars"}` : "Not set yet · prices in US dollars";

  switch (section) {
    case "account": {
      const pk = await accountApi("GET", "/v1/passkeys", undefined, session);
      const passkeys = pk.status === 200 ? (pk.body as { passkeys: { id: string; name: string; createdAt: string; lastUsedAt?: string }[] }).passkeys : [];
      return <AccountSection me={me} settings={settings} profile={profile} passkeys={passkeys} countryLabel={countryLabel} googleReady={googleEnabled} />;
    }
    case "security": {
      const d = await accountApi("GET", "/v1/devices", undefined, session);
      const { devices, max } = (d.status === 200 ? d.body : { devices: [], max: 2 }) as { devices: { id: string; device: string; lastSeenAt: string; current: boolean }[]; max: number };
      return <SecuritySection me={me} settings={settings} devices={devices} max={max} signedOutOldest={Boolean((await searchParams).signedOut)} />;
    }
    case "language": {
      const sym = currency === "NGN" ? "₦ NGN" : currency === "EUR" ? "€ EUR" : "$ USD";
      return <LanguageSection profile={profile} settings={settings} countryLabel={`${profile.country ? countryName(profile.country) : "Not set"} · ${sym}`} />;
    }
    case "plan": {
      const planId = (PLANS.some((x) => x.id === profile.plan) ? profile.plan : "free") as PlanId;
      const plan = PLANS.find((x) => x.id === planId)!;
      const amount = priceOf(planId, currency);
      const price = planId === "free" ? "Free" : `${money(amount, currency)} ${plan.per === "seat" ? "a seat a month" : "a month"}`;
      const pending = PLANS.find((x) => x.id === profile.pendingPlan && x.id !== planId);
      const renewDate = profile.renewsAt ? new Date(profile.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
      const renews = planId === "free" ? plan.blurb
        : profile.planStatus === "awaiting_payment" ? `Waiting for your first payment · ${plan.blurb}`
        : `${renewDate ? `Renews ${renewDate} through PayPal` : "Paid through PayPal"}${pending ? ` · Switching to ${pending.name} once you approve it` : ""}`;
      const t = await accountApi("GET", "/v1/me/tickets", undefined, session);
      const tickets = (t.status === 200 ? (t.body as { tickets?: unknown[] }).tickets ?? (Array.isArray(t.body) ? t.body : []) : []) as { holdId: string; showtimeId: string; seats: number; status: string; createdAt: string }[];
      const bills: Bill[] = tickets.filter((x) => x.status === "paid").map((x) => {
        const st = findShowtime(x.showtimeId);
        const value = st ? Number(st.price.value) * x.seats : 0;
        return {
          id: x.holdId,
          date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(x.createdAt)),
          what: `${st?.film ?? "Ticket"}, ${x.seats} ${x.seats === 1 ? "seat" : "seats"}`,
          amount: st ? new Intl.NumberFormat("en", { style: "currency", currency: st.price.currency }).format(value) : "",
        };
      });
      return <PlanSection plan={plan} price={price} renews={renews} bills={bills} paidPlan={planId !== "free"} subscribed={Boolean(profile.subscribed)} pendingPay={profile.planStatus === "awaiting_payment" || Boolean(pending)} />;
    }
    case "notifications":
      return <NotificationsSection settings={settings} />;
    case "data-saver":
      return <DataSaverSection settings={settings} />;
    case "privacy":
      return <PrivacySection settings={settings} />;
  }
  notFound();
}
