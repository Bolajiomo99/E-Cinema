import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell } from "@/components/dash/DashShell";
import TopNav from "@/components/dash/TopNav";
import CommunityApp from "@/components/community/CommunityApp";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { groups, person, posts, side } from "@/lib/community";
import { readLocale } from "@/lib/locale";

// Built from the Figma frame "Web / Community feed" (32:951).
export const dynamic = "force-dynamic";
export const metadata = { title: "Community · E-Cinema" };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tag?: string; author?: string; following?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/community");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const sp = await searchParams;
  const q = new URLSearchParams();
  const tag = sp.tag && /^[\p{L}\p{M}\p{N}_]{2,40}$/u.test(sp.tag) ? sp.tag.toLowerCase() : "";
  const author = sp.author && /^[0-9a-f-]{36}$/.test(sp.author) ? sp.author : "";
  if (tag) q.set("tag", tag);
  else if (author) q.set("author", author);
  else if (sp.following === "1") q.set("following", "1");
  const [list, feed, s, who, prof, loc] = await Promise.all([
    groups(session), posts(session, q), side(session), author ? person(session, author) : null,
    accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null), readLocale(),
  ]);
  const lang = (prof?.status === 200 ? (prof.body as { appLanguage?: string }).appLanguage : "") || loc.lang || "en";
  const heading = tag ? `#${tag}` : who ? who.name : author ? "Posts" : undefined;
  return (
    <DashShell>
      <div className="cm-page">
        <TopNav me={me} active="community" t={loc.t} country={loc.country} lang={loc.lang} />
        <CommunityApp me={{ id: me.id, name: me.name, lang: lang.split("-")[0] }} groups={list} posts={feed.posts} more={feed.more} query={q.toString()}
          heading={heading} side={s} author={who ? { id: who.id, name: who.name, following: who.following, followers: who.followers, posts: who.posts, country: who.country } : undefined} />
      </div>
    </DashShell>
  );
}
