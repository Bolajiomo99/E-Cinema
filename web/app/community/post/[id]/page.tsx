import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DashShell } from "@/components/dash/DashShell";
import TopNav from "@/components/dash/TopNav";
import SinglePost from "@/components/community/SinglePost";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { post } from "@/lib/community";
import { readLocale } from "@/lib/locale";

// One post with its comments, the page that notifications and shared links open.
export const dynamic = "force-dynamic";
export const metadata = { title: "Post · Community · E-Cinema" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9][0-9]{0,18}$/.test(id)) notFound();
  const me = await currentAccount();
  if (!me) redirect(`/signin?next=/community/post/${id}`);
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const [p, prof, loc] = await Promise.all([post(session, id), accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null), readLocale()]);
  if (!p) notFound();
  const lang = (prof?.status === 200 ? (prof.body as { appLanguage?: string }).appLanguage : "") || loc.lang || "en";
  return (
    <DashShell>
      <div className="cm-page">
        <TopNav me={me} active="community" t={loc.t} country={loc.country} lang={loc.lang} />
        <div className="cm-single">
          <Link href={p.community ? `/community/${p.community.slug}` : "/community"} className="cm-link">‹ Back to {p.community?.name ?? "your feed"}</Link>
          <SinglePost post={p} me={{ id: me.id, name: me.name, lang: lang.split("-")[0] }} />
        </div>
      </div>
    </DashShell>
  );
}
