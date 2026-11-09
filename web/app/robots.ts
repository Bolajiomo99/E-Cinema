import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Search engines may read the public pages; accounts, portals and APIs stay out of their index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account/", "/executive", "/studio/", "/studio", "/partner", "/licensing/desk", "/shop/ops", "/careers/desk",
        "/rewards/desk", "/invite/", "/room/", "/settings", "/messages", "/notifications", "/tickets", "/library", "/downloads",
        "/receipts/", "/checkout", "/unlock/", "/unlock-account", "/forgot", "/p/", "/rewatch/", "/gift/redeem/"],
    }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
