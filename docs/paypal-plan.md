# PayPal in E-Cinema

Which PayPal products E-Cinema uses, where, and the docs to build from.

| PayPal product | Where E-Cinema uses it | Docs |
| --- | --- | --- |
| Checkout + JavaScript SDK v6 | Tickets, pre-sale seats, late-entry seats, plan upgrades, merch cart | https://developer.paypal.com/checkout/ , https://developer.paypal.com/sdk/js/ |
| Orders API (REST) | Server-side create and capture for every purchase, including concierge bookings | https://developer.paypal.com/api/rest/ |
| Pay Later | Offered on pre-orders, VR seats and large merch orders where available | https://developer.paypal.com/pay-later/overview |
| Vault (saved PayPal) | One-tap repeat purchases and concierge bookings within a viewer's spending cap | https://developer.paypal.com/payments/ |
| Subscriptions | Pro and Family plans | https://developer.paypal.com/platforms/subscriptions |
| Donations | The charity stage of the 18+ unlock | https://developer.paypal.com/sdk/donate/ |
| Payouts | Studio 70% share, pastors and clerics in the 18+ flow, community reward payouts | https://developer.paypal.com/docs/payouts/ |
| Invoicing | Merch licensee plan fees and royalties; corporate and group bookings | https://developer.paypal.com/invoicing/about |
| Disputes | Dispute queue with deadlines in the studio and CEO dashboards | https://developer.paypal.com/platforms/disputes/overview |
| Webhooks | Payment, refund, dispute, subscription and payout events drive seats, dashboards and the concierge | https://developer.paypal.com/api/webhooks/overview |

## AI and agents

- **E-Cinema Concierge:** a Claude agent that finds films and showtimes and books them. It uses the PayPal Agent Toolkit for orders, refunds, subscriptions and invoices, with the viewer approving each payment.
- **PayPal MCP server:** used by internal agents (CEO analytics, payment watch) to read transactions and disputes.
- **APIMatic PayPal context skills:** in `.claude/skills`, used while writing the PayPal code.

Docs: https://github.com/paypal/AI-Toolkit , https://docs.paypal.ai/ , https://docs.paypal.ai/developer/tools/ai/agent-toolkit-quickstart , https://docs.paypal.ai/developer/tools/ai/mcp-quickstart , https://docs.paypal.ai/developer/tools/ai/agent-tools-ref

## Getting started

- Developer dashboard (sandbox accounts and apps): https://developer.paypal.com/dashboard/
- Sandbox guide: https://github.com/paypaldev/getting-started-with-paypal-sandbox
- Credentials are in GitHub secrets `PAYPAL_CLIENT_ID_SANDBOX`, `PAYPAL_CLIENT_SECRET_SANDBOX`, `PAYPAL_CLIENT_ID_LIVE`, `PAYPAL_CLIENT_SECRET_LIVE`. Build and test against sandbox only until launch.

## Built so far (2026-10-31)

| Piece | Where | Status |
| --- | --- | --- |
| Server PayPal client (sandbox by default) | `web/lib/paypal.ts` | Done |
| Create and capture order routes, prices from the server catalog | `web/app/api/paypal/` | Done |
| Checkout page with the PayPal JS SDK v6 button | `web/app/checkout/page.tsx` | Done |
| E-Cinema Concierge (Claude plans, prepares a PayPal order; the viewer approves) | `web/lib/concierge.ts`, `web/app/concierge/page.tsx` | Done |
| CI proof against the PayPal sandbox and Claude | `.github/workflows/secrets-check.yml` (`paypal-checkout` job) | Runs on every push |

Next: webhooks (payment captured, refunds, disputes), Vault spending cap so the concierge can pay small amounts on its own, Subscriptions for plans, Payouts to studios.
