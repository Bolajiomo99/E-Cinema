// Creates or updates E-Cinema on Render through the Render API, using only the
// "E-Cinema" workspace. Safe to run again: it looks resources up by name first.
// Never prints secret values; logs show ids, names, URLs and status codes only.
import { randomBytes } from "node:crypto";

const KEY = process.env.RENDER_API_KEY;
const OWNER = process.env.RENDER_OWNER_ID; // E-Cinema workspace
const BRANCH = process.env.DEPLOY_BRANCH;
const REPO = "https://github.com/Bolajiomo99/E-Cinema";
const REGION = "frankfurt";
const PLAN = "starter";

if (!KEY || !OWNER || !BRANCH) throw new Error("RENDER_API_KEY, RENDER_OWNER_ID and DEPLOY_BRANCH are required");

async function api(method, path, body) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} -> ${res.status} ${data?.message ?? ""}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Workspace guard: refuse to touch anything but "E-Cinema".
const owner = await api("GET", `/owners/${OWNER}`);
if (owner.name !== "E-Cinema") throw new Error(`Workspace is "${owner.name}", expected "E-Cinema"`);
console.log(`Workspace: ${owner.name}`);

// 2. Project and production environment.
let project = (await api("GET", `/projects?ownerId=${OWNER}&name=e-cinema&limit=20`))
  .map((p) => p.project).find((p) => p.name === "e-cinema");
if (!project) {
  project = await api("POST", "/projects", { name: "e-cinema", ownerId: OWNER, environments: [{ name: "production" }] });
  console.log(`Created project ${project.id}`);
}
const envs = await api("GET", `/environments?projectId=${project.id}&limit=20`);
const env = envs.map((e) => e.environment).find((e) => e.name === "production");
if (!env) throw new Error("production environment missing");
console.log(`Project ${project.name}, environment ${env.name}`);

// 3. Postgres 16.
let db = (await api("GET", `/postgres?ownerId=${OWNER}&name=e-cinema-db&limit=20`))
  .map((p) => p.postgres).find((p) => p.name === "e-cinema-db");
if (!db) {
  db = await api("POST", "/postgres", {
    name: "e-cinema-db", ownerId: OWNER, environmentId: env.id, plan: "basic_256mb", region: REGION,
    version: "16", databaseName: "ecinema", databaseUser: "ecinema", ipAllowList: [],
  });
  console.log(`Created database ${db.id}`);
}
for (let i = 0; i < 60 && db.status !== "available"; i++) {
  await sleep(10_000);
  db = await api("GET", `/postgres/${db.id}`);
  console.log(`Database status: ${db.status}`);
}
if (db.status !== "available") throw new Error("database did not become available");
const { internalConnectionString } = await api("GET", `/postgres/${db.id}/connection-info`);

// 4. Services.
async function findService(name) {
  const list = await api("GET", `/services?ownerId=${OWNER}&name=${name}&limit=20`);
  return list.map((s) => s.service).find((s) => s.name === name);
}
async function currentEnv(id) {
  const vars = await api("GET", `/services/${id}/env-vars?limit=100`);
  return Object.fromEntries(vars.map((v) => [v.envVar.key, v.envVar.value]));
}
async function upsertService(name, details, envVars) {
  let svc = await findService(name);
  const list = Object.entries(envVars).map(([key, value]) => ({ key, value: String(value) }));
  if (!svc) {
    const created = await api("POST", "/services", {
      type: "web_service", name, ownerId: OWNER, environmentId: env.id, repo: REPO, branch: BRANCH,
      rootDir: details.rootDir, autoDeploy: "yes", envVars: list,
      serviceDetails: {
        runtime: details.runtime, plan: PLAN, region: REGION, healthCheckPath: details.healthCheckPath,
        envSpecificDetails: { buildCommand: details.buildCommand, startCommand: details.startCommand },
      },
    });
    svc = created.service;
    console.log(`Created ${name}: ${svc.serviceDetails.url}`);
  } else {
    await api("PUT", `/services/${svc.id}/env-vars`, list);
    await api("POST", `/services/${svc.id}/deploys`, {});
    console.log(`Updated ${name} and started a deploy: ${svc.serviceDetails.url}`);
  }
  return svc;
}

