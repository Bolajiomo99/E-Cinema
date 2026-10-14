"""Inline design/src/tokens.css into each screen so it can be imported
into Figma (html_to_figma) or opened directly in a browser.

Usage: python3 design/tools/build.py
Output: design/dist/<screen>.html
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DIST = ROOT / "dist"
LINK = '<link rel="stylesheet" href="../tokens.css">'


def main() -> None:
    tokens = (SRC / "tokens.css").read_text()
    DIST.mkdir(exist_ok=True)
    for screen in sorted((SRC / "screens").glob("*.html")):
        html = screen.read_text().replace(LINK, f"<style>\n{tokens}\n</style>")
        (DIST / screen.name).write_text(html)
        print(f"built {screen.name}")


if __name__ == "__main__":
    main()
