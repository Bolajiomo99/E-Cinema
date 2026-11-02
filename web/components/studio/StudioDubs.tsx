"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clock, DUB_LANGS, dubLang, dubName, type Dub, type DubLine } from "@/lib/dub-types";
import type { Upload } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / AI dubbing and subtitles" (35:871): the film's languages, a line-by-line
// script to review, the voiced line to listen to, and approval that puts a dub in the room.

type Filter = "all" | "flagged" | "voice";
const PAGE = 60;
const BARS = 120;

function state(d: Dub): { pct: number; tone: "green" | "amber" | "gold" | "red"; text: string } {
  const pct = d.lines ? Math.round((d.voiced / d.lines) * 100) : 0;
  if (d.status === "approved") return { pct: 100, tone: "green", text: "Approved" };
  if (d.status === "translating") return { pct: 30, tone: "gold", text: "Translating" };
  if (d.status === "voicing") return { pct, tone: "gold", text: `Generating · ${pct}%` };
  if (d.status === "failed") return { pct: 100, tone: "red", text: "Failed" };
  if (d.flagged) return { pct, tone: "amber", text: `${d.flagged} ${d.flagged === 1 ? "line" : "lines"} to review` };
  if (d.voiced < d.lines) return { pct, tone: "amber", text: `${d.lines - d.voiced} ${d.lines - d.voiced === 1 ? "line" : "lines"} to voice` };
  return { pct: 100, tone: "green", text: "Ready to approve" };
}