const existingApi = await findService("e-cinema-api");
const existingWeb = await findService("e-cinema-web");
// Passkeys are bound to the web app's domain. Override with WEBAUTHN_RP_ID once e-cinema.net points at the site.
const webOrigin = existingWeb?.serviceDetails?.url;
const rpId = process.env.WEBAUTHN_RP_ID || (webOrigin ? new URL(webOrigin).hostname : "");
const token = (existingApi && (await currentEnv(existingApi.id)).INTERNAL_API_TOKEN) || randomBytes(32).toString("hex");

const apiSvc = await upsertService(
  "e-cinema-api",
  {
    runtime: "go", rootDir: "api", healthCheckPath: "/healthz",
    buildCommand: 'go build -trimpath -ldflags="-s -w" -o bin/api ./cmd/api', startCommand: "./bin/api",
  },
  {
    DATABASE_URL: internalConnectionString,
    INTERNAL_API_TOKEN: token,
    ALLOWED_ORIGINS: "e-cinema.net,*.e-cinema.net,*.onrender.com",
    // Phone codes switch on once Termii approves the sender ID (TERMII_SENDER_ID secret);
    // face and ID checks run through Sumsub.
    ...(rpId ? { WEBAUTHN_RP_ID: rpId, WEBAUTHN_ORIGINS: process.env.WEBAUTHN_ORIGINS || `https://${rpId}` } : {}),
    ...Object.fromEntries(
      ["TERMII_API_KEY", "TERMII_SENDER_ID", "SUMSUB_APP_TOKEN", "SUMSUB_SECRET_KEY", "CEO_EMAILS"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
    ),
  },
);

// R2 (Cloudflare) media storage: shared by the web app (dub playback) and the workflows (dubbing).
let r2Endpoint;
if (process.env.CLOUDFLARE_API_TOKEN) {
  const zone = await fetch("https://api.cloudflare.com/client/v4/zones?name=e-cinema.net", {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
  }).then((r) => r.json());
  const account = zone.result?.[0]?.account?.id;
  if (account) r2Endpoint = `https://${account}.r2.cloudflarestorage.com`;
  else console.log("Could not read the Cloudflare account; R2 endpoint not set");
  // Let the web app read media with CORS, so the watch room can boost volume past 100%
  // through Web Audio. Reads and writes still need a signed link; this only adds the headers.
  if (account) {
    // The R2 token can change bucket settings; the general Cloudflare token cannot.
    const cors = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/e-cinema-media/cors`, {
      method: "PUT",
      headers: { authorization: `Bearer ${process.env.R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        rules: [{
          // PUT lets studios send film parts straight to storage with signed links (Figma 35:290);
          // the browser needs each part's ETag to finish the upload.
          allowed: { origins: ["https://e-cinema.net", "https://www.e-cinema.net", "https://e-cinema-web.onrender.com"], methods: ["GET", "HEAD", "PUT"], headers: ["range", "content-type"] },
          exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
          maxAgeSeconds: 3600,
        }],
      }),
    }).then((r) => r.json()).catch((e) => ({ success: false, errors: [{ message: e.message }] }));
    console.log(cors.success ? "R2 CORS set for the web app" : `R2 CORS not set: ${JSON.stringify(cors.errors ?? []).slice(0, 200)}`);
  }
}
const r2Env = {
  R2_ENDPOINT: r2Endpoint,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: "e-cinema-media",
};

const webEnv = {
  NODE_VERSION: "22",
  API_URL: apiSvc.serviceDetails.url,
  INTERNAL_API_TOKEN: token,
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  // Voice notes in the watch room get an auto-transcript from ElevenLabs speech to text.
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  CHANNEL3_API_KEY: process.env.CHANNEL3_API_KEY,
  NEXT_PUBLIC_AG_GRID_LICENSE_KEY: process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY,
  ...r2Env,
  WEB_URL: process.env.WEB_PUBLIC_URL || existingWeb?.serviceDetails?.url,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  // Sign-in codes, reset links and "This wasn't me" emails go out through Resend.
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  // Uptime gauges on the executive pages (read-only key).
  UPTIMEROBOT_API_KEY: process.env.UPTIMEROBOT_API_KEY,
  // Each payment method switches on when its key exists.
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
  FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY,
  FLUTTERWAVE_WEBHOOK_HASH: process.env.FLUTTERWAVE_WEBHOOK_HASH,
  COINBASE_COMMERCE_API_KEY: process.env.COINBASE_COMMERCE_API_KEY,
};
if (existingWeb) {
  const webhookId = (await currentEnv(existingWeb.id)).PAYPAL_WEBHOOK_ID;
  if (webhookId) webEnv.PAYPAL_WEBHOOK_ID = webhookId;
}
if (process.env.PAYPAL_WEBHOOK_ID) webEnv.PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

