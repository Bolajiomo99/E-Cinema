import type { MetadataRoute } from "next";

// Lets phones add E-Cinema to the home screen as an app (Android "Install app", iPhone "Add to Home Screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "E-Cinema",
    short_name: "E-Cinema",
    description: "Watch new film releases live, together, anywhere in the world.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["entertainment", "movies"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Premieres", url: "/browse" },
      { name: "My tickets", url: "/tickets" },
      { name: "Watch parties", url: "/parties" },
    ],
  };
}
