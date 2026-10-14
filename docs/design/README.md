# E-Cinema design

Figma file: https://www.figma.com/design/M2RESyD3zhwTZfV7VXrBW3/E-Cinema

Every page is designed in Figma before it is built. Anything new gets a Figma frame first, then code.

## Pages

| Page | What is on it |
| --- | --- |
| 00 Cover | File cover |
| 01 Foundations | Colour, typography, spacing and radius, all backed by Figma variables and text styles |
| 02 Components | Logo, Button, Badge, Chip, Input, Poster, Chat message |
| 03 Web screens | 40 desktop frames at 1440 wide |
| 04 Mobile screens | 33 Android frames at 412 x 915, plus landscape player and VR headset view |
| 05 Flows & notes | Key flows, answered questions, AI capability map, real-time architecture, country matrix, page inventory |
| 06 Studio portal | 16 frames for film studios at 1440 wide |
| 07 Executive | 9 frames for the CEO, cabinet, investors and partners, with role-based access |

## Brand

- **Name and mark.** "E-CINEMA" set in Bebas Neue, brand red, over a curved line that reads as a cinema screen. Only used on dark surfaces.
- **Colour.** Near-black surfaces with one red (`#E3182D`) reserved for the main action, live state and the logo. Key art carries the rest of the colour, the way Netflix does it. The studio portal uses VIP gold (`#D4A23A`) as its accent so studios always know which side they are on.
- **Tiers** have their own colours so a badge is recognisable at a glance: Pro red, VIP gold, Enterprise violet, Student teal.
- **Type.** Bebas Neue for titles and big moments, Manrope for everything people read or tap. Bebas has no diacritics or non-Latin glyphs, so any localised title (Yorùbá, Hindi, Arabic, and so on) falls back to Manrope ExtraBold, with Noto Sans for scripts Manrope lacks.

Tokens live in [`design/src/tokens.css`](../../design/src/tokens.css) and mirror the Figma variables one to one.

## Screens

### Web (1440)

| Area | Screen | Figma node |
| --- | --- | --- |
| Join | Landing | `14:280` |
| | Sign up · 1 Account | `16:127` |
| | Sign up · 2 Verify (phone, face, passkey) | `16:259` |
| | Sign up · 3 Plan | `29:417` |
| | Sign up · 4 Pay | `29:521` |
| | Sign in | `16:296` |
| | Forgot password · code | `29:556` |
| Discover | Home | `17:310` |
| | Browse by type (movies, anime, cartoons, K-drama, Nollywood, Bollywood, series, documentaries) | `30:564` |
| | Search (AI and voice) | `30:750` |
| | Film detail · premiere page | `30:904` |
| | World map · live | `32:1201` |
| Watch | Room lobby · pre-show | `30:989` |
| | Create watch party | `31:934` |
| | Player + watch party (free talk-time trial) | `17:562` |
| | Player · free talk time used | `28:565` |
| Pay | Plans · Nigeria (NGN) | `18:426` |
| | Plans · Germany (EUR, Deutsch) | `28:304` |
| | Checkout | `18:533` |
| | Payment success · ticket | `29:590` |
| | 18+ unlock · four payments | `28:839` |
| | Sold out · free-seat lottery | `31:1121` |
| | Request a classic | `31:1055` |
| Mine | My tickets | `31:605` |
| | Library | `19:583` |
| | Downloads | `31:743` |
| | Insights dashboard | `19:462` |
| | Notifications | `31:878` |
| Social | Messages | `32:798` |
| | Community feed | `32:951` |
| | Profile | `32:1060` |
| Account | Settings · Security and devices | `33:781` |
| | Settings · Language and region | `33:901` |
| | Help and AI concierge | `33:987` |
| | System states (capture blocked, offline, not in your country, premiere ended, too many devices, 404) | `33:1044` |
| Coming soon | Coming soon (pre-sales) | `52:808` |
| | Pre-order · quality and VR options, 3 price stages | `52:958` |
| | VR and AR cinema mode | `52:1122` |
| Shop | Shop (branded merch, gear, snacks) | `53:925` |
| | Cart and checkout (local methods, PayPal, pay on delivery) | `53:1111` |

