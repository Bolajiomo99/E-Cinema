import Logo from "@/components/landing/Logo";
import { supportEmail } from "@/lib/platform";

// The public footer from the Figma landing frames (Watch, Account, Company, Help).
export const FOOTER: [string, [string, string][]][] = [
  ["Watch", [["Premieres", "/#premieres"], ["Watch parties", "/releases"], ["Request a film", "/concierge"]]],
  ["Account", [["Plans", "/plans"], ["Student offer", "/student"], ["Gift a seat", "/gift"]]],
  ["Company", [["About", "/about"], ["Studios and distributors", "/for-studios"], ["Careers", "/careers"], ["For business", "/business"]]],
  ["Help", [["Help centre", "/help"], ["Verify a product", "/verify"], ["Privacy", "/privacy"], ["Terms", "/terms"]]],
];

export default function LandingFooter({ heads }: { heads?: Record<string, string> }) {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-brand">
        <Logo />
        <p>© 2026 Online Cinema Ltd, trading as E-Cinema. RC 9947766. Premieres, together. Help: <a href={`mailto:${supportEmail()}`}>{supportEmail()}</a></p>
        <address className="lp-footer-addr">336 Borno Way, Yaba, Lagos 101212, Nigeria</address>
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
