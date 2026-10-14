# E-Cinema

Watch new-release films together, worldwide, the day they premiere, in your own language.

E-Cinema is a web app and Android app for live, synchronized screenings of newly released films. Audiences in any country join the same showing, chat across borders (text, voice notes, images, documents, emoji), and hear the film dubbed or subtitled in their language.

## Repository layout

| Path | What it holds |
| --- | --- |
| `design/src/tokens.css` | Design tokens (colors, type, spacing, radius) mirrored from Figma |
| `design/src/screens/` | Screen specs as HTML, imported into Figma |
| `design/tools/build.py` | Inlines tokens into each screen for Figma import or browser preview |
| `docs/design/` | Design system and screen index |
| `docs/tech-stack.md` | Tool and stack proposal |

## Design

Figma: https://www.figma.com/design/M2RESyD3zhwTZfV7VXrBW3/E-Cinema

Preview the screens locally:

```sh
python3 design/tools/build.py
open design/dist/web-landing.html
```
