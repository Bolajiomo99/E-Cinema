"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Soon } from "@/components/settings/ui";
import type { Showtime } from "@/lib/catalog";
import { allowed, avatarColor, initials, ratingLabel, type ActiveStatus, type Family, type MaxRating, type Member } from "@/lib/family-types";
import KidsTile from "./KidsTile";
import PinPrompt from "./PinPrompt";

type Ask = { title: string; note?: string; create?: boolean; run: (pin: string) => Promise<string | null> };

const send = async (method: string, path: string, body: unknown) => {
  const r = await fetch(`/api/family${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: r.ok, status: r.status, body: b as unknown, error: b.error ?? (r.ok ? "" : "Something went wrong, try again") };
};

const hours = (m: number) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${Math.floor(m / 60)}h ${m % 60}m`);

// Figma "Web / Kids and family" (89:1020).
export default function FamilyApp({ initial, active, kidsFilms }: { initial: Family; active: ActiveStatus; kidsFilms: Showtime[] }) {
  const router = useRouter();
  const [fam, setFam] = useState(initial);
  const firstKid = initial.profiles.find((p) => p.kind === "kids");
  const [sel, setSel] = useState(firstKid?.id ?? initial.profiles[0].id);
  const [pin, setPin] = useState(""); // remembered for this visit after one correct entry
  const [ask, setAsk] = useState<Ask | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "kids" as "kids" | "adult", age: 8 });
  const [note, setNote] = useState("");
  const isKid = active.profile.kind === "kids";
  const me = fam.profiles.find((p) => p.id === sel) ?? fam.profiles[0];
  const idx = fam.profiles.findIndex((p) => p.id === me.id);
  const full = fam.profiles.length >= 6;

  const reload = async () => {
    const r = await fetch("/api/family");
    if (r.ok) setFam(((await r.json()) as { family: Family }).family);
  };

  // Runs an action that needs the parent PIN, asking for it (or to create it) when needed.
  const withPin = (title: string, run: (pin: string) => Promise<{ ok: boolean; status: number; error: string }>) => {
    const go = async (p: string): Promise<string | null> => {
      const r = await run(p);
      if (r.ok) {
        setPin(p);
        setAsk(null);
        return null;
      }
      if (r.status === 403 || r.status === 429) {
        setPin("");
        return r.error;
      }
      setAsk(null);
      setNote(r.error);
      return null;
    };
    if (!fam.pinSet) {
      setAsk({
        title: "Create a parent PIN",
        note: "You'll need it to change kids controls and to leave a kids profile. It is not your sign-in password.",
        create: true,
        run: async (p) => {
          const r = await send("POST", "/pin", { pin: p });
          if (!r.ok) return r.error;
          setFam((f) => ({ ...f, pinSet: true }));
          return go(p);
        },
      });
      return;
    }
    if (pin) {
      void go(pin).then((problem) => problem && setAsk({ title, run: go }));
      return;
    }
    setAsk({ title, run: go });
  };

  const save = (next: Member) => {
    setNote("");
    const prev = fam.profiles;
    setFam((f) => ({ ...f, profiles: f.profiles.map((p) => (p.id === next.id ? next : p)) }));
    withPin(`Change ${next.name}'s controls`, async (p) => {
      const r = await send("PUT", `/profiles/${next.id}`, { pin: p, profile: next });
      if (r.ok) setFam((f) => ({ ...f, profiles: f.profiles.map((x) => (x.id === next.id ? (r.body as Member) : x)) }));
      else setFam((f) => ({ ...f, profiles: prev }));
      return r;
    });
  };

  const add = () => {
    const profile = { name: draft.name.trim(), kind: draft.kind, age: draft.kind === "kids" ? draft.age : 0, maxRating: (draft.age >= 12 ? "12" : draft.age >= 7 ? "7" : "all") as MaxRating, chat: draft.kind !== "kids", askToBuy: draft.kind === "kids", screenMinutes: draft.kind === "kids" ? 120 : 0, bedtime: draft.kind === "kids" ? "20:00" : "", aiFilter: draft.kind === "kids" };
    const run = async (p: string) => {
      const r = await send("POST", "/profiles", { pin: p, profile });
      if (r.ok) {
        const m = r.body as Member;
        setFam((f) => ({ ...f, profiles: [...f.profiles, m] }));
        setSel(m.id);
        setAdding(false);
        setDraft({ name: "", kind: "kids", age: 8 });
      }
      return r;
    };
    if (draft.kind === "kids") withPin(`Add ${profile.name}`, run);
    else void run("").then((r) => !r.ok && setNote(r.error));
  };

  const remove = (m: Member) => {
    if (!confirm(`Remove ${m.name}'s profile? Their watch time and requests go too.`)) return;
    const run = async (p: string) => {
      const r = await send("POST", `/profiles/${m.id}/remove`, { pin: p });
      if (r.ok) {
        setFam((f) => ({ ...f, profiles: f.profiles.filter((x) => x.id !== m.id) }));
        setSel("owner");
      }
      return r;
    };
    if (m.kind === "kids") withPin(`Remove ${m.name}`, run);
    else void run("").then((r) => !r.ok && setNote(r.error));
  };

  const use = async (m: Member) => {
    const r = await send("POST", "/switch", { profile: m.id });
    if (r.ok) router.push(m.kind === "kids" ? "/kids" : "/");
    else setNote(r.error);
  };

  const decide = async (id: string, approve: boolean) => {
    const r = await send("POST", `/requests/${id}`, { approve });
    if (r.ok) await reload();
    else setNote(r.error);
  };

  const films = me.kind === "kids" ? kidsFilms.filter((s) => allowed(s.rating, me.maxRating)) : kidsFilms;
  const pending = fam.requests.filter((r) => r.status === "pending");

  if (isKid)
    return (
      <div className="fm-locked">
        <h1>Family and kids</h1>
        <p>{active.profile.name}, this page is for grown-ups. Ask a parent to open it from their profile.</p>
        <Link className="vf-btn red" href="/kids">Back to {active.profile.name}&apos;s cinema</Link>
      </div>
    );

  return (
    <>
      <header className="fm-head">
        <div>
          <h1>Family and kids</h1>
          <p>One plan, up to 6 profiles. Kids profiles only see films rated for their age, with no voice chat and no purchases without a parent.</p>
        </div>
        <button className="vf-btn red" disabled={full} onClick={() => setAdding(true)}>Add profile</button>
      </header>
      {note && <p className="fm-err" role="alert">{note}</p>}

      <div className="fm-profiles">
        {fam.profiles.map((p, i) => (
          <button key={p.id} className={`fm-profile${p.kind === "kids" ? " kid" : ""}${p.id === me.id ? " on" : ""}`} onClick={() => setSel(p.id)} aria-pressed={p.id === me.id}>
            <span className="fm-av" style={{ background: avatarColor(p, i, fam.profiles) }}>{initials(p.name)}</span>
            <b>{p.name}</b>
            <small>{p.kind === "owner" ? `Owner${fam.adult ? " · 18+ verified" : ""}` : p.kind === "kids" ? `Kids · age ${p.age}` : "Adult"}</small>
          </button>
        ))}
        {!full && (
          <button className="fm-add" onClick={() => setAdding(true)}>
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden><path d="M14 6v16M6 14h16" stroke="#a6a6b0" strokeWidth="2" strokeLinecap="round" /></svg>
            <span>Add a profile</span>
          </button>
        )}
      </div>

      <div className="fm-row">
        <section className="fm-ctl" aria-labelledby="ctl-title">
          {me.kind === "kids" ? (
            <>
              <div className="fm-ctl-top">
                <h2 id="ctl-title">Parental controls for {me.name}</h2>
                <button className="fm-link" onClick={() => remove(me)}>Remove</button>
              </div>
              <div className="fm-chips" role="radiogroup" aria-label="Age rating">
                {(["all", "7", "12", "16"] as MaxRating[]).map((r) => (
                  <button key={r} role="radio" aria-checked={me.maxRating === r} className={me.maxRating === r ? "on" : ""} onClick={() => me.maxRating !== r && save({ ...me, maxRating: r })}>{ratingLabel[r]}</button>
                ))}
              </div>
              <Setting title="Voice and text chat" text={me.chat ? "On. Typed chat in rooms; voice stays off for kids." : "Off for kids. Only emoji reactions in rooms."} on={me.chat} onChange={(v) => save({ ...me, chat: v })} />
              <Setting title="Ask before buying" text="Snacks, tickets and merch need a parent to approve" on={me.askToBuy} onChange={(v) => save({ ...me, askToBuy: v })} />
              <Setting
                title="Screen time"
                text={me.screenMinutes || me.bedtime ? `${me.screenMinutes ? `${hours(me.screenMinutes)} a day` : "No daily limit"}${me.bedtime ? `, no films after ${me.bedtime}` : ""}` : "No limit"}
                on={Boolean(me.screenMinutes || me.bedtime)}
                onChange={(v) => save({ ...me, screenMinutes: v ? 120 : 0, bedtime: v ? "20:00" : "" })}
              >
                {(me.screenMinutes > 0 || me.bedtime) && (
                  <div className="fm-time">
                    <label>
                      <span>A day</span>
                      <select value={me.screenMinutes} onChange={(e) => save({ ...me, screenMinutes: Number(e.target.value) })}>
                        {[0, 30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m ? hours(m) : "No limit"}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Bedtime</span>
                      <select value={me.bedtime} onChange={(e) => save({ ...me, bedtime: e.target.value })}>
                        <option value="">None</option>
                        {["18:00", "19:00", "19:30", "20:00", "20:30", "21:00", "22:00"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <small>Used today: {Math.floor(me.watchedToday / 60)} min · Lagos time</small>
                  </div>
                )}
              </Setting>
              <Setting title="18+ content" text="Locked. Needs the owner face check and PIN." on={false} disabled onChange={() => undefined} />
              <Setting title={<>AI safety filter <Soon /></>} text="Mutes scary scenes and strong language by age" on={me.aiFilter} onChange={(v) => save({ ...me, aiFilter: v })} />
            </>
          ) : (
            <>
              <div className="fm-ctl-top">
                <h2 id="ctl-title">{me.kind === "owner" ? `${me.name} (owner)` : me.name}</h2>
                {me.kind === "adult" && <button className="fm-link" onClick={() => remove(me)}>Remove</button>}
              </div>
              <p className="fm-plain">Adult profiles see everything the plan allows. 18+ films still need the owner&apos;s face check and the adult PIN at booking.</p>
              <p className="fm-plain">Parent PIN: {fam.pinSet ? "set" : "not set yet"}.{" "}
                <button className="fm-link" onClick={() => setAsk({ title: fam.pinSet ? "Change the parent PIN" : "Create a parent PIN", create: !fam.pinSet, note: fam.pinSet ? "Enter the current PIN first." : undefined, run: async (cur) => {
                  if (!fam.pinSet) {
                    const r = await send("POST", "/pin", { pin: cur });
                    if (!r.ok) return r.error;
                    setFam((f) => ({ ...f, pinSet: true }));
                    setPin(cur);
                    setAsk(null);
                    return null;
                  }
                  setAsk({ title: "New parent PIN", create: true, run: async (n) => {
                    const r = await send("POST", "/pin", { current: cur, pin: n });
                    if (!r.ok) return r.error;
                    setPin(n);
                    setAsk(null);
                    return null;
                  } });
                  return null;
                } })}>{fam.pinSet ? "Change" : "Create one"}</button>
              </p>
            </>
          )}
          {me.id !== active.profile.id && <button className="vf-btn soft fm-use" onClick={() => use(me)}>Watch as {me.name}</button>}
        </section>

        <aside className="fm-prev" aria-label={`${me.name}'s cinema`}>
          <div className="fm-prev-h">
            <h2>{me.name}&apos;s cinema</h2>
            {me.kind === "kids" && <span className="fm-pill">Kids mode</span>}
          </div>
          <div className="fm-grid">
            {films.slice(0, 3).map((s) => <KidsTile key={s.id} s={s} />)}
            {films.length === 0 && <p className="fm-plain">No films at this rating yet.</p>}
          </div>
          <p className="fm-plain">Big tiles, read-aloud titles in {me.kind === "kids" ? "their" : "your"} language, and a bedtime reminder.</p>
          {me.kind === "kids" && <button className="fm-link" onClick={() => use(me)}>Open {me.name}&apos;s cinema</button>}
        </aside>
      </div>

      {fam.requests.length > 0 && (
        <section className="fm-reqs" aria-labelledby="req-title">
          <h2 id="req-title">Requests from kids {pending.length > 0 && <span className="fm-pill">{pending.length} waiting</span>}</h2>
          <ul>
            {fam.requests.map((r) => (
              <li key={r.id}>
                <div><b>{r.profile}</b> asked for {r.link ? <Link href={r.link}>{r.what}</Link> : r.what}</div>
                {r.status === "pending" ? (
                  <span className="fm-req-act">
                    <button className="vf-btn sm ghost" onClick={() => decide(r.id, false)}>Decline</button>
                    <button className="vf-btn sm red" onClick={() => decide(r.id, true)}>Approve</button>
                  </span>
                ) : (
                  <span className={`fm-st ${r.status}`}>{r.status === "approved" ? "Approved" : "Declined"}{r.status === "approved" && r.link ? <> · <Link href={r.link}>Buy it now</Link></> : null}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {adding && (
        <div className="fm-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
          <form className="fm-sheet" onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) add(); }}>
            <h2 id="add-title">Add a profile</h2>
            <label><span>Name</span><input autoFocus maxLength={30} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <div className="fm-chips" role="radiogroup" aria-label="Profile type">
              {(["kids", "adult"] as const).map((k) => <button type="button" key={k} role="radio" aria-checked={draft.kind === k} className={draft.kind === k ? "on" : ""} onClick={() => setDraft({ ...draft, kind: k })}>{k === "kids" ? "Kids" : "Adult"}</button>)}
            </div>
            {draft.kind === "kids" && (
              <label><span>Age</span>
                <select value={draft.age} onChange={(e) => setDraft({ ...draft, age: Number(e.target.value) })}>
                  {Array.from({ length: 17 }, (_, i) => i + 1).map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            <p className="fm-plain">{draft.kind === "kids" ? "Kids start with chat off, ask-before-buying on, 2 hours a day and bedtime at 20:00. You can change it all after." : "Adults share your plan and see what the plan allows."}</p>
            <div className="fm-actions">
              <button type="button" className="vf-btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="vf-btn red" disabled={!draft.name.trim()}>Add profile</button>
            </div>
          </form>
        </div>
      )}
      {ask && <PinPrompt title={ask.title} note={ask.note} create={ask.create} onDone={ask.run} onCancel={() => { setAsk(null); void reload(); }} />}
      <span className="sr-only">Selected profile {idx + 1} of {fam.profiles.length}</span>
    </>
  );
}

function Setting({ title, text, on, onChange, disabled, children }: { title: React.ReactNode; text: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: React.ReactNode }) {
  const label = typeof title === "string" ? title : "AI safety filter";
  return (
    <div className="fm-set">
      <div className="fm-set-row">
        <div><b>{title}</b><small>{text}</small></div>
        <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`fm-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}><i /></button>
      </div>
      {children}
    </div>
  );
}
