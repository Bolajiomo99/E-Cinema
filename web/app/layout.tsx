import type { Metadata, Viewport } from "next";
import "@bryntum/calendar/fontawesome/css/fontawesome.css";
import "@bryntum/calendar/fontawesome/css/solid.css";
import "@bryntum/calendar/calendar.css";
import "@bryntum/calendar/svalbard-dark.css";
import "./fonts.css";
import "./globals.css";
import { cookies } from "next/headers";
import CookieBanner from "@/components/legal/CookieBanner";
import ErrorReporter from "@/components/ErrorReporter";
import AutoTranslate from "@/components/i18n/AutoTranslate";
import { showtimes } from "@/lib/catalog";

// Film and studio names stay as they are in every language.
const NAMES = () => [...new Set(showtimes.flatMap((s) => [s.film, s.studio]).filter(Boolean))];
import KidsGuard from "@/components/family/KidsGuard";
import TabBar from "@/components/mobile/TabBar";
import { SESSION_COOKIE } from "@/lib/auth";
import { dirOf } from "@/lib/i18n";
import { readLocale } from "@/lib/locale";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "E-Cinema",
  description: "Watch new film releases live, together, anywhere in the world.",
  applicationName: "E-Cinema",
  appleWebApp: { capable: true, title: "E-Cinema", statusBarStyle: "black-translucent" },
  openGraph: { type: "website", siteName: "E-Cinema", title: "E-Cinema · Premieres, together", description: "New films live on opening night, in your language and currency." },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const { lang } = await readLocale();
  return (
    <html lang={lang} dir={dirOf(lang)} suppressHydrationWarning>
      {lang !== "en" && (
        <head>
          {/* Hide the English first paint for a moment while the page switches to the visitor's language. */}
          <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('tr-wait')" }} />
          <noscript><style>{"html.tr-wait body{opacity:1!important}"}</style></noscript>
        </head>
      )}
      <body>
        {children}
        <CookieBanner />
        <ErrorReporter />
        <AutoTranslate lang={lang} keep={lang === "en" ? undefined : NAMES()} />
        <KidsGuard />
        <TabBar signedIn={Boolean(jar.get(SESSION_COOKIE))} />
      </body>
    </html>
  );
}
