"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomType, RoomsData } from "@/lib/exec";

// Rooms and VR halls (Figma 83:831). VR and AR halls are what VR seat holders pick in the VR
// cinema; party and private rooms are what hosts open watch parties in.
type Kind = RoomType["kind"];
type Scene = RoomType["scene"];
type Aud = RoomType["audience"];
const KINDS: { id: Kind; label: string }[] = [{ id: "vr", label: "VR hall" }, { id: "ar", label: "AR wall screen" }, { id: "party", label: "Party room" }, { id: "private", label: "Private room" }];
const SCENES: Record<Kind, { id: Scene; label: string }[]> = {
  vr: [{ id: "hall", label: "Classic red cinema" }, { id: "rooftop", label: "Rooftop at night" }, { id: "space", label: "Space station" }],
  ar: [{ id: "living", label: "Your own room" }],
  party: [{ id: "lounge", label: "Lounge" }],
  private: [{ id: "lounge", label: "Lounge" }],
};
const AUD: { id: Aud; label: string }[] = [{ id: "everyone", label: "Everyone" }, { id: "vip", label: "VIP" }, { id: "adult", label: "18+" }, { id: "kids", label: "Kids" }];
const KIND_NAME: Record<Kind, string> = { vr: "VR hall", ar: "AR wall screen", party: "Party room", private: "Private room" };

function who(t: Pick<RoomType, "kind" | "audience">) {
  if (t.audience === "vip") return "VIP and Enterprise members";
  if (t.audience === "adult") return "18+ with a checked ID and face";
  if (t.audience === "kids") return "Kids-safe, no voice chat";
  return t.kind === "vr" || t.kind === "ar" ? "Everyone with a VR seat ticket" : t.kind === "private" ? "Invited people only" : "Everyone";
}

const blank = (): RoomType => ({ id: "", name: "", kind: "vr", scene: "hall", seats: 84, audience: "everyone", voice: true, spatial: true, avatars: true, live: false, parties: 0 });

