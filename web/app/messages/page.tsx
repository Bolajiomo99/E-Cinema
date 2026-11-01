import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell } from "@/components/dash/DashShell";
import TopNav from "@/components/dash/TopNav";
import MessagesApp from "@/components/messages/MessagesApp";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import type { Conversation } from "@/lib/chat-types";
import type { Party } from "@/lib/parties";
import { readLocale } from "@/lib/locale";

// Built from the Figma frames "Web / Messages" (32:798) and "Web / Messages · Requests" (95:2163).
export const dynamic = "force-dynamic";
export const metadata = { title: "Messages · E-Cinema" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string; tab?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/messages");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const sp = await searchParams;
  const [list, prof, parties, loc] = await Promise.all([
    accountApi("GET", "/v1/me/chat", undefined, session),
    accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null),
    accountApi("GET", "/v1/me/parties", undefined, session).catch(() => null),
    readLocale(),
  ]);
  const data = list.status === 200 ? (list.body as { conversations: Conversation[]; requests: number }) : { conversations: [], requests: 0 };
  const lang = (prof?.status === 200 ? (prof.body as { appLanguage?: string }).appLanguage : "") || loc.lang || "en";
  const upcoming = parties?.status === 200 ? ((parties.body as Party[]) ?? []).filter((p) => p.joined && Date.parse(p.startsAt) > Date.now() - 3 * 3600_000) : [];
  const tab = sp.tab === "requests" || sp.tab === "friends" || sp.tab === "groups" ? sp.tab : "all";
  const open = sp.c && /^[0-9a-f-]{36}$/.test(sp.c) ? sp.c : data.conversations[0]?.id;

  return (
    <DashShell>
      <div className="msg-page">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <MessagesApp
          me={{ id: me.id, name: me.name, lang }}
          initial={data.conversations}
          requestCount={data.requests}
          parties={upcoming.map((p) => ({ code: p.code, name: p.name, film: p.film, showtimeId: p.showtimeId, startsAt: p.startsAt }))}
          openId={tab === "requests" ? undefined : open}
          initialTab={tab}
          startOnList={!sp.c}
        />
      </div>
    </DashShell>
  );
}
