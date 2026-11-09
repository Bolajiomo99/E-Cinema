import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import Logo from "@/components/landing/Logo";
import { myRequests, topicLabel } from "@/lib/support";

export const metadata = { title: "My requests · Help · E-Cinema", robots: { index: false } };

const STATUS: Record<string, string> = { open: "Waiting for our team", answered: "Answered", closed: "Solved" };

// The member's support requests.
export default async function MyRequests() {
  const s = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!s) redirect("/signin?next=/help/requests");
  const list = await myRequests(s);
  return (
    <main id="main" className="rq-page">
      <Logo />
      <Link href="/help" className="rq-back">← Help</Link>
      <header><h1>My requests</h1></header>
      {list.length === 0 ? <p className="rq-note">You have not written to our team yet. <Link href="/help#hc-team-h">Message our team</Link></p> : (
        <ul className="rq-mine">
          {list.map((r) => (
            <li key={r.id}>
              <Link href={`/help/r/${r.token}`}>
                <span className="rq-top"><b translate="no">{r.subject}</b><span className={`rq-st ${r.status}`}>{STATUS[r.status]}</span></span>
                <small>#{r.id} · {topicLabel(r.topic)} · {r.lastStaff ? "Our team: " : "You: "}<span translate="no">{r.last}</span></small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
