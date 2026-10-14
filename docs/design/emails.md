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
| `careers@ecinema.app` | Job applications |
| `rewards@ecinema.app` | Brand protection rewards |
| `licensing@ecinema.app` | Merch licences |

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
| 23 | Job application received | Someone applies for a job | `118:2895` |
| 24 | Report reward paid | An investigator confirms a fake-seller report | `118:2917` |
| 25 | Licence approved | A merch licence application is approved | `118:2939` |
| 26 | Late-entry ticket | Someone buys a seat after a film has started | `118:2961` |
| 27 | Premiere started, not joined yet | A ticket holder has not joined 5 minutes after the start | `127:83` |
| 28 | Ticket opened on another device | A ticket is played on a second device and blocked | `127:105` |
| 29 | Premiere moved to a new date | A studio changes a premiere date | `127:127` |
| 30 | Premiere cancelled, refund sent | A studio cancels a premiere | `127:149` |
| 31 | Stream problem, credit added | A playback outage hits viewers during a premiere | `127:171` |
| 32 | Pre-order, one week to go | 7 days before a pre-ordered premiere | `127:193` |
| 33 | Account locked for safety | Repeated failed face checks | `127:215` |
| 34 | Account restored | The member signs in before the deletion date | `127:237` |
| 35 | Report received | Someone reports a fake seller | `127:259` |
| 36 | Report not confirmed | An investigator closes a report with no reward | `127:281` |
| 37 | Licence application received | A company applies for a merch licence | `127:303` |
| 38 | Licence needs changes | A licence review needs more documents | `127:325` |
| 39 | Product design approved | A licensee's product design is approved | `127:347` |
| 40 | Product design rejected | A licensee's product design is rejected | `127:369` |
| 41 | Monthly royalty statement | First day of each month, for each licensee | `127:391` |
| 42 | Licence renewal due | 30 days before a licence ends | `127:413` |
| 43 | Compliance warning | An investigator finds a licence breach | `127:435` |
| 44 | Studio film needs changes | A studio's film fails quality or rating checks | `127:457` |
| 45 | Executive invite expiring | 24 hours before an executive invite expires | `127:479` |
| 46 | Gift not claimed yet | 3 days after a gift is sent and not claimed | `127:501` |
| 47 | Kids purchase approved | A parent approves a kids purchase | `127:523` |
| 48 | Plan renews in 3 days | 3 days before a plan renews | `127:545` |
