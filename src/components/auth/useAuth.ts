"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type AuthState = { loading: boolean; userId: string | null; profile: Profile | null };

/** الجلسة الحالية + الملف الشخصي (الاسم والأفاتار) */
export function useAuth() {
  const [state, setState] = useState<AuthState>({ loading: true, userId: null, profile: null });

  const load = useCallback(async (uid: string | null) => {
    if (!uid) {
      setState({ loading: false, userId: null, profile: null });
      return;
    }
    const { data } = await getSupabase().from("profiles").select("*").eq("id", uid).maybeSingle();
    // جلسة بلا ملف شخصي (مثلاً جلسة قديمة مجهولة) = غير مسجل
    setState(data ? { loading: false, userId: uid, profile: data as Profile } : { loading: false, userId: null, profile: null });
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // تأجيل الاستعلام لتجنب التعليق داخل مستمع Supabase
        setTimeout(() => load(session?.user.id ?? null), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => load(state.userId), [load, state.userId]);

  return { ...state, refresh };
}
