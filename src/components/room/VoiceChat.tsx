"use client";

import { useState, type MouseEvent } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { errorMessage, getSupabase } from "@/lib/supabase";

type Conn = { token: string; url: string };

/** الغرفة الصوتية: اللاعبون يسمعون بعضهم أثناء اللعب */
export function VoiceChat({ roomId }: { roomId: string }) {
  const [conn, setConn] = useState<Conn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join(e: MouseEvent<HTMLButtonElement>) {
    // لا نترك التركيز على الزر حتى لا تضغطه المسافة (زر الإجابة في اللعبة)
    e.currentTarget.blur();
    setBusy(true);
    setError("");
    try {
      const { data, error } = await getSupabase().functions.invoke<Conn>("voice-token", { body: { roomId } });
      if (error) throw new Error(await functionError(error));
      if (!data?.token) throw new Error("تعذّر الاتصال بالغرفة الصوتية");
      setConn(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!conn)
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <button onClick={join} disabled={busy} className="btn-ghost">
          {busy ? "جارٍ الاتصال..." : "🎙️ انضم للصوت"}
        </button>
        {error && <span className="text-sm text-rose-300">{error}</span>}
      </div>
    );

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio
      video={false}
      onDisconnected={() => setConn(null)}
      onMediaDeviceFailure={() => setError("لم يُسمح باستخدام الميكروفون، يمكنك الاستماع فقط")}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 sm:mb-4"
    >
      <RoomAudioRenderer />
      <VoiceControls onLeave={() => setConn(null)} />
      <VoiceParticipants />
      <StartAudio label="🔊 اضغط لتشغيل الصوت" className="btn-ghost" />
      {error && <span className="w-full text-sm text-rose-300">{error}</span>}
    </LiveKitRoom>
  );
}

function VoiceControls({ onLeave }: { onLeave: () => void }) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  function toggleMic(e: MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur();
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {});
  }

  function leave(e: MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur();
    onLeave();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleMic}
        className={`btn-ghost ${isMicrophoneEnabled ? "" : "border-rose-400/50 bg-rose-500/20 text-rose-200"}`}
        title={isMicrophoneEnabled ? "كتم الميكروفون" : "تشغيل الميكروفون"}
      >
        {isMicrophoneEnabled ? "🎙️ الميكروفون يعمل" : "🔇 مكتوم"}
      </button>
      <button onClick={leave} className="btn-ghost" title="مغادرة الصوت">
        📴 خروج
      </button>
    </div>
  );
}

function VoiceParticipants() {
  const participants = useParticipants();
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {participants.map((p) => (
        <VoiceParticipant key={p.identity} participant={p} />
      ))}
    </ul>
  );
}

function VoiceParticipant({ participant }: { participant: Participant }) {
  const speaking = useIsSpeaking(participant);
  const muted = !participant.isMicrophoneEnabled;
  return (
    <li
      title={participant.name || ""}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-sm transition ${
        speaking ? "bg-emerald-500/30 ring-2 ring-emerald-400" : "bg-white/5"
      }`}
    >
      <span>{avatarOf(participant)}</span>
      <span className="max-w-24 truncate">{participant.name}</span>
      {muted && <span className="text-xs">🔇</span>}
    </li>
  );
}

function avatarOf(p: Participant): string {
  try {
    return (JSON.parse(p.metadata || "{}") as { avatar?: string }).avatar || "🙂";
  } catch {
    return "🙂";
  }
}

/** رسالة الخطأ التي أرسلتها الدالة بدل الرسالة العامة */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {}
  }
  return "تعذّر الاتصال بالغرفة الصوتية (تأكد من نشر دالة voice-token)";
}
