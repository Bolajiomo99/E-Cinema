import type { InfraData } from "@/lib/exec";

// Infrastructure (Figma 50:469). Only what runs today: one Render region, media on Cloudflare R2,
// and a nightly database copy on R2 that is test-restored before it counts. The rest says Soon.
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => { const d = new Date(Date.parse(iso) + 3600_000); return `${d.getUTCDate()} ${M[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const ms = (v: number) => (v >= 100 ? `${Math.round(v)}` : v.toFixed(1));
const SOON = <i className="exsec-pill">Soon</i>;

export default function ExecInfra({ d, now }: { d: InfraData; now: number }) {
  const last = d.backups[0];
  const backupOk = !!last && last.restored && now - Date.parse(last.finishedAt) < 36 * 3600_000;
  const normal = d.dbPingMs < 200 && d.dbConns < d.dbMaxConns * 0.8;
  const regions: [string, string, string, number, boolean][] = [
    ["Frankfurt", "Render · web, API, database, workflows", "live", Math.min(100, (d.dbConns / Math.max(1, d.dbMaxConns)) * 100), true],
    ["Eastern US", "Cloudflare R2 · films, dubs, backups", "live", 0, true],
    ["Lagos", "Planned", "plan", 0, false], ["Virginia", "Planned", "plan", 0, false], ["Mumbai", "Planned", "plan", 0, false], ["São Paulo", "Planned", "plan", 0, false],
  ];
  const copies: [string, string, string, React.ReactNode][] = [
    ["1 · Live database", `Render Postgres ${d.dbVersion}, Frankfurt`, "Real time", <span key="1" className="up">Healthy · {ms(d.dbPingMs)} ms ping</span>],
    ["2 · Hot standby", "Second region, synchronous replica", "Real time", SOON],
    ["3 · Point-in-time backup", "Render's managed recovery", "Continuous", <span key="3" className="exin-muted">Run by Render, not checked by us</span>],
    ["4 · Different cloud", "Cloudflare R2, encrypted at rest", "Every night", last ? <span key="4" className={backupOk ? "up" : "down"}>{last.restored ? `Restored test OK · ${when(last.finishedAt)}` : `Not restored · ${when(last.finishedAt)}`}</span> : <span key="4" className="exin-muted">First copy tonight, 01:00</span>],
    ["5 · Offline vault", "Immutable, 90-day lock", "Every night", SOON],
  ];
  const ifDown: [string, boolean][] = [
    ["Players keep playing from the buffer while they reconnect", true],
    ["Payments are confirmed by provider webhooks and never charged twice", true],
    ["Chat messages are stored and shown in order when people return", true],
    ["Traffic moves to another region automatically", false],
    ["Android keeps downloads and tickets working offline", false],
  ];
  return (
    <section className="exc exin">
      <header className="exc-head">
        <div>
          <h1>Infrastructure</h1>
          <p className="exc-sub">What runs E-Cinema today, measured live. More regions and copies are on the way to 10 million people at once.</p>
        </div>
        <div className="epf-acts">
          <span className={`exin-state ${normal ? "" : "bad"}`}>{normal ? "ALL SYSTEMS NORMAL" : "CHECK NEEDED"}</span>
          <span className="exr-prev" title="Needs a second region">Run failover drill <small>Soon</small></span>
        </div>
      </header>

      <div className="exc-tiles exin-tiles">
        <div className="exc-tile"><span>Concurrent viewers</span><b>{d.viewersNow.toLocaleString("en-US")}</b><small>peak on one screening today: {d.peakToday.toLocaleString("en-US")}</small></div>
        <div className="exc-tile"><span>API p99</span><b>{d.requests ? `${ms(d.p99Ms)} ms` : "–"}</b><small className={d.p99Ms < 150 ? "up" : "down"}>{d.requests ? `p50 ${ms(d.p50Ms)} ms · last ${d.requests.toLocaleString("en-US")} requests` : "no requests yet"}</small></div>
        <div className="exc-tile"><span>Stream start p95</span><b className="exin-soon">Soon</b><small>measured from the players</small></div>
        <div className="exc-tile"><span>Uptime 90 days</span><b className="exin-soon">Soon</b><small>needs the UptimeRobot key</small></div>
        <div className="exc-tile"><span>Last failover drill</span><b className="exin-soon">None yet</b><small>one region today</small></div>
      </div>

      <div className="exc-card">
        <h2>Regions</h2>
        <div className="exin-regions">
          {regions.map(([n, s, st, load, on]) => (
            <div key={n} className={`exin-reg ${on ? "" : "off"}`}>
              <div className="exin-reg-h"><b>{n}</b><i className={st === "live" ? "ok" : ""} /></div>
              <small>{s}</small>
              {on && <span className="exin-load"><em style={{ width: `${Math.max(4, load)}%` }} /></span>}
            </div>
          ))}
        </div>
        <p className="epf-hint">The bar is database connections in use ({d.dbConns} of {d.dbMaxConns}). Planned regions are not running yet.</p>
      </div>

      <div className="exc-card">
        <h2>Copies of the database</h2>
        <div className="exn-table" role="table" aria-label="Copies of the database">
          <div className="exn-th exin-g" role="row"><span>Copy</span><span>Where</span><span>How often</span><span>Last check</span></div>
          {copies.map(([c, w, h, l]) => (
            <div key={c} className="exn-tr exin-g" role="row"><span className="exin-copy">{c}</span><span>{w}</span><span>{h}</span><span>{l}</span></div>
          ))}
        </div>
        {last && <p className="epf-hint">Last copy: {size(last.bytes)}, {last.tables} tables read back from a scratch restore. The database is {size(d.dbBytes)}.</p>}
      </div>

      <div className="exc-row exin-row">
        <div className="exc-card">
          <h2>If the internet or a region goes down</h2>
          {ifDown.map(([t, ok]) => <div key={t} className="exin-chk"><span className={ok ? "y" : "n"}>{ok ? "✓" : "…"}</span>{t}{!ok && <small className="exsec-soon">Soon</small>}</div>)}
        </div>
        <div className="exc-card">
          <h2>Load right now</h2>
          <div className="exin-kv"><span>Database connections</span><b>{d.dbConns} of {d.dbMaxConns}</b></div>
          <div className="exin-kv"><span>Database size</span><b>{size(d.dbBytes)}</b></div>
          <div className="exin-kv"><span>Chat messages, 24 hours</span><b>{d.messages24h.toLocaleString("en-US")}</b></div>
          <div className="exin-kv"><span>Seats held, 24 hours</span><b>{d.seats24h.toLocaleString("en-US")}</b></div>
          <div className="exin-kv"><span>Load test for 10 million</span>{SOON}</div>
        </div>
      </div>
    </section>
  );
}