// Register (or find) the PayPal sandbox webhook pointing at the live web service.
async function ensurePaypalWebhook(webUrl) {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return null;
  const base = "https://api-m.sandbox.paypal.com";
  const tok = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tok.ok) throw new Error(`PayPal token -> ${tok.status}`);
  const auth = { authorization: `Bearer ${(await tok.json()).access_token}`, "content-type": "application/json" };
  const url = `${webUrl}/api/paypal/webhooks`;
  const list = await (await fetch(`${base}/v1/notifications/webhooks`, { headers: auth })).json();
  const found = (list.webhooks ?? []).find((w) => w.url === url);
  if (found) {
    // Keep the event list in step with what the web app handles (new events are added here).
    const have = new Set((found.event_types ?? []).map((e) => e.name));
    if (PAYPAL_EVENTS.some((e) => !have.has(e))) {
      const res = await fetch(`${base}/v1/notifications/webhooks/${found.id}`, {
        method: "PATCH", headers: auth,
        body: JSON.stringify([{ op: "replace", path: "/event_types", value: PAYPAL_EVENTS.map((name) => ({ name })) }]),
      });
      console.log(`PayPal webhook events ${res.ok ? "updated" : `not updated (${res.status})`}`);
    }
    console.log(`PayPal webhook already registered: ${found.id}`);
    return found.id;
  }
  const res = await fetch(`${base}/v1/notifications/webhooks`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ url, event_types: PAYPAL_EVENTS.map((name) => ({ name })) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`PayPal webhook create -> ${res.status} ${body.name ?? ""}`);
  console.log(`Registered PayPal webhook ${body.id} for ${url}`);
  return body.id;
}
const PAYPAL_EVENTS = [
  "CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REFUNDED",
  "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.RESOLVED", "BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.PAYMENT.FAILED", "PAYMENT.SALE.COMPLETED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED",
];
const webUrlNow = existingWeb?.serviceDetails?.url;
if (webUrlNow) {
  const hookId = await ensurePaypalWebhook(webUrlNow).catch((e) => { console.log(`PayPal webhook check skipped: ${e.message}`); return null; });
  if (hookId && !webEnv.PAYPAL_WEBHOOK_ID) webEnv.PAYPAL_WEBHOOK_ID = hookId;
}
for (const [k, v] of Object.entries(webEnv)) if (!v) { console.log(`Skipping empty ${k}`); delete webEnv[k]; }

const webSvc = await upsertService(
  "e-cinema-web",
  { runtime: "node", rootDir: "web", healthCheckPath: "/checkout", buildCommand: "npm ci && npm run build", startCommand: "npm start" },
  webEnv,
);

// 5. Wait for both services to go live.
async function waitLive(svc) {
  for (let i = 0; i < 90; i++) {
    const [latest] = await api("GET", `/services/${svc.id}/deploys?limit=1`);
    const status = latest?.deploy?.status;
    if (status === "live") return console.log(`${svc.name} is live`);
    if (["build_failed", "update_failed", "canceled", "pre_deploy_failed"].includes(status)) {
      throw new Error(`${svc.name} deploy ${status}`);
    }
    if (i % 3 === 0) console.log(`${svc.name}: ${status}`);
    await sleep(10_000);
  }
  throw new Error(`${svc.name} did not go live in time`);
}
await waitLive(apiSvc);
await waitLive(webSvc);