function Check() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-label="Voiced" role="img"><path d="M3 8.5l3 3 7-7" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function StudioDubs({ films, upload: u, dubs: d0, selected, lines: l0, canEdit }: {
  films: { id: string; title: string }[]; upload: Upload; dubs: Dub[]; selected: string | null; lines: DubLine[]; canEdit: boolean;
}) {
  const [dubs, setDubs] = useState(d0);
  const [sel, setSel] = useState(selected);
  const [lines, setLines] = useState(l0);
  const [cur, setCur] = useState(() => Math.max(0, l0.findIndex((l) => l.flag)));
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [edit, setEdit] = useState<{ idx: number; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addLang, setAddLang] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const dub = dubs.find((d) => d.lang === sel) ?? null;
  const line = lines[cur] ?? null;
  const base = `dubs/${u.id}`;
  const ready = dubs.filter((d) => d.status === "approved").length;
  const review = dubs.filter((d) => d.status === "review").length;
  const original = u.languages.split(",")[0]?.trim();
  const editable = canEdit && dub && (dub.status === "review" || dub.status === "approved");

  const loadLines = useCallback(async (lang: string) => {
    const r = await scall<{ dub: Dub; lines: DubLine[] }>("GET", `${base}/${lang}`);
    setLines(r.lines);
    setDubs((list) => list.map((d) => (d.lang === lang ? r.dub : d)));
    return r;
  }, [base]);

  // While a language is being translated or voiced, check on it every few seconds.
  const working = dubs.some((d) => d.status === "translating" || d.status === "voicing");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => {
      try {
        const r = await scall<{ dubs: Dub[] }>("GET", base);
        const before = dubs.find((d) => d.lang === sel);
        const after = r.dubs.find((d) => d.lang === sel);
        setDubs(r.dubs);
        if (sel && after && (after.status !== before?.status || after.voiced !== before?.voiced || after.lines !== before?.lines)) await loadLines(sel);
      } catch { /* the next tick tries again */ }
    }, 4000);
    return () => clearInterval(t);
  }, [working, base, dubs, sel, loadLines]);

  function stop() {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
    setProgress(0);
  }
  useEffect(() => stop, []);

  async function pick(lang: string) {
    if (lang === sel) return;
    stop(); setErr(""); setMsg(""); setEdit(null); setFilter("all"); setShown(PAGE); setPeaks(null);
    setSel(lang);
    setLines([]);
    try {
      const r = await loadLines(lang);
      setCur(Math.max(0, r.lines.findIndex((l) => l.flag)));
    } catch (e) { setErr((e as Error).message); }
    window.history.replaceState(null, "", `/studio/dubs?film=${u.id}&lang=${lang}`);
  }

  function choose(i: number) {
    if (i === cur) return;
    stop(); setPeaks(null); setCur(i);
  }

  async function act(name: string, run: () => Promise<void>) {
    setErr(""); setMsg(""); setBusy(name);
    try { await run(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const add = () => act("add", async () => {
    if (!addLang) throw new Error("Pick a language");
    const r = await scall<{ dub: Dub }>("POST", `${base}/${addLang}`);
    setDubs((list) => [...list.filter((d) => d.lang !== addLang), r.dub]);
    setAdding(false); setAddLang("");
    setMsg(`${dubName(addLang)} added. Studio AI is translating the subtitles now.`);
    await pick(addLang);
  });

  const headAction = () => act("head", async () => {
    if (!dub) return;
    if (dub.status === "failed") {
      const r = await scall<{ dub: Dub }>("POST", `${base}/${dub.lang}`);
      setDubs((list) => list.map((d) => (d.lang === dub.lang ? r.dub : d)));
      setMsg(`Trying ${dubName(dub.lang)} again.`);
    } else if (dub.voiced < dub.lines) {
      const r = await scall<{ dub: Dub }>("POST", `${base}/${dub.lang}/voice`);
      setDubs((list) => list.map((d) => (d.lang === dub.lang ? r.dub : d)));
      setMsg(`Voicing ${dubName(dub.lang)}. Lines are voiced a few at a time; you can keep reviewing.`);
    } else {
      const r = await scall<{ dub: Dub }>("POST", `${base}/${dub.lang}/approve`);
      setDubs((list) => list.map((d) => (d.lang === dub.lang ? r.dub : d)));
      setMsg(`${dubName(dub.lang)} dub approved. Ticket holders can pick it in the watch room.`);
    }
  });

  async function saveLine(idx: number, text: string, clearFlag: boolean) {
    await act(`line${idx}`, async () => {
      const r = await scall<{ line: DubLine }>("PUT", `${base}/${sel}/lines/${idx}`, { text, clearFlag });
      setLines((list) => list.map((l) => (l.idx === idx ? r.line : l)));
      setEdit(null);
      const s = await scall<{ dubs: Dub[] }>("GET", base);
      setDubs(s.dubs);
    });
  }

  const regenerate = () => line && act("regen", async () => {
    const r = await scall<{ line: DubLine }>("POST", `${base}/${sel}/lines/${line.idx}/regenerate`);
    setLines((list) => list.map((l) => (l.idx === line.idx ? r.line : l)));
    stop(); setPeaks(null);
    const s = await scall<{ dubs: Dub[] }>("GET", base);
    setDubs(s.dubs);
    setMsg(r.line.flag ? "New line written. Studio AI still flags it; check the note." : "New line written. Voice it before approving.");
  });

  const remove = () => dub && confirm(`Remove the ${dubName(dub.lang)} dub and its voiced lines?`) && act("remove", async () => {
    await scall("DELETE", `${base}/${dub.lang}`);
    stop();
    const rest = dubs.filter((d) => d.lang !== dub.lang);
    setDubs(rest); setSel(null); setLines([]);
    setMsg(`${dubName(dub.lang)} removed.`);
    if (rest[0]) await pick(rest[0].lang);
  });

  async function play() {
    if (!line?.audioKey) return;
    if (playing) { stop(); return; }
    setErr("");
    try {
      const { url } = await scall<{ url: string }>("GET", `${base}/${sel}/lines/${line.idx}/audio`);
      const a = new Audio(url);
      audio.current = a;
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => { setPlaying(false); setProgress(0); };
      await a.play();
      setPlaying(true);
      if (!peaks) {
        // The waveform of the voiced line; if the browser cannot read it, the bars stay flat.
        fetch(url).then((r) => r.arrayBuffer()).then((buf) => new AudioContext().decodeAudioData(buf)).then((b) => {
          const data = b.getChannelData(0), step = Math.max(1, Math.floor(data.length / BARS));
          const out = Array.from({ length: BARS }, (_, i) => { let m = 0; for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(data[j])); return m; });
          const top = Math.max(...out, 0.01);
          setPeaks(out.map((v) => v / top));
        }).catch(() => {});
      }
    } catch (e) { setErr((e as Error).message); stop(); }
  }

  const flagged = lines.filter((l) => l.flag).length;
  const unvoiced = lines.filter((l) => !l.audioKey).length;
  const list = lines.map((l, i) => ({ l, i })).filter(({ l }) => filter === "all" || (filter === "flagged" ? l.flag : !l.audioKey));
  const st = dub ? state(dub) : null;
  const head = !dub ? null
    : dub.status === "failed" ? { label: `Try ${dubName(dub.lang)} again`, ok: true }
    : dub.status === "translating" || dub.status === "voicing" ? { label: `Working on ${dubName(dub.lang)}`, ok: false }
    : dub.status === "approved" ? { label: `${dubName(dub.lang)} dub approved`, ok: false }
    : dub.voiced < dub.lines ? { label: `Voice ${dubName(dub.lang)} dub`, ok: true }
    : { label: `Approve ${dubName(dub.lang)} dub`, ok: dub.flagged === 0 };
  const hasSubs = u.files.some((f) => f.kind === "subtitles" && f.status === "uploaded");
  const free = DUB_LANGS.filter((l) => !dubs.some((d) => d.lang === l.code));

  return (
    <div className="pt-body stdb">
      <header className="bp-head">
        <div>
          <h1>AI dubbing and subtitles</h1>
          <p>{u.title} · {ready} {ready === 1 ? "language" : "languages"} ready, {review} in review</p>
        </div>
        {canEdit && head && (
          <button className="vf-btn red" disabled={!head.ok || Boolean(busy)} onClick={headAction}
            title={dub?.status === "review" && dub.flagged ? "Clear every flagged line first" : undefined}>{busy === "head" ? "Working" : head.label}</button>
        )}
      </header>
      {films.length > 1 && (
        <nav className="bp-chips" aria-label="Films">
          {films.map((f) => <Link key={f.id} className={`stpr-film${f.id === u.id ? " on" : ""}`} href={`/studio/dubs?film=${f.id}`} aria-current={f.id === u.id ? "page" : undefined}>{f.title}</Link>)}
        </nav>
      )}
      {!hasSubs && <p className="pt-hint">AI dubbing translates from the film&apos;s subtitles. <Link href={`/studio/upload/${u.id}`}>Upload an SRT, VTT or TTML file</Link> first.</p>}
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <div className="stdb-row">
        <section className="bp-panel stdb-langs" aria-label="Languages">
          <h2>Languages</h2>
          <ul>
            {dubs.map((d) => {
              const s = state(d);
              return (
                <li key={d.lang}>
                  <button type="button" className={d.lang === sel ? "on" : ""} aria-current={d.lang === sel ? "true" : undefined} onClick={() => pick(d.lang)}>
                    <b>{dubName(d.lang)}</b>
                    <span className={`stdb-bar ${s.tone}${d.status === "translating" ? " run" : ""}`}><i style={{ width: `${s.pct}%` }} /></span>
                    <small>{s.text}</small>
                  </button>
                </li>
              );
            })}
            {original && (
              <li><div className="stdb-orig"><b>{original}</b><span className="stdb-bar green"><i style={{ width: "100%" }} /></span><small>Original audio</small></div></li>
            )}
          </ul>
          {!dubs.length && <p className="pt-hint">No dubs yet. Add a language and Studio AI translates the subtitles for you to review.</p>}
          {canEdit && (adding ? (
            <div className="stdb-add">
              <div className="vf-box"><select aria-label="Language" value={addLang} onChange={(e) => setAddLang(e.target.value)}>
                <option value="">Pick a language</option>
                {free.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select></div>
              <div className="pt-btns">
                <button className="vf-btn ghost" type="button" onClick={() => { setAdding(false); setAddLang(""); }}>Cancel</button>
                <button className="vf-btn red" type="button" disabled={!addLang || Boolean(busy)} onClick={add}>{busy === "add" ? "Adding" : "Add"}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="stdb-addbtn" disabled={!hasSubs || !free.length} onClick={() => setAdding(true)}>Add a language</button>
          ))}
        </section>

        <div className="stdb-main">
          <section className="bp-panel stdb-ed" aria-label="Line preview">
            {dub ? (
              <>
                <div className="stdb-edh">
                  <h2>{dubName(dub.lang)}{line ? ` · line ${cur + 1} · ${clock(line.startMs)}` : ""}</h2>
                  <div className="pt-btns">
                    <button type="button" className="stdb-sbtn fill" disabled={!line?.audioKey} onClick={play}>{playing ? "Stop" : "Play dub"}</button>
                    {editable && <button type="button" className="stdb-sbtn" disabled={!line || Boolean(busy)} onClick={regenerate}>{busy === "regen" ? "Writing" : "Regenerate line"}</button>}
                  </div>
                </div>
                <div className="stdb-prev">
                  <button type="button" className="stdb-play" aria-label={playing ? "Stop" : "Play this line"} disabled={!line?.audioKey} onClick={play}>
                    {playing ? <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.5" height="12" rx="1" fill="#fff" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="#fff" /></svg>
                      : <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M7 4.5v13l11-6.5z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>}
                  </button>
                  {line && <p className="stdb-cap">{line.speaker && <b>{line.speaker}: </b>}{line.text}</p>}
                  {line && !line.audioKey && <span className="stdb-nov">Not voiced yet</span>}
                </div>
                <div className="stdb-wave" aria-hidden="true">
                  {Array.from({ length: BARS }, (_, i) => {
                    const h = peaks ? Math.max(0.08, peaks[i]) : 0.12 + 0.5 * Math.abs(Math.sin(i * 0.7) * Math.sin(i * 0.13));
                    return <i key={i} className={peaks && i / BARS <= progress && playing ? "on" : ""} style={{ height: `${Math.round(h * 100)}%`, opacity: peaks ? 1 : 0.35 }} />;
                  })}
                </div>
                <div className="stdb-voice">
                  <span>Voice:</span>
                  <button type="button" className="on" aria-pressed="true">AI voice</button>
                  <button type="button" disabled title="Coming soon">Keep actor&apos;s voice (licensed clone) <em className="soon-tag">Soon</em></button>
                  <button type="button" disabled title="Coming soon">{dubName(dub.lang)} voice actor <em className="soon-tag">Soon</em></button>
                  <button type="button" disabled title="Coming soon">Lip-sync <em className="soon-tag">Soon</em></button>
                  <button type="button" disabled title="Coming soon">Keep music and effects <em className="soon-tag">Soon</em></button>
                  {canEdit && dub.status !== "translating" && dub.status !== "voicing" && <button type="button" className="stdb-rm" disabled={Boolean(busy)} onClick={remove}>Remove language</button>}
                </div>
                {!dubLang(dub.lang)?.voice && <p className="pt-hint">The AI voice does not officially speak {dubName(dub.lang)} yet. Listen to the voiced lines before you approve.</p>}
                {dub.error && <p className="vf-err" role="alert">{dub.error}</p>}
              </>
            ) : (
              <p className="pt-hint">Pick or add a language to review its dub.</p>
            )}
          </section>

          {dub && (
            <section className="bp-panel stdb-script" aria-label="Script">
              <div className="stdb-sh">
                <h2>Script</h2>
                {lines.length > 0 && (
                  <div className="bp-chips" role="radiogroup" aria-label="Show">
                    {([["all", `All ${lines.length}`], ["flagged", `Flagged ${flagged}`], ["voice", `Not voiced ${unvoiced}`]] as [Filter, string][]).map(([k, t]) => (
                      <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? "on" : ""} onClick={() => { setFilter(k); setShown(PAGE); }}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
              {dub.status === "translating" && <p className="pt-hint">Studio AI is translating {lines.length ? "" : "the subtitles"}. Lines appear here when it is done.</p>}
              {st && dub.status === "voicing" && <p className="pt-hint">Voicing: {dub.voiced} of {dub.lines} lines done.</p>}
              <ol className="stdb-lines">
                {list.slice(0, shown).map(({ l, i }) => (
                  <li key={l.idx} className={`${l.flag ? "flag" : ""}${i === cur ? " cur" : ""}`} onClick={() => choose(i)}>
                    <span className="t">{clock(l.startMs)}</span>
                    <span className="sp">{l.speaker}</span>
                    <span className="src">{l.source}</span>
                    {edit?.idx === l.idx ? (
                      <span className="tx ed" onClick={(e) => e.stopPropagation()}>
                        <textarea aria-label={`Line ${i + 1} translation`} value={edit.text} maxLength={600} autoFocus onChange={(e) => setEdit({ idx: l.idx, text: e.target.value })} />
                        <span className="pt-btns">
                          <button type="button" className="stdb-sbtn" onClick={() => setEdit(null)}>Cancel</button>
                          <button type="button" className="stdb-sbtn fill" disabled={!edit.text.trim() || Boolean(busy)} onClick={() => saveLine(l.idx, edit.text.trim(), true)}>Save</button>
                        </span>
                      </span>
                    ) : editable ? (
                      <button type="button" className="tx" title="Edit this line" onClick={(e) => { e.stopPropagation(); setCur(i); setEdit({ idx: l.idx, text: l.text }); }}>{l.text}</button>
                    ) : <span className="tx">{l.text}</span>}
                    <span className="mk">
                      {l.flag ? (
                        <>
                          <em>{l.flag}</em>
                          {editable && edit?.idx !== l.idx && <button type="button" onClick={(e) => { e.stopPropagation(); saveLine(l.idx, l.text, true); }} disabled={Boolean(busy)}>Keep as is</button>}
                        </>
                      ) : l.audioKey ? <Check /> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {list.length > shown && <button type="button" className="stdb-addbtn" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown} left)</button>}
              {!list.length && lines.length > 0 && <p className="pt-hint">Nothing here.</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
