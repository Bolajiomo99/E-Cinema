# E-Cinema tool and stack list

Status: proposal for review. Nothing here is provisioned yet.

## The short answer

| Tool you listed | Use it? | Where |
| --- | --- | --- |
| **Go** | **Yes, core backend** | Watch-party sync, chat gateway, seat inventory and ticketing, payments orchestration, API gateway |
| Python | Yes | AI and ML: dubbing pipeline, recommendations, snack critic, analytics jobs |
| TypeScript | Yes | Web app (Next.js), shared API types, n8n custom nodes |
| JavaScript | Yes, via TypeScript | Everything JS is written as TypeScript |
| Node.js | Yes, limited | Runs the Next.js server and n8n. No business logic services in Node |
| React | Yes | Web UI |
| Next.js | Yes | Web app: server rendering for SEO on premiere pages, edge middleware for country and language |
| HTML5 / CSS3 | Yes | Through Next.js; design tokens as CSS variables |
| Java | Partly | Android is written in **Kotlin**, which is Java-compatible and is Google's default for Android. Java libraries work as-is |
| Rust | Later, narrow | Only for hot paths if Go profiling shows a need: forensic watermark embedding, media relay. Not in v1 |
| Django | Yes, back office only | Admin for content ops, studios, moderation and finance, using Django admin |
| PHP | **No** | Nothing needs it, and it would be a fourth backend language to hire for and secure |
| AngularJS | **No** | AngularJS reached end of life in January 2022 and gets no security fixes. React and Next.js cover the web |
| LLM | Yes | Voice concierge, chat translation, AI insights, moderation |
| Machine learning | Yes | Speech recognition, translation, speech synthesis, recommendations, vision |
| n8n | Yes, internal | Ops automations: content intake, alerts, CRM, marketing. Never in the watch or payment path |
| Docker | Yes | Every service ships as a container |
| MongoDB | Yes | Chat messages and activity feeds |
| Supabase | Yes, early stage | Managed Postgres and storage while we are small; Postgres moves to Azure as we scale |
| Railway / Render | Yes, early stage | Preview and staging environments for services |
| Vercel | Yes | Hosts the Next.js web app |
| Cloudflare | Yes | DNS, CDN, DDoS protection, WAF, bot protection (Turnstile), R2 storage |
| Microsoft Azure | Yes, main cloud | Kubernetes (AKS) for Go and Python services, GPUs for AI, Speech and Translator APIs |
| name.com | Yes | Domain registrar; DNS points to Cloudflare |
| Hermes | Need to confirm | See questions below |
| "Earth global" | Need to confirm | See questions below |

## Why Go is the backbone

The hard problems in E-Cinema are concurrency problems: tens of thousands of people in one premiere, every player within a fraction of a second of the same frame, chat fanning out to all of them, and a seat counter that must never oversell during a sell-out rush. Go is built for exactly this: cheap goroutines for hundreds of thousands of open WebSocket connections per node, a small memory footprint, fast startup for autoscaling, and one static binary per service in a tiny container. It is also easy to hire for in Lagos, Bangalore and everywhere else we want engineers.

Go services in v1:

| Service | Job |
| --- | --- |
| `gateway` | Public API, auth checks, rate limits, country and language resolution |
| `sync` | Keeps every player in a premiere on the same timestamp; clock offset per client, drift correction |
| `rooms` | Watch parties, presence, mute rules by plan, invites |
| `chat` | WebSocket fan-out, translation hand-off, voice notes, attachments, moderation hooks |
| `tickets` | Seat inventory, holds, sell-out detection, the 1,000 free seats lottery |
| `payments` | Routes each country to its providers, reconciles, keeps the ledger |
| `entitlements` | Who may watch or download what, adult unlock state, device limits |

## Architecture at a glance

```
Android (Kotlin)      Web (Next.js on Vercel)
        \               /
         Cloudflare (DNS, CDN, WAF, Turnstile)
                 |
        Go gateway on Azure AKS
   /      |       |        |         \
 sync   rooms   chat    tickets   payments ── Paystack, Flutterwave, Stripe, Razorpay, crypto
   \      |       |        |         /
  NATS JetStream (events)   Redis (presence, seat counters, rate limits)
          |                         |
  Postgres (accounts, tickets,   MongoDB (chat, feeds)
  ledger, pgvector)              ClickHouse (analytics events)
          |
  Python AI services (FastAPI, GPUs): ASR, translation, TTS dubbing,
  recommendations, snack critic, insights
          |
  Media: encoder farm → CMAF HLS/DASH → multi-DRM → Cloudflare and Azure CDN
```

## Streaming and content protection

- **"Live" premieres** are pre-recorded films played on a shared clock: low-latency CMAF HLS and DASH, with the `sync` service telling each player where it should be. Viewers cannot skip ahead.
- **Multi-DRM** (Widevine, PlayReady, FairPlay) through a vendor such as Axinom, EZDRM or BuyDRM. Without DRM, no studio will license a new release to us.
- **Screenshots and recording.** On Android, `FLAG_SECURE` blocks screenshots and screen recording, and Widevine L1 keeps the video path in secure hardware. On the web, DRM-protected video shows black in most screen captures, but a browser cannot block screenshots of the page itself. Nobody can stop someone filming the screen with another phone, so we add **forensic watermarking** (an invisible per-viewer mark, from NAGRA NexGuard or Irdeto) to trace leaks back to the account.
- **Downloads** are encrypted, licensed to one device, play only inside E-Cinema and expire.
- **Volume past 100%** uses a Web Audio gain node with a limiter on web and Media3 audio processors on Android, so boosted audio does not clip.

