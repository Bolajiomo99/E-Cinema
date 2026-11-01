import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DashShell } from "@/components/dash/DashShell";
import TopNav from "@/components/dash/TopNav";
import GroupApp from "@/components/community/GroupApp";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { group, posts } from "@/lib/community";
import type { Party } from "@/lib/parties";
import { readLocale } from "@/lib/locale";

// Built from the Figma frame "Web / Community · Group page" (96:1566).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} · Community · E-Cinema` };
}

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/community/${slug}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const [g, feed, mine, prof, loc] = await Promise.all([
    group(session, slug), posts(session, new URLSearchParams({ community: slug })),
    accountApi("GET", "/v1/me/parties", undefined, session).catch(() => null),
    accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null), readLocale(),
  ]);
  if (!g) notFound();
  const lang = (prof?.status === 200 ? (prof.body as { appLanguage?: string }).appLanguage : "") || loc.lang || "en";
  const myParties = mine?.status === 200 ? ((mine.body as Party[]) ?? []).map((p) => ({ code: p.code, name: p.name, film: p.film, startsAt: p.startsAt, isHost: p.isHost, visibility: p.visibility })) : [];
  return (
    <DashShell>
      <div className="cm-page">
        <TopNav me={me} active="community" t={loc.t} country={loc.country} lang={loc.lang} />
        <GroupApp me={{ id: me.id, name: me.name, lang: lang.split("-")[0] }} group={g.community} parties={g.parties ?? []} posts={feed.posts} more={feed.more} myParties={myParties} />
      </div>
    </DashShell>
  );
}
