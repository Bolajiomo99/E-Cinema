import Link from "next/link";
import { notFound } from "next/navigation";
import Logo from "@/components/landing/Logo";
import RequestThread from "@/components/help/RequestThread";
import { requestByToken, topicLabel } from "@/lib/support";

export const metadata = { title: "Your request · Help · E-Cinema", robots: { index: false } };

const STATUS: Record<string, string> = { open: "Waiting for our team", answered: "Answered", closed: "Solved" };

// A support request behind its private link: the whole conversation and a reply box.
export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(token);
  if (!r) notFound();
  return (
    <main id="main" className="rq-page">
      <Logo />
      <Link href="/help" className="rq-back">← Help</Link>
      <header>
        <p className="lp-eyebrow">REQUEST #{r.id} · {topicLabel(r.topic).toUpperCase()}</p>
        <h1 translate="no">{r.subject}</h1>
        <span className={`rq-st ${r.status}`}>{STATUS[r.status]}</span>
      </header>
      <RequestThread messages={r.messages ?? []} post={`/api/support/t/${token}`} label={r.status === "closed" ? "Write here to open it again" : "Add a message for our team"} />
      <p className="rq-note">Anyone with this link can read this conversation, so keep it to yourself.</p>
    </main>
  );
}
