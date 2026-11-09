"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@/lib/use-mounted";
import { addPasskey } from "@/lib/passkey-client";
import { call, Card, Notice, Pill, Row, Soon, Toggle, usePrefs } from "./ui";

export type Me = {
  id: string; email: string; name: string; phone?: string;
  phoneVerified: boolean; faceVerified: boolean; idVerified: boolean; createdAt: string;
};
export type SettingsData = {
  username: string; hasPassword: boolean; passwordChangedAt: string | null; twoStep: boolean; loginAlerts: boolean;
  prefs: Record<string, unknown>; deleteAfter: string | null; identities: { provider: string; email: string; added: string }[]; passkeys: number;
};
export type ProfileData = { country?: string; birthDate?: string; appLanguage?: string; audioLanguage?: string; plan: string; planStatus: string; pendingPlan?: string; renewsAt?: string; subscribed?: boolean };
type Passkey = { id: string; name: string; createdAt: string; lastUsedAt?: string };
type Device = { id: string; device: string; lastSeenAt: string; current: boolean };

const LANGS: [string, string][] = [
  ["en", "English"], ["yo", "Yorùbá"], ["ha", "Hausa"], ["ig", "Igbo"], ["fr", "Français"], ["hi", "हिन्दी"],
  ["ko", "한국어"], ["es", "Español"], ["pt", "Português"], ["de", "Deutsch"], ["ar", "العربية"], ["sw", "Kiswahili"],
];
const day = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }, local = true) =>
  new Intl.DateTimeFormat("en-GB", local ? opts : { ...opts, timeZone: "UTC" }).format(new Date(iso));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "E";
