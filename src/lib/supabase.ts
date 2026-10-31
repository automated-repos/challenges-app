import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

// Supabase يشترط بريداً، فنحوّل اسم المستخدم إلى بريد داخلي لا تُرسل إليه رسائل
const EMAIL_DOMAIN = "players.challenge-app.local";
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const normalizeUsername = (u: string) => u.trim().toLowerCase();
const toEmail = (username: string) => `${normalizeUsername(username)}@${EMAIL_DOMAIN}`;

export async function signUp(username: string, password: string, displayName: string, avatar: string) {
  const { error } = await getSupabase().auth.signUp({
    email: toEmail(username),
    password,
    options: { data: { username: normalizeUsername(username), display_name: displayName.trim(), avatar } },
  });
  if (error) throw translateAuthError(error.message);
}

export async function signIn(username: string, password: string) {
  const { error } = await getSupabase().auth.signInWithPassword({ email: toEmail(username), password });
  if (error) throw translateAuthError(error.message);
}

export async function signOut() {
  await getSupabase().auth.signOut();
}

function translateAuthError(msg: string): Error {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  if (m.includes("already registered") || m.includes("already exists")) return new Error("اسم المستخدم محجوز، اختر اسماً آخر");
  if (m.includes("password")) return new Error("كلمة المرور ضعيفة: يجب أن تكون 6 أحرف على الأقل");
  if (m.includes("email not confirmed")) return new Error("يجب إطفاء خيار Confirm email في إعدادات Supabase");
  if (m.includes("rate limit")) return new Error("محاولات كثيرة، انتظر قليلاً ثم حاول مجدداً");
  return new Error(msg);
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "حدث خطأ غير متوقع";
}
