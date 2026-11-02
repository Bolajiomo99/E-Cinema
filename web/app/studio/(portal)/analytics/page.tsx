import StudioAnalytics, { type AnalyticsData } from "@/components/studio/StudioAnalytics";
import { session } from "@/lib/licensing";
import { studioPage } from "@/lib/studio";

// Figma "Studio / Analytics": Audience (37:1652) and Reach (37:2861).
export const metadata = { title: "Analytics · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

const DAYS = new Set([7, 30, 90, 365]);

export default async function StudioAnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string; days?: string }> }) {
  const q = await searchParams;
  const days = DAYS.has(Number(q.days)) ? Number(q.days) : 90;
  const tab = q.tab === "reach" ? "reach" : "audience";
  const data = await studioPage<AnalyticsData>(await session(), `analytics?days=${days}`);
  if (!data) {
    return (
      <div className="pt-body">
        <header className="bp-head"><div><h1>Analytics</h1><p>Your audience could not be loaded just now. Refresh the page to try again.</p></div></header>
      </div>
    );
  }
  return <StudioAnalytics key={`${tab}-${days}`} data={data} tab={tab} />;
}
