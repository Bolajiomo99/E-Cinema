# E-Cinema

**Watch new films live with the whole world on premiere night, in your own language.**

E-Cinema is a live, worldwide cinema for new releases. Every film premieres once, at one time, for everyone, then returns as a weekly encore. Viewers pay in their own currency, hear the film dubbed by AI in their language, and talk with the room in a world chat that is translated for each of them. An AI agent, **E-Cinema AI**, finds the screening, holds the seats and builds the PayPal order. The viewer approves every payment.

- Live site: **https://e-cinema.net** (PayPal is in sandbox mode, so no real money moves)
- Built for the **PayPal AI Hackathon 2026**
- Company: Online Cinema Ltd, trading as E-Cinema (Lagos, Nigeria)

## What you can try

| Where | What it does |
| --- | --- |
| `/` and `/home` | Premieres with countdowns, prices in your currency, and E-Cinema AI on the signed-in home page |
| `/join` | Sign-up with email, phone, a 5-second face check (Sumsub) and a passkey: one person, one seat |
| `/concierge` or "Ask AI" | E-Cinema AI books seats and returns a PayPal order for you to approve |
| `/checkout?film=<showtime id>` | PayPal checkout (JS SDK v6), plus Paystack and Flutterwave for naira payments in Nigeria |
| `/tickets` | Your seats. Cancelling one refunds the PayPal capture |
| `/room/<showtime id>` | The synced watch room: translated world chat, AI dubs, polls, "Shop the film", VR mode |
| `/releases` | Release calendar (Bryntum Calendar) |
| `/studio` | Studio portal: upload, prices per country, AI dubbing review, live control room, payouts |
| `/executive` | Executive dashboards, including "PayPal and agents" (AG Grid) |

## How PayPal is used

| PayPal product | Where | Code |
| --- | --- | --- |
| JavaScript SDK v6 + Orders API v2 | Tickets, gifts, pre-orders, 18+ unlocks, merch and every agent booking. The server prices the order from its own catalogue, creates it and captures it after approval | `web/app/checkout`, `web/app/api/paypal/`, `web/lib/paypal.ts` |
| PayPal Server SDK (`@paypal/paypal-server-sdk`) | Orders, captures and refunds through PayPal's typed TypeScript SDK | `web/lib/paypal.ts` |
| Pay Later | Pre-orders and larger baskets | `web/lib/pay-methods.ts` |
| Subscriptions | Pro, VIP, Student and Family plans, with billing plans per currency and monthly or yearly cycles | `web/lib/paypal-subs.ts` |
| Refunds | Cancelling a seat refunds the capture, with the hold id as `PayPal-Request-Id` so it refunds once | `web/app/api/tickets/[id]/cancel/route.ts` |
| Webhooks (signature verified) | `PAYMENT.CAPTURE.*`, `CUSTOMER.DISPUTE.*`, `BILLING.SUBSCRIPTION.*`, `PAYMENT.SALE.COMPLETED` | `web/app/api/paypal/webhooks/route.ts`, `web/lib/paypal-webhook.ts` |
| Payouts | After each premiere, a Render Workflow pays each studio its 70% share, idempotent per showing (`sender_batch_id`) | `workflows/src/payouts.ts`, `workflows/src/paypal.ts` |
| Disputes | Open disputes and deadlines in the executive dashboard | `web/components/exec/ExecPayPal.tsx` |

