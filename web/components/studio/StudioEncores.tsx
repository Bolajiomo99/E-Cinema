"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import LocalWhen from "@/components/dash/LocalWhen";
import { scall } from "./scall";

// Encores after sell-out (Studio / Premieres): once every seat is sold, E-Cinema proposes the
// next screening a week later, and it goes on sale when someone at the studio approves it.
type Encore = { n: number; startsAt: string; status: "proposed" | "approved" | "declined"; showtimeId?: string; sold: number; capacity: number };

export default function StudioEncores({ upload, allowed, canEdit }: { upload: string; allowed: number; canEdit: boolean }) {
  const [list, setList] = useState<Encore[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    scall<{ encores: Encore[] }>("GET", `uploads/${upload}/encores`).then((r) => { if (on) setList(r.encores); }).catch(() => { if (on) setList([]); });
    return () => { on = false; };
  }, [upload]);

  async function decide(n: number, approve: boolean) {
    setBusy(n); setErr("");
    try {
      const r = await scall<{ encore: Encore }>("PUT", `uploads/${upload}/encores/${n}`, { approve });
      setList((l) => l?.map((e) => (e.n === n ? { ...e, ...r.encore, sold: 0, capacity: e.capacity } : e)) ?? l);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(0); }
  }

  if (!list) return null;
  if (!list.length) return <p className="pt-hint stpr-enc-note">{allowed ? `If every seat sells, we propose encore 1 for a week later. You approve each one before it goes on sale.` : "Encores are off for this film."}</p>;
  return (
    <div className="stpr-enc">
      <ul>
        {list.map((e) => (
          <li key={e.n}>
            <span><b>Encore {e.n}</b><small><LocalWhen iso={e.startsAt} />{e.status === "approved" ? ` · ${e.sold.toLocaleString("en-US")} of ${e.capacity.toLocaleString("en-US")} seats sold` : ""}</small></span>
            {e.status === "proposed" ? (
              canEdit ? (
                <span className="pt-btns">
                  <button type="button" className="vf-btn sm red" disabled={busy === e.n} onClick={() => void decide(e.n, true)}>Approve</button>
                  <button type="button" className="vf-btn sm ghost" disabled={busy === e.n} onClick={() => void decide(e.n, false)}>Decline</button>
                </span>
              ) : <em className="stpr-enc-st">Waiting for an owner or admin</em>
            ) : e.status === "approved" && e.showtimeId ? (
              <Link className="stpr-enc-st on" href={`/film/${e.showtimeId}`}>On sale</Link>
            ) : <em className="stpr-enc-st">Declined</em>}
          </li>
        ))}
      </ul>
      {err && <p className="vf-err" role="alert">{err}</p>}
    </div>
  );
}
