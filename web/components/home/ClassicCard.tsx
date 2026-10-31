import Link from "next/link";
import type { Classic } from "@/lib/classics";

// "Bring back a classic" band from Figma Home (17:308), showing the most requested title.
export default function ClassicCard({ top }: { top?: Classic }) {
  return (
    <section className="lp-section">
      <div className="hm-classic">
        <span className="hm-classic-ic" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="2" /><path d="m7 2 5 4 5-4" /></svg>
        </span>
        <div className="hm-classic-t">
          <div className="hm-classic-h"><h2>Bring back a classic</h2><span className="lp-badge pro">PRO</span></div>
          <p>Pro and Enterprise members request older films. When enough people ask, the studio screens it again for one night.</p>
        </div>
        {top && (
          <div className="hm-classic-p">
            <strong>{top.title}{top.year ? ` (${top.year})` : ""}</strong>
            <span className="cl-bar"><span style={{ width: `${Math.min(100, Math.round((top.requests / top.goal) * 100))}%` }} /></span>
            <small>{top.requests.toLocaleString("en-US")} of {top.goal.toLocaleString("en-US")} requests</small>
          </div>
        )}
        <Link href="/classics" className="lp-btn secondary hm-classic-btn">Request a film</Link>
      </div>
    </section>
  );
}
