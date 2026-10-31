// Points e-cinema.net and www.e-cinema.net at the live web service:
// adds the custom domains on Render and the matching DNS records on Cloudflare. Safe to re-run.
// Mail records (MX, TXT for email routing and Resend) are never touched.
const KEY = process.env.RENDER_API_KEY;
const OWNER = process.env.RENDER_OWNER_ID;
const CF = process.env.CLOUDFLARE_API_TOKEN;
const DOMAIN = "e-cinema.net";
const RENDER_APEX_IP = "216.24.57.1"; // Render's documented address for apex domains

async function render(method, path, body) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 409) throw new Error(`Render ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${CF}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Cloudflare ${method} ${path}: ${JSON.stringify(data.errors)}`);
  return data.result;
}

const owner = (await render("GET", `/owners/${OWNER}`)).data;
if (owner.name !== "E-Cinema") throw new Error(`Refusing to touch workspace "${owner.name}"`);
const svc = (await render("GET", `/services?ownerId=${OWNER}&name=e-cinema-web&limit=1`)).data?.[0]?.service;
if (!svc) throw new Error("e-cinema-web not found");
const target = new URL(svc.serviceDetails.url).hostname;

for (const name of [DOMAIN, `www.${DOMAIN}`]) {
  const r = await render("POST", `/services/${svc.id}/custom-domains`, { name });
  console.log(`Render custom domain ${name}: ${r.status === 409 ? "already added" : "added"}`);
}

const zone = (await cf("GET", `/zones?name=${DOMAIN}`))[0];
const records = await cf("GET", `/zones/${zone.id}/dns_records?per_page=100`);
const want = [
  { type: "A", name: DOMAIN, content: RENDER_APEX_IP },
  { type: "CNAME", name: `www.${DOMAIN}`, content: target },
];
for (const rec of want) {
  // Only web records (A/AAAA/CNAME) on the same name are replaced.
  const clash = records.filter((r) => r.name === rec.name && ["A", "AAAA", "CNAME"].includes(r.type));
  const same = clash.find((r) => r.type === rec.type && r.content === rec.content);
  for (const r of clash) {
    if (r !== same) {
      console.log(`Removing old ${r.type} ${r.name} -> ${r.content}`);
      await cf("DELETE", `/zones/${zone.id}/dns_records/${r.id}`);
    }
  }
  if (same) {
    if (same.proxied) await cf("PATCH", `/zones/${zone.id}/dns_records/${same.id}`, { proxied: false });
    console.log(`DNS ${rec.type} ${rec.name} already points at ${rec.content}`);
  } else {
    // DNS only (not proxied) so Render can issue the TLS certificate.
    await cf("POST", `/zones/${zone.id}/dns_records`, { ...rec, ttl: 300, proxied: false, comment: "E-Cinema web app on Render" });
    console.log(`DNS ${rec.type} ${rec.name} -> ${rec.content} created`);
  }
}

for (const name of [DOMAIN, `www.${DOMAIN}`]) {
  await render("POST", `/services/${svc.id}/custom-domains/${name}/verify`).catch((e) => console.log(e.message));
}
const list = (await render("GET", `/services/${svc.id}/custom-domains`)).data ?? [];
for (const d of Array.isArray(list) ? list : []) {
  const c = d.customDomain ?? d;
  console.log(`${c.name}: verification ${c.verificationStatus}`);
}