Credentials are read from the environment (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`) and default to the sandbox.

## How AI is used

- **E-Cinema AI (agentic commerce), Claude Opus 5.5.** `web/lib/concierge.ts` gives Claude six tools: `list_showtimes`, `my_tickets`, `create_ticket_order`, `release_hold`, `add_to_calendar` and `shop_the_film`. The agent holds seats for 10 minutes and creates a PayPal order. It cannot capture money: the viewer approves in PayPal. A spending limit (`CONCIERGE_LIMIT_USD`, default $25) makes it ask before any larger booking.
- **Claude Sonnet 5.5** writes dub scripts and subtitles (`web/lib/dub-worker.ts`, `workflows/src/subtitles.ts`), translates world chat and messages (`web/lib/room-chat.ts`, `web/lib/chat.ts`), summarises missed scenes for late arrivals (`web/lib/catchup.ts`), reads audience mood in the studio control room (`web/lib/control-ai.ts`), suggests ticket prices per country (`web/lib/price-ai.ts`), answers studio questions from their own numbers (`web/lib/studio-ai.ts`), drafts piracy takedown notices (`web/lib/leak-notice.ts`), and reads student IDs and rights documents.
- **ElevenLabs** `eleven_multilingual_v2` voices the AI dubs (`workflows/src/dubbing.ts`, `workflows/src/elevenlabs.ts`).
- **Sumsub** runs the face liveness and ID checks (`api/internal/identity`).

## Sponsor tools

| Tool | How E-Cinema uses it |
| --- | --- |
| **APIMatic** | The APIMatic PayPal context plugin is installed for our coding agent (`.claude/skills/typescript-*`: client setup, auth, endpoints, models, errors, resilience, testing). All PayPal code was written against it, using the APIMatic-generated `@paypal/paypal-server-sdk`. |
| **AG Grid** | The "PayPal and agents" executive dashboard: revenue by film with PayPal revenue, refund rate, disputes and the studio's 70% payout (`web/components/PaymentsGrid.tsx`). |
| **Bryntum Calendar** | The public release calendar at `/releases` and the week view on `/home` (`web/components/ReleaseCalendar.tsx`, `web/components/ai/WeekCalendar.tsx`). |
| **Channel3** | "Shop the film" in the watch room and through E-Cinema AI (`web/lib/shop.ts`). |
| **Render** | Hosts the web app, the Go API, PostgreSQL and a nightly job, plus **Render Workflows** for AI dubbing, subtitle translation and studio payouts (`render.yaml`, `workflows/`, `ops/render-deploy.mjs`). |

## Architecture

```
Browser (Next.js 16, React 19)
   │  PayPal JS SDK v6 popup        ┌──────────── PayPal (Orders, Subscriptions, Webhooks)
   ▼                                │
web/  Next.js server routes ────────┼──────────── Anthropic API (Claude)
   │  internal token                ├──────────── Channel3, Resend, Cloudflare R2
   ▼                                │
api/  Go API + WebSockets ── PostgreSQL           Sumsub, Termii
   ▲
workflows/  Render Workflows (TypeScript): dubFilm, translateSubtitles, payEndedScreenings
            → Claude, ElevenLabs, R2, PayPal Payouts
```

## Repository layout

| Path | What it holds |
| --- | --- |
| `web/` | Next.js web app and server routes (TypeScript) |
| `api/` | Go API: accounts, tickets, rooms, studios, executive data. SQL migrations in `api/internal/db/migrations` run on start |
| `workflows/` | Render Workflows tasks (TypeScript) |
| `ops/` | Deploy scripts for Render and Cloudflare |
| `design/`, `docs/` | Design tokens, screen specs, product decisions, the PayPal plan (`docs/paypal-plan.md`) |
| `.github/workflows/` | CI, including a real PayPal sandbox order and an end-to-end agent booking on every push |

Every screen was designed in Figma first: https://www.figma.com/design/M2RESyD3zhwTZfV7VXrBW3/E-Cinema

## Run it locally

Requirements: Node 22, Go 1.24, PostgreSQL 16.

```sh
# 1. Database
createdb ecinema

# 2. API (migrations run automatically on start)
cd api
DATABASE_URL=postgres://localhost/ecinema?sslmode=disable \
INTERNAL_API_TOKEN=dev-token \
PORT=8080 go run ./cmd/api

# 3. Web app (in a second terminal)
cd web
npm ci
API_URL=http://localhost:8080 \
INTERNAL_API_TOKEN=dev-token \
PAYPAL_CLIENT_ID=<sandbox client id> \
PAYPAL_CLIENT_SECRET=<sandbox secret> \
ANTHROPIC_API_KEY=<key> \
npm run dev
# open http://localhost:3000

# 4. Workflows (optional: dubbing, subtitles, payouts)
cd workflows
npm ci && npm test
```

Optional keys switch on more features: `CHANNEL3_API_KEY` (Shop the film), `ELEVENLABS_API_KEY` (dubbing), `R2_*` (media storage), `RESEND_API_KEY` (email), `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY` (face check), `PAYSTACK_SECRET_KEY` and `FLUTTERWAVE_SECRET_KEY` (naira payments), `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` (AG Grid Enterprise features). Without a key, that feature shows as unavailable instead of failing.

Production deploys go to Render through `.github/workflows/render-deploy.yml`.

## What's next

- PayPal Vault, so E-Cinema AI can complete small bookings inside a viewer's own spending limit
- PayPal Agent Toolkit and the PayPal MCP server for internal finance agents (payout reconciliation, dispute evidence)
- PayPal Invoicing for merchandise licensees and group bookings, and PayPal Donations for the charity stage of the 18+ unlock
- Live PayPal payments and the first licensed premieres with partner studios
- The Android app (already designed), voice-cloned dubs with lip-sync, more local payment methods

## License

[MIT](LICENSE)
