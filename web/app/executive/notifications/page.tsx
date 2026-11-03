import { session } from "@/lib/licensing";
import { execCampaigns } from "@/lib/exec";
import { emailEnabled } from "@/lib/email";
import ExecNotifications from "@/components/exec/ExecNotifications";

export const metadata = { title: "Notifications · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Notifications and re-engagement (Figma 51:375): announcements to members, CEO and CMO.
export default async function NotificationsPage() {
  const d = await execCampaigns(await session());
  if (!d) return <section className="exc"><h1>Notifications and re-engagement</h1><p className="exc-sub">This page is for the CEO and the CMO.</p></section>;
  return <ExecNotifications d={d} email={emailEnabled} ai={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
