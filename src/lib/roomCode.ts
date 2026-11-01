/**
 * يستخرج رمز الغرفة (6 أرقام) من أي نص يكتبه أو يلصقه المستخدم:
 * أرقام عربية (٠١٢) أو فارسية (۰۱۲) أو إنجليزية، مع مسافات، أو رابط الغرفة كاملاً.
 */
export function parseRoomCode(input: string): string {
  const latin = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const fromLink = latin.match(/code=(\d{6})/);
  if (fromLink) return fromLink[1];
  return latin.replace(/\D/g, "").slice(0, 6);
}

/** رابط الغرفة الكامل (يعمل محلياً وعلى GitHub Pages) */
export function roomLink(code: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/room/?code=${code}`;
}

/** نسخ نص للحافظة، مع بديل للمتصفحات التي لا تدعم Clipboard API */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}
