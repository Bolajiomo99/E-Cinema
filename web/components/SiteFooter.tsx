// Legal name decided by the founder on 2026-10-31.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      © {new Date().getFullYear()} Online Cinema Ltd, trading as E-Cinema. RC 9947766. Premieres, together.{" "}
      <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
    </footer>
  );
}
