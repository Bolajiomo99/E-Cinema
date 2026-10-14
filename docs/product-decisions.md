# Product decisions

Decisions from Bolaji, 14 October 2026. Prices are placeholders and can change.

| Topic | Decision |
| --- | --- |
| Country and currency | Every price, payment method, language default, premiere time and tax follows the viewer's verified country. A viewer in Europe never sees or pays naira. |
| Free members in rooms | Can talk (voice and text) for 3 minutes per room, then are muted until they upgrade. They can still read and react. |
| 18+ unlock | Four separate payments, one per stage: charity, church pastor, Islamic cleric, and access. Each is 10% above the Pro plan price in local currency. ID and face check come first. |
| Languages | AI detects language automatically everywhere: sign-up, search, chat, voice and audio tracks. |
| AI | AI does far more than dubbing. See the AI capability map on the Figma Flows & notes page. |
| "Earth global" | Worldwide access plus an Earth-style live map of rooms and viewers. |
| Hermes | An AI builder, kept as an option for internal tools. |
| Studios | Self-serve Studio portal. Studios license their own films, upload, set prices, approve AI dubs. E-Cinema keeps 30%, the studio 70%. |
| Catalogue | All film types: movies, anime, cartoons, K-drama, Nollywood, Bollywood, series, documentaries. New releases only; each disappears after screening. |
| Real time | WebSockets for live features, webhooks between servers, and no buffering. |
| 18+ recipients | Viewers choose a charity, pastor and cleric from a list. Only the CEO can add, pause or remove recipients. |
| Executive dashboards | CEO, cabinet, investors, stakeholders and partners each get their own view. Only the CEO grants access; invited people need no sign-up. Some pages are CEO only. |
| Coming soon | Studios post films weeks, months or years ahead. Viewers pre-order cheaper, in three price stages, in 1080p, 4K or a VR cinema seat. |
| VR and AR | VR cinema halls with friends as avatars and spatial audio; AR puts the screen on your wall. |
| Shop | Every member can buy branded E-Cinema merch, gear (including an E-Cinema VR headset), snacks and water, with a cart and every local payment method plus PayPal. |
| Reliability | Never crash: active-active regions, five copies of all data (live, hot standby, 5-minute backups, a second cloud, an offline vault), built and load-tested for 10 million people online at once. |
| Engagement | Everyone is notified of updates, premieres and coming-soon films; responses feed the ranking algorithm. |
| Self-serve admin | The CEO and cabinet can add and edit shop products and create new rooms and VR halls from their dashboard, without a developer. Every change is logged with who made it. |
| Family | One plan holds up to 6 profiles. Kids profiles see age-rated films only, with no voice chat and no purchases without a parent. |
| Careers | A public jobs board anyone in any country can apply to. 40% of roles are kept for Nigeria and 60% are open worldwide; the CEO can change the split. |
| Community rewards | Members are rewarded (cash or Pro months) for reporting anyone selling E-Cinema-branded goods without a licence. Paid only after an investigator confirms; reporters stay anonymous; repeated false reports lose the right to report. |
| Merch licensing | Companies pay for a licence to sell E-Cinema-branded merch in a country (Starter, Growth or Global plans plus a royalty on sales). Each licensee gets its own portal with sales analytics, product approvals, royalties and compliance. Every licensed item carries a QR authenticity label that anyone can check at ecinema.app/verify. |
| Late entry | After a film starts, people can still buy a seat and join live. The first 15 minutes are normal price; after that a late-entry seat costs double. Doors close 30 minutes before the end. Late joiners get a 60-second, spoiler-free AI catch-up. The studio keeps 70% of late seats too. |
| Lobby quiz | The pre-show quiz in a room lobby is for people who already hold a seat for that screening. Getting all 5 questions right wins a free seat for any premiere in the next 30 days. |
| Web menu | One menu on every signed-in web page: Home, Coming soon, Live, Community, Clips, Shop, Library, then search, notifications, cart and profile. Browse and search sit under Home; messages and profiles sit under Community. |
| CEO overview | The CEO dashboard has a global overview of everything: revenue by stream, live world map, money mix, system health, hiring, brand protection, licensing and security operations. |
| Process | Every page is designed in Figma before code. Any new idea is added to Figma first. |

## Still open

- Launch prices per country.
- First studio partners and film rights.
- Who gets the 1,000 free seats on a sell-out (designed as a lottery among the waitlist).
- Domain name.
