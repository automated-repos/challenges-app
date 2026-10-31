import type { NextConfig } from "next";

// على GitHub Pages يكون الموقع تحت /اسم-المستودع، ويُمرر عبر BASE_PATH وقت البناء
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export", // موقع ثابت بالكامل (HTML/JS) يناسب GitHub Pages
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