export default function ExecRooms({ d }: { d: RoomsData }) {
  const router = useRouter();
  const [f, setF] = useState<RoomType>(blank);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const form = useRef<HTMLDivElement>(null);
  const hall = f.kind === "vr" || f.kind === "ar";
  const vr = d.types.filter((t) => t.kind === "vr" || t.kind === "ar").length;
  const top = [...d.types].filter((t) => t.parties > 0).sort((a, b) => b.parties - a.parties)[0];
  const set = (p: Partial<RoomType>) => setF((x) => ({ ...x, ...p }));

  function pickKind(k: Kind) {
    set({ kind: k, scene: SCENES[k][0].id, seats: k === "vr" || k === "ar" ? 84 : f.seats === 84 ? (k === "private" ? 12 : 200) : f.seats });
  }
  function edit(t: RoomType) {
    setF(t); setMsg(""); setErr("");
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function save(live: boolean) {
    setErr(""); setMsg(""); setBusy(live ? "live" : "draft");
    const r = await fetch("/api/executive/rooms", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, name: f.name.trim(), live }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy("");
    if (!r?.ok) { setErr(b.error ?? "Could not save the room"); return; }
    setMsg(live ? `${f.name.trim()} is live for viewers.` : `${f.name.trim()} is saved as a draft.`);
    setF(blank());
    router.refresh();
  }

  return (
    <section className="exc exr">
      <header className="exc-head">
        <div>
          <h1>Rooms and VR halls</h1>
          <p className="exc-sub">Create watch-party room types and VR cinema halls without waiting for a developer. New rooms appear for viewers as soon as you publish.</p>
        </div>
        {d.canAdd && <button type="button" className="exa-red" onClick={() => { setF(blank()); form.current?.scrollIntoView({ behavior: "smooth" }); }}>Add room</button>}
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Room types</span><b>{d.types.length}</b><small className="up">{vr} VR hall{vr === 1 ? "" : "s"}, {d.types.length - vr} party room{d.types.length - vr === 1 ? "" : "s"}</small></div>
        <div className="exc-tile"><span>Seats sold in VR</span><b>{d.vrSeats.toLocaleString("en-US")}</b><small className="up">this month</small></div>
        <div className="exc-tile"><span>Most used</span><b className="exr-big">{top ? top.name : "–"}</b><small className="up">{top ? `${top.parties} part${top.parties === 1 ? "y" : "ies"} this month` : "no parties yet this month"}</small></div>
        <div className="exc-tile"><span>Avg party size</span><b>{d.parties ? Math.round(d.avgParty * 10) / 10 : "–"}</b><small className="up">{d.parties ? "people per party" : "no parties yet this month"}</small></div>
      </div>

      <div className="exr-cards">
        {d.types.map((t) => (
          <button key={t.id} type="button" className="exr-card" onClick={() => d.canAdd && edit(t)} disabled={!d.canAdd}>
            <div className={`exr-art exr-${t.scene}`} aria-hidden><i className="exr-scr" /><i className="exr-seats" /></div>
            <div className="exr-top"><b>{t.name}</b><span className={t.live ? "exr-live" : "exr-draft"}>{t.live ? "Live" : "Draft"}</span></div>
            <small>{KIND_NAME[t.kind]} · {t.seats} {t.kind === "vr" || t.kind === "ar" ? "seats" : "people"}</small>
            <small className="exr-who">{who(t)}</small>
          </button>
        ))}
      </div>

      {msg && <p className="exa-msg" role="status">{msg}</p>}
      {d.canAdd ? (
        <div className="exc-row exr-row" ref={form}>
          <div className="exc-card">
            <h2>{f.id ? `Edit ${f.name || "room"}` : "New room"}</h2>
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-two">
              <label className="epf-f"><span>Room name</span><input value={f.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Nollywood Night Hall" /></label>
              <label className="epf-f"><span>{hall ? "Seats" : "People"}</span><input inputMode="numeric" value={f.seats || ""} disabled={hall} onChange={(e) => set({ seats: Math.min(500, Number(e.target.value.replace(/[^0-9]/g, "")) || 0) })} />{hall && <small className="exr-note">Every hall has 6 rows of 14 seats</small>}</label>
            </div>
            <div className="epf-chips" role="radiogroup" aria-label="Room type">
              {KINDS.map((k) => <button key={k.id} type="button" role="radio" aria-checked={f.kind === k.id} className={f.kind === k.id ? "on" : ""} onClick={() => pickKind(k.id)}>{k.label}</button>)}
            </div>
            <div className="epf-chips" role="radiogroup" aria-label="Hall">
              {SCENES[f.kind].map((s) => <button key={s.id} type="button" role="radio" aria-checked={f.scene === s.id} className={f.scene === s.id ? "on" : ""} onClick={() => set({ scene: s.id })}>{s.label}</button>)}
              {f.kind === "vr" && <><span className="epf-chip-soon">Beach <small>Soon</small></span><span className="epf-chip-soon">Upload my own 3D hall <small>Soon</small></span></>}
            </div>
            <div className="epf-two">
              <div className="epf-f"><span>Ticket uplift</span><p className="exr-fixed">{hall ? "VR seats cost 1.5× the film price" : "Free with a ticket"} · per-room uplift <span className="exl-soon">Soon</span></p></div>
              <div className="epf-f"><span>Who can enter</span>
                <div className="epf-chips exr-aud" role="radiogroup" aria-label="Who can enter">
                  {AUD.map((a) => <button key={a.id} type="button" role="radio" aria-checked={f.audience === a.id} className={f.audience === a.id ? "on" : ""} onClick={() => set({ audience: a.id, voice: a.id === "kids" ? false : f.voice })}>{a.label}</button>)}
                </div>
              </div>
            </div>
            <div className="epf-acts">
              <span className="exr-prev" title="Coming soon">Preview in headset <small>Soon</small></span>
              {f.id && <button type="button" className="exa-ghost" onClick={() => setF(blank())}>Cancel</button>}
              <button type="button" className="exa-ghost" disabled={!!busy} onClick={() => save(false)}>{busy === "draft" ? "Saving…" : "Save draft"}</button>
              <button type="button" className="exa-red" disabled={!!busy} onClick={() => save(true)}>{busy === "live" ? "Publishing…" : "Publish room"}</button>
            </div>
          </div>
          <div className="exc-card">
            <h2>Rules</h2>
            <label className="epf-tog"><span>Voice chat<small>{f.audience === "kids" ? "Kids rooms never have voice chat" : "Free members get 5 minutes, then muted"}</small></span><input type="checkbox" role="switch" checked={f.voice} disabled={f.audience === "kids"} onChange={(e) => set({ voice: e.target.checked })} /></label>
            <label className="epf-tog"><span>Spatial audio<small>Hear friends next to you</small></span><input type="checkbox" role="switch" checked={f.spatial} onChange={(e) => set({ spatial: e.target.checked })} /></label>
            <label className="epf-tog"><span>Avatars<small>Friends appear in nearby seats</small></span><input type="checkbox" role="switch" checked={f.avatars} onChange={(e) => set({ avatars: e.target.checked })} /></label>
            <p className="epf-hint">The CEO and cabinet members allowed to add merch and rooms can add and edit.{d.updatedBy ? ` Last change by ${d.updatedBy}.` : ""}</p>
          </div>
        </div>
      ) : (
        <p className="exs2-note exr-ask">Ask the CEO for “Can add merch and rooms” to add or change rooms.</p>
      )}
    </section>
  );
}
