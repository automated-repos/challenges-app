"use client";

import { useEffect, useState } from "react";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** يسجّل عامل الخدمة (مرة واحدة في التخطيط العام) */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {});
    }
  }, []);
  return null;
}

/** زر "ثبّت التطبيق": على أندرويد والكمبيوتر يفتح نافذة التثبيت، وعلى آيفون يشرح الخطوات */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return; // التطبيق مثبّت ويعمل الآن
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setPrompt(null);
    window.addEventListener("appinstalled", onInstalled);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- قراءة نوع الجهاز مرة واحدة بعد التحميل
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (prompt)
    return (
      <button
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice;
          setPrompt(null);
        }}
        className="btn-ghost"
      >
        📲 ثبّت التطبيق
      </button>
    );

  if (!ios) return null;
  return (
    <div className="relative">
      <button onClick={() => setShowTip((v) => !v)} className="btn-ghost">
        📲 ثبّت التطبيق
      </button>
      {showTip && (
        <p className="animate-pop absolute end-0 top-full z-30 mt-2 w-64 rounded-2xl border border-white/10 bg-indigo-950 p-3 text-sm shadow-xl">
          في Safari اضغط زر المشاركة <b>⬆️</b> ثم اختر <b>«إضافة إلى الشاشة الرئيسية»</b>.
        </p>
      )}
    </div>
  );
}