### Android (412 x 915)

| Screen | Figma node |
| --- | --- |
| Choose language | `23:34` |
| Sign up | `23:364` |
| Verify phone and face | `40:141` |
| Sign in | `40:164` |
| Home | `23:107` |
| Browse by type | `40:254` |
| Voice search | `40:320` |
| Clips (vertical feed) | `23:227` |
| Film detail | `40:370` |
| Watch party lobby | `40:443` |
| Player + chat | `23:293` |
| Player · talk time ending | `43:1590` |
| Player · landscape (915 x 412) | `43:1648` |
| Plans · local currency | `42:212` |
| Checkout | `42:274` |
| 18+ unlock · four payments | `42:333` |
| Seat booked | `42:373` |
| My tickets | `42:432` |
| Library and downloads | `42:533` |
| Messages | `43:301` |
| Chat (translated, voice notes, images) | `43:393` |
| Profile | `43:460` |
| Notifications | `43:540` |
| World map (globe) | `43:1321` |
| My insights | `43:1405` |
| Settings | `43:1502` |
| AI concierge (voice) | `43:1540` |
| AI snack critic | `23:443` |
| Coming soon | `55:307` |
| Pre-order | `55:385` |
| Shop | `55:478` |
| Cart and checkout | `55:567` |
| VR headset view (stereo, 915 x 412) | `55:634` |

### Studio portal (1440)

Studios license and upload their own films. E-Cinema keeps 30% of net ticket revenue and the studio keeps 70%. The mockups use an invented studio, Starlight Pictures of Lagos, and invented films.

| Screen | Figma node |
| --- | --- |
| Onboarding · verify studio and rights | `34:49` |
| Overview | `34:274` |
| Films | `34:458` |
| Upload · film file (with AI quality checks) | `35:290` |
| Premieres and pricing (per country, global or rolling start) | `35:514` |
| AI dubbing studio (voice, lip-sync, line review) | `35:871` |
| Live control room (viewers map, sync, CDN, mood, moderation) | `37:1272` |
| Analytics · audience and retention | `37:1652` |
| Analytics · reach, languages and money (funnel, cohorts) | `37:2861` |
| Revenue and payouts (70/30 split) | `39:349` |
| Piracy protection | `39:578` |
| Marketing and clip generator | `39:779` |
| Team and roles | `39:980` |
| Settings, webhooks and API | `39:1184` |
| Studio AI assistant | `39:1345` |
| Post a coming-soon film | `53:1512` |

### Executive (1440)

Access is granted only by the CEO. Invited people sign in with a passkey and see their role's data at once, with no sign-up. Pages marked CEO only are never shown to other roles.

| Screen | Who sees it | Figma node |
| --- | --- | --- |
| CEO command center | CEO only | `49:1055` |
| Access and roles | CEO only | `49:1307` |
| 18+ recipients (charities, pastors, clerics) | CEO only | `49:1577` |
| Money | CEO, cabinet (CFO) | `50:253` |
| Infrastructure · 5 backups, 10M scale | CEO, cabinet (CTO) | `50:469` |
| Investor view | CEO, investors | `50:609` |
| Partners view | CEO, each partner for their own deal | `51:198` |
| Notifications and re-engagement | CEO, cabinet | `51:375` |
| Shop and merch | CEO, cabinet | `51:657` |

### Flows & notes

| Frame | Figma node |
| --- | --- |
| Key flows and answered questions | `23:775` |
| AI capability map | `45:142` |
| Real-time and no-buffer architecture | `45:249` |
| Country, currency and payments | `45:357` |
| Page inventory and decisions | `45:417` |

## Placeholders

- Poster art is abstract duotone gradients until licensed key art is available. Swap the Poster instance fill for the real image.
- Prices are placeholders and follow the viewer's country. See the country matrix on the Flows & notes page.
- Film titles, studios, people and cities in the mockups are invented.
