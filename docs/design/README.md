# E-Cinema design

Figma file: https://www.figma.com/design/M2RESyD3zhwTZfV7VXrBW3/E-Cinema

## Pages

| Page | What is on it |
| --- | --- |
| 00 Cover | File cover |
| 01 Foundations | Colour, typography, spacing and radius, all backed by Figma variables and text styles |
| 02 Components | Logo, Button, Badge, Chip, Input, Poster, Chat message |
| 03 Web screens | 10 desktop screens at 1440 wide |
| 04 Mobile screens | 6 Android screens at 412 x 915 |
| 05 Flows & notes | Key user flows and open product questions |

## Brand

- **Name and mark.** "E-CINEMA" set in Bebas Neue, brand red, over a curved line that reads as a cinema screen. Only used on dark surfaces.
- **Colour.** Near-black surfaces with one red (`#E3182D`) reserved for the main action, live state and the logo. Key art carries the rest of the colour, the way Netflix does it.
- **Tiers** have their own colours so a badge is recognisable at a glance: Pro red, VIP gold, Enterprise violet, Student teal.
- **Type.** Bebas Neue for titles and big moments, Manrope for everything people read or tap. Bebas has no diacritics or non-Latin glyphs, so any localised title (Yorùbá, Hindi, Arabic, and so on) falls back to Manrope ExtraBold, with Noto Sans for scripts Manrope lacks.

Tokens live in [`design/src/tokens.css`](../../design/src/tokens.css) and mirror the Figma variables one to one.

## Screens

### Web (1440)

| Screen | Figma node | Notes |
| --- | --- | --- |
| Landing | `14:280` | Hero premiere with countdown and seats left, premieres strip, how it works, live dubbing, features, plans, sold-out free seats, local payment methods |
| Sign up · 1 Account | `16:127` | Netflix-style details: name, email, country (detected), mobile, date of birth, app and audio language, password strength, consent |
| Sign up · 2 Verify | `16:259` | Phone OTP, face liveness, government ID (deferred to first 18+ title), passkey. One face and phone per account |
| Sign in | `16:296` | Password, passkey or one-time code; two-device limit is stated up front |
| Home | `17:310` | Live hero with friends in room, starting soon, friends' watch parties, Clips, request a classic |
| Player + watch party | `17:562` | Synced live player, AI dub and subtitles, volume boost to 200%, data saver, forensic watermark, room chat with translation, voice notes, images with snack-critic score, documents, reactions, muted state for Free |
| Plans | `18:426` | Five tiers, monthly or yearly, local currency, VIP group price bands, comparison table |
| Checkout | `18:533` | Payment methods chosen by country, order summary with discounts and tax |
| 18+ unlock | `18:616` | Four stages: prove age, adult PIN, choose and pay, OTP and PIN |
| Insights dashboard | `19:462` | Watch time, genre mix, languages, people by country, AI insights |
| Library | `19:583` | Infuse-style detail header with tech badges, cast and audio tracks; owned, downloads with expiry, requested classics |

### Android (412 x 915)

| Screen | Figma node |
| --- | --- |
| Choose language | `23:34` |
| Home | `23:107` |
| Clips (vertical feed) | `23:227` |
| Player + chat | `23:293` |
| Sign up | `23:364` |
| AI snack critic | `23:443` |

## Placeholders

- Poster art is abstract duotone gradients until licensed key art is available. Swap the Poster instance fill for the real image.
- Prices are placeholders in NGN. See the open questions on the Flows & notes page.
- Film titles, people and cities in the mockups are invented.
