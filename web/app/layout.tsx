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
import KidsGuard from "@/components/family/KidsGuard";
import TabBar from "@/components/mobile/TabBar";
import { SESSION_COOKIE } from "@/lib/auth";
import { dirOf, isLang } from "@/lib/i18n";
import { LANG_COOKIE } from "@/lib/locale";
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
  const raw = jar.get(LANG_COOKIE)?.value;
  const lang = isLang(raw) ? raw : "en";
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body>
        {children}
        <CookieBanner />
        <ErrorReporter />
        <KidsGuard />
        <TabBar signedIn={Boolean(jar.get(SESSION_COOKIE))} />
      </body>
    </html>
  );
}
