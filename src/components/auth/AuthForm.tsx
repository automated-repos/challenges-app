"use client";

import { useState } from "react";
import { errorMessage, normalizeUsername, signIn, signUp, USERNAME_RE } from "@/lib/supabase";
import { AVATARS, randomAvatar } from "@/lib/avatars";
import { ErrorBox, Field } from "../ui";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(randomAvatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const usernameOk = USERNAME_RE.test(normalizeUsername(username));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!usernameOk) {
      setError("اسم المستخدم: من 3 إلى 20 حرفاً إنجليزياً أو رقماً أو _");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await signIn(username, password);
      else await signUp(username, password, displayName || username, avatar);
      // useAuth يلتقط تسجيل الدخول تلقائياً
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError("");
            }}
            className={`rounded-xl py-2.5 font-bold transition ${
              mode === m ? "bg-indigo-500 text-white shadow" : "text-indigo-200 hover:bg-white/5"
            }`}
          >
            {m === "login" ? "تسجيل الدخول" : "حساب جديد"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "register" && (
          <>
            <Field label="اختر الأفاتار">
              <AvatarPicker value={avatar} onChange={setAvatar} />
            </Field>
            <Field label="اسمك الظاهر للمتسابقين">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={24}
                placeholder="مثال: علي"
                required
                className="input"
              />
            </Field>
          </>
        )}

        <Field label={mode === "register" ? "اسم المستخدم (للدخول)" : "اسم المستخدم"}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
            maxLength={20}
            placeholder="ali_123"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            required
            className="input text-left"
          />
          {mode === "register" && (
            <span className={`mt-1 block text-xs ${username && !usernameOk ? "text-amber-300" : "text-indigo-300"}`}>
              حروف إنجليزية صغيرة وأرقام و _ فقط (3 إلى 20)
            </span>
          )}
        </Field>

        <Field label="كلمة المرور">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            dir="ltr"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            className="input text-left"
          />
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}
        <button disabled={busy} className="btn-primary w-full">
          {busy ? "لحظة..." : mode === "login" ? "دخول" : "إنشاء الحساب"}
        </button>
      </form>
    </div>
  );
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          className={`aspect-square rounded-xl text-2xl transition ${
            value === a ? "scale-110 bg-indigo-500 ring-2 ring-indigo-300" : "bg-white/5 hover:bg-white/15"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}
