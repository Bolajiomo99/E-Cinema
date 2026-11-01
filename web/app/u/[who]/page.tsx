import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DashShell } from "@/components/dash/DashShell";
import TopNav from "@/components/dash/TopNav";
import ProfileApp from "@/components/community/ProfileApp";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { posts, profilePage } from "@/lib/community";
import { readLocale } from "@/lib/locale";

// Built from the Figma frames "Web / Profile" (32:1060), "· Reviews" (95:1863) and "· Badges" (95:2002).
export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · E-Cinema" };
const TABS = ["posts", "clips", "watched", "reviews", "badges"] as const;

export default async function ProfileRoute({ params, searchParams }: { params: Promise<{ who: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { who: raw } = await params;
  const who = decodeURIComponent(raw).toLowerCase();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/u/${encodeURIComponent(who)}`);
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9._]{3,20}|me)$/.test(who)) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const [page, loc] = await Promise.all([profilePage(session, who === "me" ? me.id : who), readLocale()]);
  if (!page) notFound();
  const feed = await posts(session, new URLSearchParams({ author: page.id }));
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "posts";
  return (
    <DashShell>
      <div className="pf-page">
        <TopNav me={me} active="community" t={loc.t} country={loc.country} lang={loc.lang} />
        <ProfileApp key={page.id} page={page} posts={feed.posts} more={feed.more} tab={tab} />
      </div>
    </DashShell>
  );
}
