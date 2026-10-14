# E-Cinema emails

Every automatic email is designed on page **08 Emails** of the Figma file before it is built. Emails are sent through [Resend](https://resend.com) from the `ecinema.app` domain (domain still to be bought). The API key goes in the GitHub secret `RESEND_API_KEY` and is never committed.

## Rules

- Body is white for email-client safety; the header is near-black with the E-Cinema logo. One red button per email.
- Every email names the device, place and time when it is about security.
- No email ever asks for a password, code or card number. The footer says so.
- Service emails (security, payments, orders) cannot be switched off. News emails carry an unsubscribe link and respect the viewer's notification settings and quiet hours.
- Emails are sent in the viewer's chosen language.

## Senders

Set these up in Resend once the domain exists, with SPF, DKIM and DMARC records.

| Address | Used for |
| --- | --- |
| `hello@ecinema.app` | Welcome and news |
| `security@ecinema.app` | Codes, password and sign-in alerts, account deletion |
| `privacy@ecinema.app` | Data downloads |
| `tickets@ecinema.app` | Tickets, reminders, pre-orders |
| `billing@ecinema.app` | Receipts, failed payments, refunds |
| `orders@ecinema.app` | Shop orders |
| `gifts@ecinema.app` | Gifts |
| `family@ecinema.app` | Kids approvals |
| `exec@ecinema.app` | Executive invites |
| `studios@ecinema.app`, `payouts@ecinema.app` | Studio approvals and payouts |

## Emails

| # | Email | Sent when | Figma node |
| --- | --- | --- | --- |
| 01 | Welcome | Right after sign-up is finished (the first email every member gets) | `106:39` |
| 02 | Confirm your email | During sign-up, and when the email is changed | `106:60` |
| 03 | Password reset code | Someone asks to reset the password | `106:84` |
| 04 | Password changed | The password is changed | `106:117` |
| 05 | New sign-in | The account signs in on a new device | `106:149` |
| 06 | Account deletion scheduled | The member asks to delete the account | `106:181` |
| 07 | Your data is ready | A data download is ready | `106:202` |
| 08 | Ticket confirmed | A premiere ticket is paid | `106:242` |
| 09 | Premiere starts in 1 hour | One hour before a booked premiere | `106:264` |
| 10 | Pre-order confirmed | A coming-soon film is pre-ordered | `106:297` |
| 11 | Payment receipt | A plan renews or any payment succeeds | `106:332` |
| 12 | Payment failed | A renewal or payment fails | `106:353` |
| 13 | Refund processed | A refund is sent | `106:384` |
| 14 | Order shipped | A shop order leaves the warehouse | `106:416` |
| 15 | Order delivered | A shop order is delivered | `106:438` |
| 16 | Gift received | Someone sends the member a gift | `106:468` |
| 17 | Kids purchase needs approval | A kids profile asks to buy something | `106:499` |
| 18 | Executive invite | The CEO grants someone access | `106:531` |
| 19 | Studio approved | A studio's rights papers are verified | `106:564` |
| 20 | Studio payout sent | The monthly studio payout is sent | `106:599` |
| 21 | New this week | Weekly, if the member allowed news | `106:635` |
| 22 | We miss you | After 30 days without watching, if allowed | `106:657` |
