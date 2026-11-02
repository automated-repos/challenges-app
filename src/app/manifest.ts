import type { MetadataRoute } from "next";

// على GitHub Pages يكون الموقع تحت /اسم-المستودع، فنضيفه لكل الروابط
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "تحدي الأسئلة",
    short_name: "تحدي الأسئلة",
    description: "مسابقة أسئلة عامة جماعية مع الأصدقاء",
    lang: "ar",
    dir: "rtl",
    id: `${base}/`,
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0a2e",
    theme_color: "#1e1b4b",
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