// 6. Render Workflow service: studio payouts and subtitle translation (workflows/).
// Nightly database copy (Figma 50:469): a cron job inside Render's private network dumps the
// database, test-restores it in its own container and saves it to the private R2 backups bucket.
if (r2Endpoint && process.env.R2_ACCESS_KEY_ID) {
  const cronVars = [
    { key: "DATABASE_URL", value: internalConnectionString },
    { key: "R2_ENDPOINT", value: r2Endpoint },
    { key: "AWS_ACCESS_KEY_ID", value: process.env.R2_ACCESS_KEY_ID },
    { key: "AWS_SECRET_ACCESS_KEY", value: process.env.R2_SECRET_ACCESS_KEY },
    { key: "BACKUP_BUCKET", value: "e-cinema-backups" },
  ];
  let cron = await findService("e-cinema-backup");
  let runNow = process.env.BACKUP_NOW === "1";
  if (!cron) {
    cron = (await api("POST", "/services", {
      type: "cron_job", name: "e-cinema-backup", ownerId: OWNER, environmentId: env.id, repo: REPO, branch: BRANCH,
      rootDir: "ops/backup", autoDeploy: "yes", envVars: cronVars,
      serviceDetails: { runtime: "docker", plan: "starter", region: REGION, schedule: "0 0 * * *", envSpecificDetails: { dockerfilePath: "./Dockerfile", dockerContext: "." } },
    })).service;
    console.log("Created the nightly backup cron job (01:00 Lagos)");
    runNow = true;
  } else {
    await api("PUT", `/services/${cron.id}/env-vars`, cronVars);
    console.log("Backup cron job exists");
  }
  if (runNow) {
    let dep;
    for (let i = 0; i < 60; i++) {
      dep = (await api("GET", `/services/${cron.id}/deploys?limit=1`))[0]?.deploy;
      if (dep && ["live", "build_failed", "update_failed", "canceled", "deactivated"].includes(dep.status)) break;
      await sleep(10_000);
    }
    if (dep?.status === "live") {
      await api("POST", `/cron-jobs/${cron.id}/runs`, {});
      console.log("Started the first backup run");
    } else console.log(`Backup cron build: ${dep?.status}`);
  }
}

const wfEnv = {
  API_URL: apiSvc.serviceDetails.url,
  INTERNAL_API_TOKEN: token,
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ...r2Env,
};
const wfVars = Object.entries(wfEnv).filter(([, v]) => v).map(([key, value]) => ({ key, value: String(value) }));
const wfList = await api("GET", `/workflows?ownerId=${OWNER}&name=e-cinema-workflows&limit=20`);
let wf = (wfList ?? []).map((w) => w.workflow ?? w).find((w) => w.name === "e-cinema-workflows");
if (!wf) {
  wf = await api("POST", "/workflows", {
    name: "e-cinema-workflows", ownerId: OWNER, region: REGION, runCommand: "node dist/main.js",
    autoDeployTrigger: "commit", envVars: wfVars,
    buildConfig: { repo: REPO, branch: BRANCH, rootDir: "workflows", runtime: "node", buildCommand: "npm ci && npm run build" },
  });
  console.log(`Created workflow ${wf.slug ?? wf.id}`);
} else {
  try {
    await api("PUT", `/services/${wf.id}/env-vars`, wfVars);
  } catch (err) {
    console.log(`Could not update workflow env vars: ${err.message}`);
  }
  console.log(`Workflow exists: ${wf.slug ?? wf.id}`);
}
let version = await api("POST", "/workflowversions", { workflowId: wf.id });
for (let i = 0; i < 90 && !["ready", "build_failed", "registration_failed"].includes(version.status); i++) {
  await sleep(10_000);
  version = await api("GET", `/workflowversions/${version.id}`);
  if (i % 3 === 0) console.log(`Workflow version: ${version.status}`);
}
if (version.status !== "ready") throw new Error(`workflow version ${version.status}`);
const slug = wf.slug ?? (await api("GET", `/workflows/${wf.id}`)).slug;
console.log(`Workflow ready: ${slug}`);

// Smoke run: the payout sweep must register and finish (it pays nothing until a screening has ended).
let run = await api("POST", "/task-runs", { task: `${slug}/payEndedScreenings`, input: [] });
for (let i = 0; i < 60 && !["completed", "succeeded", "failed", "canceled"].includes(run.status); i++) {
  await sleep(5_000);
  run = await api("GET", `/task-runs/${run.id}`);
}
console.log(`payEndedScreenings: ${run.status} ${JSON.stringify(run.results ?? run.error ?? null)}`);
if (!["completed", "succeeded"].includes(run.status)) throw new Error("payout sweep did not succeed");

const out = process.env.GITHUB_OUTPUT;
if (out) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(out, `api_url=${apiSvc.serviceDetails.url}\nweb_url=${webSvc.serviceDetails.url}\n`);
}
