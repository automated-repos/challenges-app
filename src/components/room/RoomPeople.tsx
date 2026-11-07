"use client";

import { createContext, useContext, useState } from "react";
import { errorMessage } from "@/lib/supabase";

/** من المتصل الآن، وإخراج لاعب (لمنشئ الغرفة) */
interface RoomPeople {
  online: Set<string> | null;
  canKick: boolean;
  hostId: string;
  kick: (userId: string) => Promise<unknown>;
}

export const RoomPeopleContext = createContext<RoomPeople | null>(null);

/** نقطة خضراء للمتصل ورمادية لمن انقطع اتصاله */
export function OnlineDot({ userId }: { userId: string }) {
  const people = useContext(RoomPeopleContext);
  if (!people?.online) return null;
  const on = people.online.has(userId);
  return (
    <span
      title={on ? "متصل" : "انقطع الاتصال"}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-400" : "animate-pulse bg-slate-500"}`}
    />
  );
}

/** زر إخراج لاعب: يظهر لمنشئ الغرفة فقط، ولا يظهر بجانب اسمه هو */
export function KickButton({ userId, name }: { userId: string; name: string }) {
  const people = useContext(RoomPeopleContext);
  const [busy, setBusy] = useState(false);
  if (!people?.canKick || userId === people.hostId) return null;
  return (
    <button
      type="button"
      disabled={busy}
      title={`إخراج ${name}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (!confirm(`إخراج ${name} من الغرفة؟ يستطيع الدخول من جديد بنفس الرمز.`)) return;
        setBusy(true);
        try {
          await people.kick(userId);
        } catch (err) {
          alert(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      className="shrink-0 rounded-full px-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
    >
      ✖
    </button>
  );
}
