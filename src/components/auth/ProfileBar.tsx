"use client";

import { useState } from "react";
import { errorMessage, getSupabase, signOut } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { Avatar, ErrorBox, Field } from "../ui";
import { AvatarPicker } from "./AuthForm";

/** شريط المستخدم: الأفاتار والاسم + تعديل الملف + خروج */
export function ProfileBar({ profile, onChange }: { profile: Profile; onChange: () => void }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <Avatar emoji={profile.avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{profile.display_name}</p>
          <p dir="ltr" className="truncate text-right text-xs text-indigo-300">
            @{profile.username}
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "إغلاق" : "✏️ تعديل"}
        </button>
        <button className="btn-ghost" onClick={() => signOut()}>
          خروج
        </button>
      </div>
      {editing && (
        <EditProfile
          profile={profile}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function EditProfile({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await getSupabase().rpc("update_profile", { p_name: name, p_avatar: avatar });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onSaved();
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-4 border-t border-white/10 pt-4">
      <Field label="الأفاتار">
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </Field>
      <Field label="الاسم الظاهر">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required className="input" />
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy} className="btn-primary w-full">
        {busy ? "جارٍ الحفظ..." : "حفظ"}
      </button>
    </form>
  );
}
