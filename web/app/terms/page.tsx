import SiteFooter from "@/components/SiteFooter";

export const metadata = { title: "Terms of Service · E-Cinema" };

export default function TermsPage() {
  return (
    <article className="legal">
      <p className="eyebrow">Legal</p>
      <h1>Terms of Service</h1>
      <p className="muted">Last updated 31 October 2026</p>

      <p>
        These terms are an agreement between you and Online Cinema Ltd (RC 9947766), trading as E-Cinema. By creating an
        account or buying a ticket you agree to them. Please also read our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>One account per person. Each face and phone number can hold one E-Cinema account.</li>
        <li>Keep your sign-in details to yourself. Don&apos;t share or sell your account.</li>
        <li>An account can be signed in on up to two devices. Signing in on another device signs out the oldest one.</li>
        <li>You must give true information, including during identity checks.</li>
      </ul>

      <h2>Tickets and screenings</h2>
      <ul>
        <li>A ticket lets the account that bought it watch that screening at its scheduled time.</li>
        <li>Joining in the first 15 minutes after the start costs the normal price. Joining later costs double. Doors close 30 minutes before the end.</li>
        <li>If we or the studio cancel a screening, you get a full refund to your original payment method. Other refund requests are reviewed case by case; write to admin@e-cinema.net.</li>
        <li>Prices are shown in your local currency where available and include any taxes we must collect.</li>
      </ul>

      <h2>Respect the films</h2>
      <p>
        Films belong to their studios. You may not record, screenshot, download, re-stream or share any film or part of
        one, or try to get around our protections. Doing so can end your account without refund and may be reported to
        the rights holder and the authorities.
      </p>

      <h2>Community</h2>
      <p>
        Be kind in watch parties and chats. No harassment, hate, spam, scams or illegal content. We may mute, suspend or
        close accounts that break these rules.
      </p>

      <h2>AI features</h2>
      <p>
        Some features, such as the assistant, subtitles and dubbed audio, are made with AI. They can make mistakes; check
        important details like times and prices before you rely on them.
      </p>

      <h2>Our responsibility</h2>
      <p>
        We work hard to keep screenings smooth, but the service is provided as it is and we can&apos;t promise it will
        never be interrupted. Nothing in these terms limits rights you have under consumer protection law, including the
        Federal Competition and Consumer Protection Act 2018.
      </p>

      <h2>Changes and ending</h2>
      <p>
        We may update these terms and will tell you before important changes take effect. You can close your account at
        any time by writing to us.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>

      <h2>Contact</h2>
      <p>Online Cinema Ltd, trading as E-Cinema · <a href="mailto:admin@e-cinema.net">admin@e-cinema.net</a></p>
      <SiteFooter />
    </article>
  );
}