const maskPhone = (p?: string) => (p && p.length > 8 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ••• ${p.slice(-4)}` : "");
const age = (birth?: string) => {
  if (!birth) return 0;
  const b = new Date(birth), n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};

/* ---------- Account (Figma 93:900) ---------- */

export function AccountSection({ me, settings, profile, passkeys: initialKeys, countryLabel, googleReady }: {
  me: Me; settings: SettingsData; profile: ProfileData; passkeys: Passkey[]; countryLabel: string; googleReady: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(me.name);
  const [username, setUsername] = useState(settings.username);
  const [keys, setKeys] = useState(initialKeys);
  const [ids, setIds] = useState(settings.identities);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" }>({ text: "", tone: "ok" });
  const [busy, setBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState(false);
  const [countryNote, setCountryNote] = useState(false);
  const dirty = name !== me.name || username !== settings.username;
  const adult = me.faceVerified && me.idVerified && age(profile.birthDate) >= 18;
  const google = ids.find((i) => i.provider === "google");

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { setMsg({ text: await fn(), tone: "ok" }); } catch (e) { setMsg({ text: (e as Error).message, tone: "err" }); }
    setBusy(false);
  };

  return (
    <>
      <h1 className="st-title">Account</h1>
      <Card title="Profile">
        <div className="st-profile">
          <span className="st-avatar" aria-hidden>{initials(name)}</span>
          <div><strong>{name || me.email}</strong><small>{username ? `@${username} · ` : ""}member since {day(me.createdAt, { month: "long", year: "numeric" })}</small></div>
          <button className="st-btn grey" onClick={() => setPhotoNote(true)}>Change photo</button>
        </div>
        {photoNote && <p className="st-hint">Profile photos are being switched on with the profile page. <Soon /></p>}
        <div className="st-grid">
          <label className="st-field"><span>Display name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /></label>
          <label className="st-field"><span>Username</span><input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="pick a username" maxLength={21} autoComplete="username" /></label>
          <label className="st-field"><span>Email</span><input value={me.email} readOnly aria-describedby="email-hint" /></label>
          <label className="st-field"><span>Phone</span><input value={me.phoneVerified ? me.phone ?? "" : ""} placeholder="Not verified yet" readOnly /></label>
        </div>
        <p className="st-hint" id="email-hint">Email changes need a check of the new address and are coming soon. Your phone is changed by verifying a new number.</p>
      </Card>

      <Card title="Verification">
        <Row title="Face check" sub={me.faceVerified ? "Done · keeps one account per person" : "Keeps one account per person"}>
          {me.faceVerified ? <Pill>Verified</Pill> : <a className="st-btn line" href="/join?step=2">Start</a>}
        </Row>
        <Row title="Phone" sub={me.phoneVerified ? maskPhone(me.phone) : "Used for codes and to protect your account"}>
          {me.phoneVerified ? <Pill>Verified</Pill> : <a className="st-btn line" href="/join?step=2">Verify</a>}
        </Row>
        <Row title="Country" sub={`${countryLabel}. Changing country needs a new ID check.`}>
          <button className="st-btn line" onClick={() => setCountryNote(true)}>Request change</button>
        </Row>
        {countryNote && <p className="st-hint">Country changes go through the ID check, which is being switched on. <Soon /> Until then, write to help@e-cinema.net.</p>}
        <Row title="18+ access" sub={adult ? "Unlocked by your face and ID check" : "Needs a face check, an ID check and an age of 18 or more"}>
          {adult ? <Pill tone="red">Unlocked</Pill> : <Pill tone="grey">Locked</Pill>}
        </Row>
      </Card>

      <Card title="Connected sign-in">
        {keys.map((k) => (
          <Row key={k.id} title={`Passkey · ${k.name}`} sub={`Added ${day(k.createdAt)}${k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : ""}`}>
            <button className="st-btn line" disabled={busy} onClick={() => run(async () => {
              await call(`/api/auth/passkeys/${k.id}`, "DELETE");
              setKeys((l) => l.filter((x) => x.id !== k.id));
              return "Passkey removed";
            })}>Remove</button>
          </Row>
        ))}
        {keys.length === 0 && (
          <Row title="Passkey" sub="Sign in with your face or fingerprint on this device">
            <button className="st-btn line" disabled={busy} onClick={() => run(async () => { await addPasskey(); router.refresh(); return "Passkey added"; })}>Add</button>
          </Row>
        )}
        <Row title="Google" sub={google ? google.email : "Sign in with your Google account"} tag={!google && !googleReady ? <Soon /> : undefined}>
          {google ? (
            <button className="st-btn line" disabled={busy} onClick={() => run(async () => {
              await call("/api/settings/identities/google", "DELETE");
              setIds((l) => l.filter((i) => i.provider !== "google"));
              return "Google disconnected";
            })}>Disconnect</button>
          ) : googleReady ? <a className="st-btn line" href="/api/auth/google/start">Connect</a> : null}
        </Row>
      </Card>

      <Notice {...msg} />
      <div className="st-actions">
        <button className="st-btn red lg" disabled={!dirty || busy} onClick={() => run(async () => {
          const out = await call("/api/settings/settings", "PATCH", { name, ...(username && username !== settings.username ? { username } : {}) });
          setUsername(out.username);
          router.refresh();
          return "Changes saved";
        })}>Save changes</button>
        <button className="st-btn line lg" disabled={!dirty || busy} onClick={() => { setName(me.name); setUsername(settings.username); setMsg({ text: "", tone: "ok" }); }}>Cancel</button>
      </div>
    </>
  );
}

/* ---------- Security and devices (Figma 33:781) ---------- */

const deviceIcon = (label: string) =>
  /iPhone|Android|phone/i.test(label)
    ? <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" />
    : <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9H4zM2 18h20" />;

export function SecuritySection({ me, settings, devices: initialDevices, max, signedOutOldest }: {
  me: Me; settings: SettingsData; devices: Device[]; max: number; signedOutOldest: boolean;
}) {
  const mounted = useMounted();
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [twoStep, setTwoStep] = useState(settings.twoStep);
  const [alerts, setAlerts] = useState(settings.loginAlerts);
  const [changing, setChanging] = useState(false);
  const [pw, setPw] = useState({ current: "", password: "", confirm: "" });
  const [changedAt, setChangedAt] = useState(settings.passwordChangedAt);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" }>(
    signedOutOldest ? { text: `You were signed in on more than ${max} devices, so the oldest one was signed out.`, tone: "ok" } : { text: "", tone: "ok" });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { setMsg({ text: await fn(), tone: "ok" }); } catch (e) { setMsg({ text: (e as Error).message, tone: "err" }); }
    setBusy(false);
  };
  const codesTo = me.phoneVerified ? `Codes by SMS to ${maskPhone(me.phone)}, or by email` : `Codes by email to ${me.email}`;

  return (
    <>
      <h1 className="st-title">Security and devices</h1>
      <Notice {...msg} />
      <Card title={`Signed-in devices · ${devices.length} of ${max}`}>
        <p className="st-desc">Each account can be signed in on {max} devices. Another sign-in signs out the oldest.</p>
        {devices.map((d) => (
          <div className="st-device" key={d.id}>
            <span className="st-dev-ico" aria-hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{deviceIcon(d.device)}</svg></span>
            <div><strong>{d.device}{d.current && <span className="st-this">THIS DEVICE</span>}</strong><small>{d.current ? "Active now" : `Last active ${day(d.lastSeenAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, mounted)}`}</small></div>
            {!d.current && (
              <button className="st-btn line" disabled={busy} onClick={() => run(async () => {
                await call(`/api/auth/devices/${d.id}`, "DELETE");
                setDevices((l) => l.filter((x) => x.id !== d.id));
                return `${d.device} signed out`;
              })}>Sign out</button>
            )}
          </div>
        ))}
      </Card>

      <Card title="Sign-in">
        <Row title="Passkey" sub={settings.passkeys ? "Fingerprint or face on your devices" : "Add one to sign in with your face or fingerprint"}>
          {settings.passkeys ? <span className="st-badge">ON</span> : (
            <button className="st-btn line" disabled={busy} onClick={() => run(async () => { await addPasskey(); router.refresh(); return "Passkey added"; })}>Add</button>
          )}
        </Row>
        <Row title="Two-step verification" sub={codesTo}>
          <Toggle label="Two-step verification" on={twoStep} disabled={busy} onChange={(v) => run(async () => {
            await call("/api/settings/settings", "PATCH", { twoStep: v });
            setTwoStep(v);
            return v ? "Two-step verification is on. After your password we will ask for a code." : "Two-step verification is off";
          })} />
        </Row>
        <Row title="Password" sub={!settings.hasPassword ? "You sign in with Google or a passkey" : changedAt ? `Last changed ${day(changedAt, undefined, mounted)}` : "Set when you joined"}>
          <button className="st-btn grey" onClick={() => setChanging((v) => !v)}>{settings.hasPassword ? "Change" : "Set one"}</button>
        </Row>
        {changing && (
          <form className="st-pwform" onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await call("/api/settings/password", "POST", pw);
              setChanging(false);
              setPw({ current: "", password: "", confirm: "" });
              setChangedAt(new Date().toISOString());
              return "Password changed";
            });
          }}>
            {settings.hasPassword && <label className="st-field"><span>Current password</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>}
            <label className="st-field"><span>New password (at least 12 characters)</span><input type="password" autoComplete="new-password" minLength={12} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required /></label>
            <label className="st-field"><span>Type it again</span><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></label>
            <div className="st-actions"><button className="st-btn red" disabled={busy}>Save password</button><a className="st-link" href="/forgot">Forgot it?</a></div>
          </form>
        )}
      </Card>

      <Card title="Protection">
        <Row title="Face check on new devices" sub="Confirms it is you before a new device can play films" tag={<Soon />}>
          <Toggle label="Face check on new devices" on={false} disabled onChange={() => {}} />
        </Row>
        <Row title="Login alerts" sub="Email when someone signs in on a new device">
          <Toggle label="Login alerts" on={alerts} disabled={busy} onChange={(v) => run(async () => {
            await call("/api/settings/settings", "PATCH", { loginAlerts: v });
            setAlerts(v);
            return v ? "Login alerts are on" : "Login alerts are off";
          })} />
        </Row>
        <Row title="Screen capture protection" sub="Films play with protection that shows black in screenshots and recordings" tag={<Soon />}>
          <span className="st-badge">ALWAYS ON</span>
        </Row>
      </Card>

      <div className="st-actions">
        <button className="st-btn grey lg" disabled={busy} onClick={() => run(async () => {
          await call("/api/settings/signout-all", "POST", {});
          router.push("/signin");
          router.refresh();
          return "Signed out of every device";
        })}>Sign out all devices</button>
        <a className="st-btn line lg" href="/account/delete">Delete account</a>
      </div>
    </>
  );
}

/* ---------- Language and region (Figma 33:901) ---------- */

export function LanguageSection({ profile, settings, countryLabel }: { profile: ProfileData; settings: SettingsData; countryLabel: string }) {
  const router = useRouter();
  const { prefs, set, msg } = usePrefs({ subtitles: "en", translateChat: true, voiceLanguage: "auto", volumeBoost: true, dialogue: true, ...settings.prefs });
  const [app, setApp] = useState(profile.appLanguage || "en");
  const [audio, setAudio] = useState(profile.audioLanguage || "en");
  const [browseNote, setBrowseNote] = useState(false);
  const [err, setErr] = useState("");
  const saveProfile = async (patch: Record<string, string>) => {
    try { await call("/api/me/profile", "PUT", patch); setErr(""); } catch (e) { setErr((e as Error).message); }
  };
  const select = (value: string, onChange: (v: string) => void, options: [string, string][], label: string) => (
    <select className="st-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <>
      <h1 className="st-title">Language and region</h1>
      <Notice text={err || msg.text} tone={err ? "err" : msg.tone} />
      <Card title="Country and currency">
        <Row title="Country" sub="Verified from your phone number and ID. Sets prices, payment methods and premiere times"><span className="st-btn grey static">{countryLabel}</span></Row>
        <Row title="Viewing another country" sub="See another country's premieres and prices without changing your account" tag={browseNote ? <Soon /> : undefined}>
          <button className="st-btn line" onClick={() => setBrowseNote(true)}>Browse as…</button>
        </Row>
        <p className="st-info">When you move country, re-verify once and everything switches: language, currency, payment methods and local times.</p>
      </Card>
      <Card title="Languages">
        <Row title="App language" sub="Menus, emails and notifications">{select(app, (v) => { setApp(v); saveProfile({ appLanguage: v }); fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: v }) }).then(() => router.refresh()).catch(() => {}); }, LANGS, "App language")}</Row>
        <Row title="Audio language" sub="Dub track to play first. Change per film any time">{select(audio, (v) => { setAudio(v); saveProfile({ audioLanguage: v }); }, LANGS, "Audio language")}</Row>
        <Row title="Subtitles" sub="Shown when audio is not in your app language">{select(String(prefs.subtitles), (v) => set("subtitles", v), [["off", "Off"], ...LANGS], "Subtitles")}</Row>
        <Row title="Translate chat" sub="Messages from other languages appear in yours, with the original one tap away"><Toggle label="Translate chat" on={Boolean(prefs.translateChat)} onChange={(v) => set("translateChat", v)} /></Row>
        <Row title="Voice concierge language" sub="Talk to E-Cinema AI in any supported language">{select(String(prefs.voiceLanguage), (v) => set("voiceLanguage", v), [["auto", "Auto-detect"], ...LANGS], "Voice concierge language")}</Row>
      </Card>
      <Card title="Audio">
        <Row title="Volume boost" sub="Allow volume up to 200% with a limiter that prevents distortion"><Toggle label="Volume boost" on={Boolean(prefs.volumeBoost)} onChange={(v) => set("volumeBoost", v)} /></Row>
        <Row title="Dialogue enhance" sub="AI lifts voices above music and effects"><Toggle label="Dialogue enhance" on={Boolean(prefs.dialogue)} onChange={(v) => set("dialogue", v)} /></Row>
      </Card>
    </>
  );
}

/* ---------- Plan and payments (Figma 93:1091) ---------- */

export type Bill = { id: string; date: string; what: string; amount: string };

export function PlanSection({ plan, price, renews, bills, paidPlan, subscribed, pendingPay }: { plan: { badge: string; name: string; blurb: string }; price: string; renews: string; bills: Bill[]; paidPlan: boolean; subscribed: boolean; pendingPay: boolean }) {
  const [note, setNote] = useState(false);
  const [cancelling, setCancelling] = useState<"idle" | "ask" | "busy" | "error">("idle");
  const cancel = async () => {
    setCancelling("busy");
    const r = await fetch("/api/me/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: "free" }) });
    if (r.ok) window.location.reload(); else setCancelling("error");
  };
  return (
    <>
      <h1 className="st-title">Plan and payments</h1>
      <Card title="Your plan">
        <div className="st-plan">
          <div><p><span className="st-plan-badge">{plan.badge}</span><strong>{price}</strong></p><small>{renews}</small></div>
          <span className="st-plan-acts">
            {pendingPay && <a className="st-btn red" href="/join?step=4">Finish payment</a>}
            <a className="st-btn grey" href="/plans">Change plan</a>
          </span>
        </div>
      </Card>
      <Card title="Payment methods" aside="Every local method, plus PayPal">
        <Row title="No saved payment methods yet" sub="You pay with PayPal at checkout. Saved cards, bank transfer and airtime arrive with Paystack and Flutterwave." />
        <div><button className="st-btn grey" onClick={() => setNote(true)}>Add a payment method</button>{note && <span className="st-hint inline"> Saving a card is being switched on. <Soon /></span>}</div>
      </Card>
      <Card title="Billing history">
        {bills.length === 0 ? <p className="st-desc">Nothing yet. Your ticket and plan payments will show here.</p> : (
          <div className="st-table" role="table" aria-label="Billing history">
            <div className="st-tr head" role="row"><span role="columnheader">Date</span><span role="columnheader">What</span><span role="columnheader">Amount</span><span role="columnheader">Receipt</span></div>
            {bills.map((b, i) => (
              <div className="st-tr" role="row" key={i}><span role="cell">{b.date}</span><span role="cell">{b.what}</span><span role="cell">{b.amount}</span><span role="cell"><a className="st-btn line sm" href={`/receipts/${b.id}`} target="_blank" rel="noopener">PDF</a></span></div>
            ))}
          </div>
        )}
      </Card>
      {paidPlan && (
        <div className="st-foot">
          {cancelling === "ask" || cancelling === "busy" ? (
            <p>Move to Free now? {subscribed ? "Your PayPal subscription is cancelled straight away, so you are not billed again." : ""}{" "}
              <button className="st-btn line sm" onClick={cancel} disabled={cancelling === "busy"}>{cancelling === "busy" ? "Cancelling…" : "Yes, move to Free"}</button>{" "}
              <button className="st-btn line sm" onClick={() => setCancelling("idle")}>Keep my plan</button></p>
          ) : (
            <p>{cancelling === "error" ? "PayPal could not cancel just now. Please try again. " : ""}<button className="st-link" onClick={() => setCancelling("ask")}>Cancel plan</button> and move to Free.</p>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- Notifications (Figma 93:1336) ---------- */

const EVENTS: [string, string, boolean[]][] = [
  ["premieres", "Premieres from studios you follow", [true, true, false, false]],
  ["onSale", "A coming-soon film goes on sale", [true, true, false, true]],
  ["friendRoom", "A friend opens a room", [true, false, false, false]],
  ["orders", "Order and delivery updates", [true, false, true, true]],
  ["preorder", "Pre-order price stage ending", [true, true, false, false]],
  ["features", "New features and updates", [true, true, false, false]],
];
const CHANNELS = ["push", "email", "sms", "whatsapp"];

export function NotificationsSection({ settings }: { settings: SettingsData }) {
  const defaults: Record<string, unknown> = { quietHours: true, bestTime: true };
  for (const [ev, , d] of EVENTS) CHANNELS.forEach((c, i) => (defaults[`n.${ev}.${c}`] = d[i]));
  const { prefs, set, msg } = usePrefs({ ...defaults, ...settings.prefs });
  return (
    <>
      <h1 className="st-title">Notifications</h1>
      <Notice {...msg} />
      <Card title="What you hear about">
        <div className="st-matrix" role="table" aria-label="Notification channels">
          <div className="st-mrow head" role="row"><span role="columnheader">Event</span>{["Push", "Email", "SMS", "WhatsApp"].map((c) => <span key={c} role="columnheader">{c}</span>)}</div>
          {EVENTS.map(([ev, label]) => (
            <div className="st-mrow" role="row" key={ev}>
              <span role="rowheader">{label}</span>
              {CHANNELS.map((c) => (
                <span role="cell" key={c} data-ch={c}><Toggle label={`${label} by ${c}`} on={Boolean(prefs[`n.${ev}.${c}`])} onChange={(v) => set(`n.${ev}.${c}`, v)} /></span>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Quiet hours">
        <Row title="Do not disturb" sub="22:00 to 07:00, except a premiere you booked"><Toggle label="Do not disturb" on={Boolean(prefs.quietHours)} onChange={(v) => set("quietHours", v)} /></Row>
        <Row title="AI best time" sub="Send promotions when you usually open the app"><Toggle label="AI best time" on={Boolean(prefs.bestTime)} onChange={(v) => set("bestTime", v)} /></Row>
        <p className="st-desc">Account and payment messages always arrive.</p>
      </Card>
    </>
  );
}

/* ---------- Data saver (Figma 93:1493) ---------- */

const QUALITIES: [string, string][] = [["auto", "Auto"], ["480p", "Data saver · 480p"], ["1080p", "HD · 1080p"], ["4k", "4K HDR"], ["audio", "Audio first"]];

export function DataSaverSection({ settings }: { settings: SettingsData }) {
  const { prefs, set, msg } = usePrefs({ quality: "auto", wifiOnly4k: true, lowBattery: true, preloadTrailers: false, ...settings.prefs });
  return (
    <>
      <h1 className="st-title">Data saver</h1>
      <Notice {...msg} />
      <Card title="Streaming quality">
        <div className="st-chips" role="radiogroup" aria-label="Streaming quality">
          {QUALITIES.map(([v, l]) => <button key={v} role="radio" aria-checked={prefs.quality === v} className={`st-chip${prefs.quality === v ? " on" : ""}`} onClick={() => set("quality", v)}>{l}</button>)}
        </div>
        <p className="st-desc">Auto picks the best quality your network can hold without buffering.</p>
      </Card>
      <Card title="Data used per hour">
        <div className="st-table two" role="table" aria-label="Data used per hour">
          <div className="st-tr head" role="row"><span role="columnheader">Quality</span><span role="columnheader">Mobile data per hour</span></div>
          {[["Audio first (picture at 240p)", "about 150 MB"], ["Data saver 480p", "about 400 MB"], ["HD 1080p", "about 1.5 GB"], ["4K HDR", "about 6 GB"]].map(([q, d]) => (
            <div className="st-tr" role="row" key={q}><span role="cell">{q}</span><span role="cell">{d}</span></div>
          ))}
        </div>
      </Card>
      <Card title="Mobile data">
        <Row title="Use Wi-Fi only for 4K"><Toggle label="Use Wi-Fi only for 4K" on={Boolean(prefs.wifiOnly4k)} onChange={(v) => set("wifiOnly4k", v)} /></Row>
        <Row title="Lower quality when battery is under 20%"><Toggle label="Lower quality when battery is under 20%" on={Boolean(prefs.lowBattery)} onChange={(v) => set("lowBattery", v)} /></Row>
        <Row title="Preload trailers"><Toggle label="Preload trailers" on={Boolean(prefs.preloadTrailers)} onChange={(v) => set("preloadTrailers", v)} /></Row>
      </Card>
    </>
  );
}

/* ---------- Privacy and data (Figma 93:1666) ---------- */

export function PrivacySection({ settings }: { settings: SettingsData }) {
  const { prefs, set, msg } = usePrefs({ showOnMap: true, friendsSee: true, showReviews: true, messages: "friends", personalised: true, autoTranslate: true, ...settings.prefs });
  return (
    <>
      <h1 className="st-title">Privacy and data</h1>
      <Notice {...msg} />
      <Card title="Who sees what">
        <Row title="Show me on the world map" sub="As a dot in your city, never your exact place"><Toggle label="Show me on the world map" on={Boolean(prefs.showOnMap)} onChange={(v) => set("showOnMap", v)} /></Row>
        <Row title="Friends see what I am watching"><Toggle label="Friends see what I am watching" on={Boolean(prefs.friendsSee)} onChange={(v) => set("friendsSee", v)} /></Row>
        <Row title="Show my reviews on my profile"><Toggle label="Show my reviews on my profile" on={Boolean(prefs.showReviews)} onChange={(v) => set("showReviews", v)} /></Row>
        <div className="st-row inline">
          <strong>Who can message me</strong>
          <div className="st-chips" role="radiogroup" aria-label="Who can message me">
            {[["everyone", "Everyone"], ["friends", "Friends"], ["none", "No one"]].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={prefs.messages === v} className={`st-chip${prefs.messages === v ? " on" : ""}`} onClick={() => set("messages", v)}>{l}</button>
            ))}
          </div>
        </div>
      </Card>
      <Card title="AI and personalisation">
        <Row title="Personalised picks" sub="Uses what you watch, never your voice chat"><Toggle label="Personalised picks" on={Boolean(prefs.personalised)} onChange={(v) => set("personalised", v)} /></Row>
        <Row title="Translate my chat automatically"><Toggle label="Translate my chat automatically" on={Boolean(prefs.autoTranslate)} onChange={(v) => set("autoTranslate", v)} /></Row>
      </Card>
      <Card title="Your data">
        <Row title="Download my data" sub="A file with everything we hold about you, ready straight away"><a className="st-btn grey" href="/api/settings/export" download>Request</a></Row>
        <Row title="Delete my account" sub="Removes your data within 30 days. Tickets and credit are lost."><a className="st-btn line" href="/account/delete">Delete account</a></Row>
      </Card>
      <p className="st-foot">Read the <a href="/privacy">privacy policy</a> and <a href="/terms">terms of use</a> under Legal.</p>
    </>
  );
}

/* ---------- Delete account (Figma 96:1493) ---------- */

export function DeleteCard({ tickets, plan }: { tickets: number; plan: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  if (done) {
    return (
      <div className="ca-card">
        <h1>Account scheduled for deletion</h1>
        <p className="ca-sub">Your account and data will be deleted on {done}. You are signed out everywhere. Sign in before then to keep it.</p>
        <a className="ca-btn red" href="/">Back to E-Cinema</a>
      </div>
    );
  }
  return (
    <form className="ca-card st-delete" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr("");
      try {
        const r = await call("/api/settings/delete", "POST", { confirm: text });
        setDone(day(r.deleteAfter, { day: "numeric", month: "long", year: "numeric" }));
        router.refresh();
      } catch (e2) { setErr((e2 as Error).message); }
      setBusy(false);
    }}>
      <span className="ca-ico sm" aria-hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg></span>
      <h1>Delete your account?</h1>
      <p className="ca-sub">This cannot be undone after 30 days. Until then you can sign in to cancel.</p>
      <div className="st-lose">
        <strong>You will lose</strong>
        <ul>
          <li>{tickets === 1 ? "1 upcoming ticket" : `${tickets} upcoming tickets`}</li>
          {plan !== "free" && <li>Your {plan[0]!.toUpperCase() + plan.slice(1)} plan</li>}
          <li>Reviews, badges, collections and messages</li>
        </ul>
      </div>
      <a className="st-btn grey fit" href="/api/settings/export" download>Download my data first</a>
      <label className="ca-field"><span>Type DELETE to confirm</span><input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" className={text === "DELETE" ? "armed" : ""} /></label>
      <p className="ca-dim small">Face check before deleting is coming soon; for now typing DELETE confirms it is you.</p>
      {err && <p className="ca-err" role="alert">{err}</p>}
      <div className="st-actions">
        <button className="ca-btn red st-fit" disabled={busy || text !== "DELETE"}>{busy ? "Deleting…" : "Delete my account"}</button>
        <a className="ca-btn line st-fit" href="/settings/privacy">Keep my account</a>
      </div>
    </form>
  );
}
