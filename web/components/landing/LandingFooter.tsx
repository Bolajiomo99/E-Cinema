import Logo from "@/components/landing/Logo";

// The public footer from the Figma landing frames (Watch, Account, Company, Help).
export const FOOTER: [string, [string, string][]][] = [
  ["Watch", [["Premieres", "/#premieres"], ["Watch parties", "/releases"], ["Request a film", "/concierge"]]],
  ["Account", [["Plans", "/plans"], ["Student offer", "/plans"], ["Gift a seat", "/gift"]]],
  ["Company", [["About", "/terms"], ["Studios and distributors", "mailto:admin@e-cinema.net?subject=Studios"], ["Careers", "mailto:admin@e-cinema.net?subject=Careers"]]],
  ["Help", [["Help centre", "/concierge"], ["Privacy", "/privacy"], ["Terms", "/terms"]]],
];

export default function LandingFooter({ heads }: { heads?: Record<string, string> }) {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-brand">
        <Logo />
        <p>© 2026 Online Cinema Ltd, trading as E-Cinema. Premieres, together.</p>
      </div>
      <div className="lp-footer-cols">
        {FOOTER.map(([head, links]) => (
          <div key={head}>
            <p>{heads?.[head] ?? head}</p>
            {links.map(([t, href]) => <a key={t} href={href}>{t}</a>)}
          </div>
        ))}
      </div>
    </footer>
  );
}
