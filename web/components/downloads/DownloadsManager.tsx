"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { deviceId, download, localFiles, onMobileData, readSettings, removeLocal, saveSettings, setExpiry, smartQuality, storageUse, type LocalFile, type Progress, type Settings } from "@/lib/offline";
import OfflineShell from "@/components/downloads/OfflineShell";

// Downloads (Figma 31:743): films kept for good, sealed on this device, playable only here.
export type Owned = { id: string; film: string; language: string; runtimeMin: number; colors: string[] };
export type Remote = { showtimeId: string; film: string; device: string; quality: "sd" | "hd"; sizeBytes: number; audio: string[]; expiresAt: string };

const GB = 1024 ** 3;
const gb = (b: number) => (b <= 0 ? "0 GB" : b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
const QUALITY = { hd: "HD 720p", sd: "Data saver 360p" } as const;

export default function DownloadsManager({ owned, remote: remote0, title }: { owned: Owned[]; remote: Remote[]; title: ReactNode }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [remote, setRemote] = useState(remote0);
  const [busy, setBusy] = useState<Record<string, Progress | "starting">>({});
  const [err, setErr] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [use, setUse] = useState({ used: 0, quota: 0 });
  const [device, setDevice] = useState("");
  const aborts = useRef<Record<string, AbortController>>({});

  const refresh = useCallback(async () => {
    setFiles(await localFiles().catch(() => []));
    setUse(await storageUse());
  }, []);

  useEffect(() => {
    setDevice(deviceId());
    setSettings(readSettings());
    refresh();
  }, [refresh]);

  // Coming back online renews every licence on this device, or clears ones that were revoked.
  useEffect(() => {
    if (!device || !navigator.onLine) return;
    (async () => {
      for (const f of await localFiles().catch(() => [])) {
        if (!f.done) continue;
        const r = await fetch(`/api/downloads/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, quality: f.quality, sizeBytes: f.size, audio: f.audio }) }).catch(() => null);
        if (r?.ok) await setExpiry(f.id, ((await r.json()) as { expiresAt: string }).expiresAt);
        else if (r && (r.status === 402 || r.status === 410)) await removeLocal(f.id);
      }
      refresh();
    })();
  }, [device, refresh]);

  const limit = (settings?.limitGB ?? 20) * GB;
  const mine = files.reduce((n, f) => n + f.size, 0);

  const start = async (o: Owned) => {
    setErr("");
    if (!settings) return;
    if (settings.wifiOnly && onMobileData()) return setErr("You are on mobile data. Connect to Wi-Fi, or allow mobile data in storage settings.");
    const free = Math.max(0, Math.min(limit - mine, use.quota - use.used));
    const quality = settings.smart ? smartQuality(free) : "hd";
    setBusy((b) => ({ ...b, [o.id]: "starting" }));
    const lic = await fetch(`/api/downloads/${o.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, quality, audio: [o.language] }) });
    const out = (await lic.json().catch(() => ({}))) as { expiresAt?: string; error?: string };
    if (!lic.ok || !out.expiresAt) {
      setBusy(({ [o.id]: _, ...b }) => b);
      return setErr(out.error ?? "The download could not start");
    }
    const ctl = new AbortController();
    aborts.current[o.id] = ctl;
    try {
      const f = await download(o.id, o.film, quality, [o.language], out.expiresAt, free, (p) => setBusy((b) => ({ ...b, [o.id]: p })), ctl.signal);
      await fetch(`/api/downloads/${o.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, quality, sizeBytes: f.size, audio: f.audio }) }).catch(() => undefined);
    } catch (e) {
      if (!ctl.signal.aborted) setErr((e as Error).message || "The download stopped. Try again.");
      await fetch(`/api/downloads/${o.id}/${device}`, { method: "DELETE" }).catch(() => undefined);
    } finally {
      delete aborts.current[o.id];
      setBusy(({ [o.id]: _, ...b }) => b);
      refresh();
    }
  };

  const remove = async (id: string, dev = device) => {
    aborts.current[id]?.abort();
    if (dev === device) await removeLocal(id).catch(() => undefined);
    await fetch(`/api/downloads/${id}/${dev}`, { method: "DELETE" }).catch(() => undefined);
    setRemote((r) => r.filter((x) => !(x.showtimeId === id && x.device === dev)));
    refresh();
  };

  const here = new Set(files.map((f) => f.id));
  const elsewhere = remote.filter((r) => r.device !== device);
  const available = owned.filter((o) => !here.has(o.id) && !busy[o.id]);
  const colors = new Map(owned.map((o) => [o.id, o.colors]));

  return (
    <>
      <OfflineShell />
      <div className="tk-head">
        <div>
          {title}
          <p>Encrypted to this device. Play only inside E-Cinema.</p>
        </div>
        <button type="button" className="dl-settings-btn" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>Storage settings</button>
      </div>

      {showSettings && settings && (
        <form className="dl-settings" onSubmit={(e) => e.preventDefault()}>
          <label>Space E-Cinema may use on this device
            <select value={settings.limitGB} onChange={(e) => { const s = { ...settings, limitGB: Number(e.target.value) }; setSettings(s); saveSettings(s); }}>
              {[5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} GB</option>)}
            </select>
          </label>
          <label className="lib-check"><input type="checkbox" checked={settings.smart} onChange={(e) => { const s = { ...settings, smart: e.target.checked }; setSettings(s); saveSettings(s); }} /> Smart downloads: pick a quality that fits my space and connection</label>
          <label className="lib-check"><input type="checkbox" checked={settings.wifiOnly} onChange={(e) => { const s = { ...settings, wifiOnly: e.target.checked }; setSettings(s); saveSettings(s); }} /> Download on Wi-Fi only</label>
        </form>
      )}

      <div className="dl-meter">
        <div className="dl-meter-top"><span>{gb(mine)} used of {settings?.limitGB ?? 20} GB allowed</span><span>Smart downloads: {settings?.smart === false ? "off" : "on"}</span></div>
        <div className="dl-bar"><span style={{ width: `${Math.min(100, (mine / limit) * 100)}%` }} /></div>
      </div>

      {err && <p className="lib-err" role="alert">{err}</p>}

      <ul className="dl-list">
        {files.map((f) => {
          const p = busy[f.id];
          const prog = p && p !== "starting" ? p : null;
          const pct = prog?.total ? Math.round((prog.received / prog.total) * 100) : 0;
          const left = prog && prog.received > 0 && prog.total ? Math.ceil(((Date.now() - prog.startedAt) / prog.received) * (prog.total - prog.received) / 60000) : 0;
          const d = daysLeft(f.expiresAt);
          return (
            <li key={f.id} className="dl-row">
              <Art colors={colors.get(f.id)} film={f.film} />
              <div className="dl-info">
                <strong>{f.film}</strong>
                <span>{QUALITY[f.quality]} · {gb(f.size || prog?.total || 0)} · Audio: {f.audio.join(", ")}</span>
                {!f.done ? (
                  <>
                    <div className="dl-bar small"><span style={{ width: `${pct}%` }} /></div>
                    <em>{p ? `Downloading ${pct}%${left ? ` · ${left} min left` : ""}` : "Stopped before it finished. Delete and download again."}</em>
                  </>
                ) : (
                  <em className={d <= 7 ? "warn" : ""}>Expires in {d} day{d === 1 ? "" : "s"}{d <= 7 ? " · go online to renew" : ""}</em>
                )}
              </div>
              {f.done && <Link href={`/downloads/play/${f.id}`} className="lib-play dl-play">Play</Link>}
              <button type="button" className="dl-del" onClick={() => remove(f.id)} aria-label={`Delete ${f.film}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
              </button>
            </li>
          );
        })}
        {Object.entries(busy).filter(([id]) => !here.has(id)).map(([id]) => (
          <li key={id} className="dl-row"><Art colors={colors.get(id)} film={owned.find((o) => o.id === id)?.film ?? ""} /><div className="dl-info"><strong>{owned.find((o) => o.id === id)?.film}</strong><em>Starting…</em></div></li>
        ))}
      </ul>

      {!files.length && !Object.keys(busy).length && (
        <div className="tk-empty">
          <h2>Nothing downloaded on this device</h2>
          <p>{owned.length ? "Download a film you keep and watch it without a connection for 30 days at a time." : "Keep a film from your library after its premiere, then download it to watch offline."}</p>
          {!owned.length && <Link href="/library" className="state-btn primary">Go to your library</Link>}
        </div>
      )}

      {available.length > 0 && (
        <section className="dl-avail">
          <h2>Ready to download</h2>
          <ul className="dl-list">
            {available.map((o) => (
              <li key={o.id} className="dl-row">
                <Art colors={o.colors} film={o.film} />
                <div className="dl-info"><strong>{o.film}</strong><span>Kept · Audio: {o.language}</span></div>
                <button type="button" className="lib-ghost dl-go" onClick={() => start(o)}>Download</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="dl-avail">
          <h2>On your other device</h2>
          <ul className="dl-list">
            {elsewhere.map((r) => (
              <li key={r.showtimeId + r.device} className="dl-row">
                <Art colors={colors.get(r.showtimeId)} film={r.film} />
                <div className="dl-info"><strong>{r.film}</strong><span>{QUALITY[r.quality]}{r.sizeBytes ? ` · ${gb(r.sizeBytes)}` : ""} · expires in {daysLeft(r.expiresAt)} days</span></div>
                <button type="button" className="lib-ghost dl-go" onClick={() => remove(r.showtimeId, r.device)}>Remove there</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="dl-note">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5a524" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>
        <p>Smart downloads pick a quality that fits your storage and data plan, and only download on Wi-Fi unless you allow mobile data.</p>
      </div>
    </>
  );
}

function Art({ colors, film }: { colors?: string[]; film: string }) {
  return (
    <div className="dl-art" style={{ background: `linear-gradient(180deg, ${colors?.[0] ?? "#1b1b21"} 0%, ${colors?.[1] ?? "#0e0e12"} 55%, #000 100%)` }}>
      <span>{film}</span>
    </div>
  );
}
