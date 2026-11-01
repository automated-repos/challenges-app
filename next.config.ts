import type { NextConfig } from "next";

// على GitHub Pages يكون الموقع تحت /اسم-المستودع، ويُمرر عبر BASE_PATH وقت البناء
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export", // موقع ثابت بالكامل (HTML/JS) يناسب GitHub Pages
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath }, // لبناء روابط الغرف الكاملة
  trailingSlash: true,
  images: { unoptimized: true },
  // تشغيل Tailwind على ملفات CSS
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