## Low data use

- AV1 where the device supports it, HEVC and H.264 fallbacks, per-title encoding so simple scenes use fewer bits.
- A ladder that starts at 240p, plus an audio-first mode for very weak networks (about 150 MB per film).
- Dub tracks delivered as separate audio, so switching language does not re-download video.
- Images as AVIF/WebP through Cloudflare, Brotli for text, and offline caching in the Android app.
- A data-saver toggle that caps quality and turns off autoplay of Clips.

## AI and machine learning

| Feature | Approach |
| --- | --- |
| Live dubbing and subtitles | Speech recognition, translation, then speech synthesis per language. Subtitles are generated ahead of the premiere and checked by a human. Dubs need the studio's written approval |
| African and Indian languages | Open speech models with Yorùbá, Hausa, Igbo, Hindi and Tamil support (for example Meta's MMS and Seamless families), fine-tuned on licensed data, alongside Azure Speech and Translator where quality is better |
| Voice concierge | An LLM (Claude) with speech in and out, so people can ask in their own language for a premiere, a ticket or help |
| Chat translation | Fast LLM or MT model per message, cached per language |
| Snack critic | Vision model rates the photo and suggests pairings and films |
| Recommendations | Embeddings of films, users and languages in pgvector, ranked by our own algorithm (below) |
| Insights dashboard | Nightly and per-screening jobs in Python write aggregates; an LLM writes the plain-language insights |
| Moderation | Text, image and voice-note checks before fan-out to large rooms |

## Our own algorithm

Two feeds, because the catalogue is unusual: only new releases, and each one disappears after it screens.

1. **Premiere ranking** for Home. Score each upcoming premiere by: time left before it starts, how many friends hold seats, match between the film's languages and the user's, taste similarity from embeddings, and seat scarcity. Urgency and social pull matter more than in a normal catalogue.
2. **Clips feed** for the vertical feed. Rank by completion rate, rewatches, shares, and clicks to "Get seat", with a small share of exploration (a multi-armed bandit) so new creators and films get tested.

Data structures that keep it fast at scale:

- Seat inventory as sharded counters in Redis with atomic scripts, so a sell-out rush never oversells.
- Consistent hashing to pin each room to a chat node, with a fan-out tree for very large rooms.
- HyperLogLog for unique viewers, top-K heaps for trending, Bloom filters to spot duplicate phone or device fingerprints before a full lookup.

## Security and one account per person

- Phone OTP, face liveness and duplicate-face matching at sign-up (Smile ID covers Nigeria and most of Africa), government ID before the first 18+ title.
- Passkeys (WebAuthn) as the main sign-in, with a two-device limit enforced by `entitlements`.
- Card data never touches our servers: hosted fields from each payment provider.
- Encryption in transit and at rest, secrets in Azure Key Vault, least-privilege access, audit logs.
- Compliance work: Nigeria's NDPA, GDPR for Europe, India's DPDP Act, PCI DSS (kept small through hosted fields).
- Microphone access only while a voice note is being recorded; no background audio capture.

## Payments by country

| Region | Providers |
| --- | --- |
| Nigeria and much of Africa | Paystack, Flutterwave (cards, bank transfer, USSD, mobile money) |
| Kenya and East Africa | Flutterwave (M-Pesa) |
| India | Razorpay (UPI, cards) |
| Rest of world | Stripe (cards, Apple Pay, Google Pay) |
| Crypto | Coinbase Commerce or BitPay for BTC, ETH and USDC |

The `payments` service picks providers by the user's verified country and keeps one internal ledger.

## Mobile

- **Android:** Kotlin, Jetpack Compose, Media3 (ExoPlayer) with Widevine, `FLAG_SECURE` on all video screens.
- **iOS:** not in your brief, so not planned. If you want it later, it is Swift with AVPlayer and FairPlay.

## Supporting tools

GitHub Actions (CI/CD), Terraform (infrastructure), OpenTelemetry with Grafana (monitoring), Sentry (crashes), Meilisearch (search), Figma (design).

## What we need from you

Accounts to create, in the order we will need them:

1. Domain at name.com (which name do you want, e.g. `ecinema.app`?).
2. Cloudflare, Vercel, Supabase and MongoDB Atlas (free tiers are enough to start).
3. Microsoft Azure subscription (startup credits are worth applying for).
4. Paystack and Flutterwave business accounts (need a registered company), then Stripe and Razorpay.
5. Google Play Console developer account.
6. Anthropic API key for the LLM features.
7. Later, with a budget: a multi-DRM vendor, a forensic watermarking vendor, and Smile ID for identity checks.

And the biggest one: **film rights.** Studios or distributors must license each new release for online premieres and approve AI dubs. Who are the first partners?

## Questions

1. **Hermes**: do you mean the Hermes JavaScript engine (used by React Native), the Hermes open LLMs from Nous Research, or something else? We are building Android natively in Kotlin, so the JavaScript engine would not be needed.
2. **"Earth global"**: is this a product or service you have in mind (for example Google Earth Engine), or do you mean a global edge/CDN setup? Cloudflare already gives us global edge coverage.
