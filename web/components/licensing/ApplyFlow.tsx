"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import FaceCheck from "@/components/FaceCheck";
import PayPalTicketButton from "@/components/PayPalTicketButton";
import { naira, PLAN_LINE, PLANS, type Application, type Plan } from "@/lib/licensing-types";

// Built from the Figma frame "Licensee / Apply for a licence" (116:38).
type Country = { code: string; name: string };
const STEP_NAMES = ["Your account", "Your company", "Plan and countries", "Send for review"];

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`/api/licensing/${path}`, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Something went wrong");
  return j;
}

export default function ApplyFlow({ initial, identityOk: idOk, countries, plan: wanted, homeCountry, payReady }: {
  initial: Application | null; identityOk: boolean; countries: Country[]; plan?: Plan["id"]; homeCountry: string; payReady: boolean;
}) {
  const router = useRouter();
  const [app, setApp] = useState<Application | null>(initial);
  const editable = !app || app.status === "draft" || app.status === "rejected";
  const [step, setStep] = useState(editable ? 2 : 4);
  const [company, setCompany] = useState(app?.company ?? "");
  const [reg, setReg] = useState(app?.regNumber ?? "");
  const [country, setCountry] = useState(app?.country ?? homeCountry);
  const [city, setCity] = useState(app?.city ?? "");
  const [website, setWebsite] = useState(app?.website ?? "");
  const [products, setProducts] = useState(app?.products ?? "");
  const [plan, setPlan] = useState<Plan["id"]>(app?.plan ?? wanted ?? "growth");
  const [markets, setMarkets] = useState<string[]>(app?.countries?.length ? app.countries : [homeCountry]);
  const [identityOk, setIdentityOk] = useState(idOk);
  const [face, setFace] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const doc = useRef<HTMLInputElement>(null);
  const pics = useRef<HTMLInputElement>(null);
  const planInfo = PLANS.find((p) => p.id === plan)!;

  const draft = () => ({ plan, company, regNumber: reg, country, city, website, countries: markets, products });
  async function save() {
    const a = (await call("PUT", "application", draft())) as Application;
    setApp(a);
    return a;
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function upload(kind: "doc" | "photo", files: FileList | null) {
    if (!files?.length) return;
    await run(kind, async () => {
      if (!company.trim() || !reg.trim()) throw new Error("Add the company name and number first");
      await save();
      if (kind === "doc") {
        const fd = new FormData();
        fd.append("file", files[0]);
        setApp((await call("POST", "upload/doc", fd)) as Application);
      } else {
        const keys = [...(app?.photos ?? [])];
        for (const f of Array.from(files).slice(0, 8 - keys.length)) {
          const fd = new FormData();
          fd.append("file", f);
          keys.push(((await call("POST", "upload/photo", fd)) as { key: string }).key);
        }
        setApp((await call("PUT", "application/photos", { keys })) as Application);
      }
    });
    if (doc.current) doc.current.value = "";
    if (pics.current) pics.current.value = "";
  }

  const toggleMarket = (c: string) => setMarkets((m) => (m.includes(c) ? m.filter((x) => x !== c) : planInfo.maxCountries === 1 ? [c] : [...m, c]));

  const status = app?.status;
  return (
    <div className="ap">
      <aside className="ap-art">
        <Link className="lp-logo" href="/" aria-label="E-Cinema home"><span>E-CINEMA</span></Link>
        <h2>LICENSED PARTNERS</h2>
        <p>Make and sell official E‑Cinema merch in your country, with your own sales dashboard.</p>
      </aside>
      <section className="ap-form">
        <h1>Apply for a licence</h1>
        <div className="ap-steps" aria-hidden>{STEP_NAMES.map((n, i) => <span key={n} className={i < step ? "on" : ""} />)}</div>
        <p className="ap-step">Step {step} of 4 · {STEP_NAMES[step - 1]}</p>

        {status === "rejected" && step < 4 && <p className="ap-note warn">The brand team asked for changes: {app?.reviewNote}</p>}

        {step === 2 && (
          <>
            <label className="vf-field"><span>Registered company name</span><div className="vf-box"><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Lagos Threads Ltd" maxLength={120} /></div></label>
            <div className="ap-row">
              <label className="vf-field"><span>CAC / company number</span><div className="vf-box"><input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="RC 1234567" maxLength={40} /></div></label>
              <label className="vf-field"><span>Country</span><div className="vf-box"><select value={country} onChange={(e) => { setCountry(e.target.value); if (planInfo.maxCountries === 1) setMarkets([e.target.value]); }}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div></label>
            </div>
            <div className="ap-row">
              <label className="vf-field"><span>City</span><div className="vf-box"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lagos" maxLength={80} /></div></label>
              <label className="vf-field"><span>Website or shop (optional)</span><div className="vf-box"><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="lagosthreads.ng" maxLength={120} /></div></label>
            </div>
            <label className="vf-field"><span>What will you make?</span><div className="vf-box"><input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Tees, hoodies, caps, tote bags" maxLength={500} /></div></label>
            <div className="ap-docs">
              <div className="ap-v">
                <div><b>Certificate of incorporation</b><small>{app?.docKey ? app.docNote || "PDF uploaded" : "PDF or photo · checked by AI"}</small></div>
                {app?.docKey ? (
                  <span className={`bp-pill ${app.docOk ? "teal" : "amber"}`}>{app.docOk ? "Checked" : "Uploaded"}</span>
                ) : null}
                <button type="button" className="vf-btn soft sm" disabled={!!busy} onClick={() => doc.current?.click()}>{busy === "doc" ? "Checking" : app?.docKey ? "Replace" : "Upload"}</button>
                <input ref={doc} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => upload("doc", e.target.files)} />
              </div>
              <div className="ap-v">
                <div><b>Factory or workshop photos</b><small>{app?.photos.length ? `${app.photos.length} photo${app.photos.length === 1 ? "" : "s"}` : "Up to 8 photos of where you make things"}</small></div>
                {app?.photos.length ? <span className="bp-pill teal">Uploaded</span> : null}
                <button type="button" className="vf-btn soft sm" disabled={!!busy || (app?.photos.length ?? 0) >= 8} onClick={() => pics.current?.click()}>{busy === "photo" ? "Uploading" : "Add"}</button>
                <input ref={pics} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload("photo", e.target.files)} />
              </div>
              <div className="ap-v">
                <div><b>Director ID and face check</b><small>{identityOk ? "Done" : "Needed before approval"}</small></div>
                {identityOk ? <span className="bp-pill teal">Verified</span> : <button type="button" className="vf-btn soft sm" onClick={() => setFace((f) => !f)}>{face ? "Close" : "Start"}</button>}
              </div>
              {face && !identityOk && <div className="ap-face"><FaceCheck onVerified={() => { setIdentityOk(true); setFace(false); }} /></div>}
            </div>
            {err && <p className="vf-err" role="alert">{err}</p>}
            <div className="ap-act">
              <a className="vf-btn ghost" href="/licensing">Back</a>
              <button className="vf-btn red" disabled={!!busy} onClick={() => run("save", async () => {
                if (!company.trim() || !reg.trim()) throw new Error("Add the company name and number");
                await save();
                setStep(3);
              })}>{busy === "save" ? "Saving" : "Continue to plan"}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="ap-plans" role="radiogroup" aria-label="Licence plan">
              {PLANS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={plan === p.id} className={`ap-plan ${plan === p.id ? "on" : ""}`} onClick={() => { setPlan(p.id); if (p.maxCountries && markets.length > p.maxCountries) setMarkets(markets.slice(0, p.maxCountries)); }}>
                  <b>{p.name}</b>
                  <strong>{p.feeNgn ? `${naira(p.feeNgn)} a year` : "Fee agreed with us"}</strong>
                  <em>+ {p.royaltyPct}% of sales</em>
                  <small>{PLAN_LINE[p.id]}</small>
                </button>
              ))}
            </div>
            <fieldset className="bp-q">
              <legend>Where will you sell? {planInfo.maxCountries ? `(up to ${planInfo.maxCountries})` : "(any)"}</legend>
              <div className="bp-chips">
                {[country, ...countries.map((c) => c.code).filter((c) => c !== country && ["NG", "GH", "KE", "ZA", "GB", "US", "CA", "FR", "DE", "IN", "AE"].includes(c))].map((c) => (
                  <button key={c} type="button" role="checkbox" aria-checked={markets.includes(c)} className={markets.includes(c) ? "on" : ""} onClick={() => toggleMarket(c)}>{countries.find((x) => x.code === c)?.name ?? c}</button>
                ))}
              </div>
            </fieldset>
            {err && <p className="vf-err" role="alert">{err}</p>}
            <div className="ap-act">
              <button className="vf-btn ghost" onClick={() => setStep(2)}>Back</button>
              <button className="vf-btn red" disabled={!!busy || !markets.length} onClick={() => run("save", async () => { await save(); setStep(4); })}>{busy === "save" ? "Saving" : "Continue"}</button>
            </div>
          </>
        )}

        {step === 4 && app && (
          <>
            <dl className="ap-sum">
              <div><dt>Company</dt><dd>{app.company} · {app.regNumber}</dd></div>
              <div><dt>Plan</dt><dd>{PLANS.find((p) => p.id === app.plan)?.name} · {app.countries.join(", ")}</dd></div>
              <div><dt>Papers</dt><dd>{app.docKey ? (app.docOk ? "Certificate checked" : "Certificate uploaded") : "Certificate missing"} · {app.photos.length} photo{app.photos.length === 1 ? "" : "s"} · {identityOk ? "face check done" : "face check needed"}</dd></div>
            </dl>
            {status === "submitted" && <p className="ap-note">Sent. The brand team checks quality in about 5 working days, and you will get a notification.</p>}
            {status === "approved" && (
              <div className="ap-pay">
                <p className="ap-note ok">Approved{app.reviewNote ? `: ${app.reviewNote}` : ""}. Pay the licence fee of {naira(app.feeNgn)} for one year to start.</p>
                {payReady ? (
                  <PayPalTicketButton label="Pay the licence fee" create={async () => (await call("POST", "application/pay")).orderId} onPaid={() => router.push("/partner?welcome=1")} />
                ) : (
                  <p className="ap-note">Card and PayPal payments are being switched on. The brand team will send you a payment link.</p>
                )}
              </div>
            )}
            {status === "active" && <p className="ap-note ok">Your licence {app.licence} is active. <a href="/partner">Open your partner dashboard</a></p>}
            {err && <p className="vf-err" role="alert">{err}</p>}
            {(status === "draft" || status === "rejected") && (
              <div className="ap-act">
                <button className="vf-btn ghost" onClick={() => setStep(3)}>Back</button>
                <button className="vf-btn red" disabled={!!busy} onClick={() => run("send", async () => setApp((await call("POST", "application/submit")) as Application))}>{busy === "send" ? "Sending" : "Send for review"}</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
