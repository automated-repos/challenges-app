import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/InstallApp";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "تحدي الأسئلة",
  description: "مسابقة أسئلة عامة جماعية مع الأصدقاء",
  // للتثبيت على آيفون (أيقونة الشاشة الرئيسية وفتح التطبيق بملء الشاشة)
  appleWebApp: { capable: true, title: "تحدي الأسئلة", statusBarStyle: "black-translucent" },
  icons: {
    apple: `${base}/apple-touch-icon.png`,
    // أيقونة التبويب: كأس
    icon: [{ url: `${base}/icon.svg`, type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#1e1b4b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
