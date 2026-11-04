"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FaceCheck from "@/components/FaceCheck";
import { addPasskey } from "@/lib/passkey-client";

// Executive invite (Figma 99:1696): confirm the invited inbox, check it is you, create a passkey.
// Each step unlocks the next; access opens only when all three are done.
export type InviteView = {
  email: string; name: string; role: string; by: string; hoursLeft: number; gone: boolean;
  emailConfirmed: boolean; codeSent: boolean; signedInAs: string; face: boolean; passkey: boolean;
};

const Tick = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.2l2.6 2.6L12 5.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Lock = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;

export default function InviteFlow({ token, v }: { token: string; v: InviteView | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(v?.codeSent ?? false);
  const [code, setCode] = useState("");
  const [face, setFace] = useState(false);

  const next = encodeURIComponent(`/invite/executive/${token}`);
  const art = (
    <aside className="inv-art">
      <span className="wordmark">E-CINEMA</span>
      <h2>EXECUTIVE</h2>
      <p>Private dashboards for the CEO, cabinet, investors, stakeholders and partners. By invitation only.</p>
    </aside>
  );
  const shell = (body: React.ReactNode) => <main className="inv">{art}<section className="inv-main"><div className="inv-card">{body}</div></section></main>;

  if (!v || v.gone) {
    return shell(<>
      <h1>{v ? "This invite has ended" : "This invite link does not work"}</h1>
      <p className="inv-lead">{v ? "The link works once and only for 48 hours, or the CEO removed this access. Ask the CEO to send a new invite." : "Check that you opened the whole link from the email. Invite links work once and end after 48 hours."}</p>
      <Link className="inv-btn" href="/">Go to E-Cinema</Link>
    </>);
  }

  const wrong = v.signedInAs && v.signedInAs.toLowerCase() !== v.email.toLowerCase();
  const me = v.signedInAs && !wrong;
  const done = [v.emailConfirmed, v.face, v.passkey];
  const at = done.findIndex((d) => !d);

  async function go(fn: () => Promise<void>) {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
    setBusy(false);
  }
  async function post(action: string, body?: object) {
    const r = await fetch(`/api/exec-invite/${token}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(j.error ?? "Something went wrong");
  }
  const sendCode = () => go(async () => { await post("code"); setSent(true); });
  const confirm = () => go(async () => { await post("confirm", { code }); router.refresh(); });
  const passkey = () => go(async () => { await addPasskey(); router.refresh(); });
  const accept = () => go(async () => { await post("accept"); router.push("/executive"); });

  const steps = [
    { t: "Confirm your email", d: v.emailConfirmed ? `Confirmed ${v.email}` : sent ? `Code sent to ${v.email}` : `We send a code to ${v.email}` },
    { t: "Check it is you", d: v.face ? "Face check done" : "Face check with your phone camera" },
    { t: "Create a passkey", d: v.passkey ? "Passkey added" : "No password. Your phone or laptop unlocks it." },
  ];

  let action: React.ReactNode;
  if (!v.signedInAs) {
    action = <>
      <Link className="inv-btn" href={`/signin?next=${next}`}>Sign in as {v.email}</Link>
      <p className="inv-alt">New to E-Cinema? <Link href="/join">Join with {v.email}</Link>, then open this link again.</p>
    </>;
  } else if (wrong) {
    action = <p className="inv-warn" role="alert">You are signed in as {v.signedInAs}. This invite is for {v.email}. Sign out, then sign in with the invited address.</p>;
  } else if (at === 0) {
    action = sent ? (
      <form className="inv-code" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <label><span>Code from the email</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
        <button className="inv-btn" disabled={busy || code.length !== 6}>Confirm email</button>
        <button type="button" className="inv-link" disabled={busy} onClick={sendCode}>Send a new code</button>
      </form>
    ) : <button className="inv-btn" disabled={busy} onClick={sendCode}>Send the code</button>;
  } else if (at === 1) {
    action = face ? <div className="inv-face"><FaceCheck onVerified={() => router.refresh()} /></div> : <button className="inv-btn" onClick={() => setFace(true)}>Continue with face check</button>;
  } else if (at === 2) {
    action = <button className="inv-btn" disabled={busy} onClick={passkey}>Create a passkey</button>;
  } else {
    action = <button className="inv-btn" disabled={busy} onClick={accept}>Open the dashboards</button>;
  }

  return shell(<>
    <h1>You are invited</h1>
    <p className="inv-lead">{v.by} invited {v.email} as {v.role}. This link works once and ends in {v.hoursLeft} hour{v.hoursLeft === 1 ? "" : "s"}.</p>
    <ol className="inv-steps">
      {steps.map((s, i) => {
        const state = done[i] ? "done" : me && i === at ? "now" : "todo";
        return <li key={s.t} className={state} aria-current={state === "now" ? "step" : undefined}><i>{state === "done" ? <Tick /> : null}</i><div><b>{s.t}</b><small>{s.d}</small></div></li>;
      })}
    </ol>
    {action}
    {err && <p className="inv-warn" role="alert">{err}</p>}
    <p className="inv-note"><Lock />There is no sign-up page. If you did not expect this invite, ignore it and tell security@e-cinema.net.</p>
  </>);
}
