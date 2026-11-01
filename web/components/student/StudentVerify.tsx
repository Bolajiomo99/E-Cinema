"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type StudentStatus = { verified: boolean; school?: string; email?: string; method?: "email" | "id"; until?: string; pending?: string };

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as StudentStatus & { error?: string; maskedTo?: string };
  if (!r.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

export default function StudentVerify({ initial, price }: { initial: StudentStatus; price: string }) {
  const router = useRouter();
  const [st, setSt] = useState(initial);
  const [school, setSchool] = useState(initial.school ?? "");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"email" | "id">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try { await f(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  async function pickPlan() {
    await run(async () => {
      const r = await fetch("/api/me/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: "student" }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not pick Student Pro.");
      router.push("/join?step=4&plan=student");
    });
  }

  if (st.verified) {
    return (
      <div className="sd-form sd-done" role="status">
        <p className="sd-ok">You are verified{st.school ? ` at ${st.school}` : ""} until {new Date(st.until!).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</p>
        <button className="lp-btn md" onClick={pickPlan} disabled={busy}>{busy ? "Opening…" : `Pick Student Pro · ${price}/mo`}</button>
        {err && <p className="gf-err" role="alert">{err}</p>}
      </div>
    );
  }

  return (
    <div className="sd-form">
      <label className="gf-field"><span>School or university</span>
        <input className="gf-input" value={school} maxLength={120} placeholder="University of Lagos" onChange={(e) => setSchool(e.target.value)} />
      </label>
      {mode === "email" ? (
        sentTo ? (
          <>
            <label className="gf-field"><span>Code we sent to {sentTo}</span>
              <input className="gf-input sd-code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" onChange={(e) => setCode(e.target.value)} />
            </label>
            <div className="gf-actions">
              <button className="lp-btn md" disabled={busy || code.replace(/\D/g, "").length !== 6} onClick={() => run(async () => setSt(await post("/api/student/verify", { code })))}>{busy ? "Checking…" : "Verify"}</button>
              <button className="sd-link" onClick={() => { setSentTo(""); setCode(""); }}>Use another email</button>
            </div>
          </>
        ) : (
          <>
            <label className="gf-field"><span>Student email</span>
              <input className="gf-input" type="email" value={email} placeholder="you@live.unilag.edu.ng" onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div><button className="lp-btn md" disabled={busy || !school.trim() || !email.includes("@")} onClick={() => run(async () => setSentTo((await post("/api/student/code", { school, email })).maskedTo ?? email))}>{busy ? "Sending…" : "Send code"}</button></div>
          </>
        )
      ) : (
        <label className="gf-field"><span>Photo of the front of your student ID</span>
          <input className="gf-input sd-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            run(async () => {
              const fd = new FormData();
              fd.append("card", f);
              const r = await fetch("/api/student/id", { method: "POST", body: fd });
              const data = (await r.json().catch(() => ({}))) as StudentStatus & { error?: string };
              if (!r.ok) throw new Error(data.error ?? "We could not check that card.");
              setSt(data);
            });
          }} />
          <small className="sd-small">{busy ? "Reading your card…" : "The name must match your account. We read the card once and do not keep the photo."}</small>
        </label>
      )}
      {err && <p className="gf-err" role="alert">{err}</p>}
      <button className="sd-link" onClick={() => { setMode(mode === "email" ? "id" : "email"); setErr(""); }}>
        {mode === "email" ? "No student email? Upload your student ID instead." : "Have a student email? Use a code instead."}
      </button>
    </div>
  );
}
