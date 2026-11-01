"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { sounds } from "@/lib/sound";
import { getSticker, STICKERS, stickerSrc, type Sticker } from "@/lib/stickers";

interface Message {
  id: number;
  room_id: string;
  user_id: string;
  name: string;
  avatar: string;
  kind: "text" | "sticker";
  body: string;
  created_at: string;
}

const HISTORY = 50;

type EmojiSticker = Extract<Sticker, { kind: "emoji" }>;
type PhraseStickerT = Extract<Sticker, { kind: "phrase" }>;
const EMOJI_STICKERS = STICKERS.filter((s): s is EmojiSticker => s.kind === "emoji");
const PHRASE_STICKERS = STICKERS.filter((s): s is PhraseStickerT => s.kind === "phrase");
type ImageStickerT = Extract<Sticker, { kind: "image" }>;
const IMAGE_STICKERS = STICKERS.filter((s): s is ImageStickerT => s.kind === "image");

/** لا نترك التركيز على الأزرار حتى لا تضغطها المسافة (زر الإجابة في اللعبة) */
const blur = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();

function useChat(roomId: string, userId: string, onIncoming: (m: Message) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const lastId = useRef(0);
  const onIncomingRef = useRef(onIncoming);
  useEffect(() => {
    onIncomingRef.current = onIncoming;
  });

  const merge = useCallback(
    (incoming: Message[], notify: boolean) => {
      const fresh = incoming.filter((m) => m.id > lastId.current).sort((a, b) => a.id - b.id);
      if (!fresh.length) return;
      lastId.current = fresh[fresh.length - 1].id;
      setMessages((prev) => [...prev, ...fresh].slice(-200));
      if (notify) fresh.filter((m) => m.user_id !== userId).forEach((m) => onIncomingRef.current(m));
    },
    [userId],
  );

  // يجلب ما فاتنا (عند الاشتراك أو بعد الإرسال)
  const fetchNew = useCallback(
    async (notify: boolean) => {
      const { data } = await getSupabase()
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .gt("id", lastId.current)
        .order("id", { ascending: false })
        .limit(HISTORY);
      if (data) merge(data as Message[], notify);
    },
    [roomId, merge],
  );

  useEffect(() => {
    const sb = getSupabase();
    let first = true;
    const channel = sb
      .channel(`chat-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
        (p) => merge([p.new as Message], true),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          fetchNew(!first); // الرسائل القديمة عند الدخول لا تُعدّ جديدة
          first = false;
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, [roomId, merge, fetchNew]);

  const send = useCallback(
    async (body: string, kind: "text" | "sticker") => {
      const { error } = await getSupabase().rpc("send_message", { p_room: roomId, p_body: body, p_kind: kind });
      if (error) throw error;
      fetchNew(false);
    },
    [roomId, fetchNew],
  );

  return { messages, send };
}

/** inGame: أثناء السؤال يكون زر الإجابة مثبتاً أسفل شاشة الهاتف، فنرفع زر الدردشة فوقه */
export function RoomChat({ roomId, userId, inGame }: { roomId: string; userId: string; inGame: boolean }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState<Message | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { messages, send } = useChat(roomId, userId, (m) => {
    sounds.message();
    if (openRef.current) return;
    setUnread((n) => n + 1);
    setPreview(m);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreview(null), 3500);
  });
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  function toggle(e: MouseEvent<HTMLButtonElement>) {
    blur(e);
    setOpen((o) => !o);
    setUnread(0);
    setPreview(null);
  }

  return (
    <>
      {open && <ChatPanel messages={messages} userId={userId} send={send} onClose={() => setOpen(false)} />}

      {!open && preview && (
        <button
          onClick={toggle}
          className={`animate-pop fixed ${inGame ? "bottom-[17rem]" : "bottom-20"} left-4 z-40 sm:bottom-20 flex max-w-64 items-center gap-2 rounded-2xl border border-white/10 bg-indigo-950/95 px-3 py-2 text-start text-sm shadow-xl backdrop-blur`}
        >
          <span className="text-lg">{preview.avatar}</span>
          <span className="min-w-0">
            <span className="block text-xs text-indigo-300">{preview.name}</span>
            <span className="block truncate">{previewText(preview)}</span>
          </span>
        </button>
      )}

      {!open && (
        <button
          onClick={toggle}
          title="الدردشة"
          className={`fixed ${inGame ? "bottom-56 h-11 w-11 text-xl" : "bottom-4 h-14 w-14 text-2xl"} left-3 z-40 flex sm:bottom-4 sm:left-4 sm:h-14 sm:w-14 sm:text-2xl items-center justify-center rounded-full bg-indigo-500 shadow-xl transition hover:bg-indigo-400 active:scale-95`}
        >
          💬
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-bold">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      )}
    </>
  );
}

function ChatPanel({
  messages,
  userId,
  send,
  onClose,
}: {
  messages: Message[];
  userId: string;
  send: (body: string, kind: "text" | "sticker") => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // النزول لآخر رسالة
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, showStickers]);

  async function submit(body: string, kind: "text" | "sticker") {
    if (!body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await send(body.trim(), kind);
      if (kind === "text") setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(text, "text");
  }

  function sendSticker(e: MouseEvent<HTMLButtonElement>, s: Sticker) {
    blur(e);
    submit(s.id, "sticker");
  }

  return (
    <section className="animate-pop fixed inset-x-2 bottom-2 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-indigo-950/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-4 sm:bottom-4 sm:w-96">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <h2 className="font-bold">💬 دردشة الغرفة</h2>
        <button
          onClick={(e) => {
            blur(e);
            onClose();
          }}
          className="rounded-lg px-2 text-xl text-indigo-200 hover:bg-white/10"
          title="إغلاق"
        >
          ×
        </button>
      </header>

      <div ref={listRef} className="min-h-40 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-indigo-300">لا توجد رسائل بعد. قل مرحباً 👋</p>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={m.id} m={m} mine={m.user_id === userId} grouped={messages[i - 1]?.user_id === m.user_id} />
        ))}
      </div>

      {showStickers && (
        <div className="max-h-64 overflow-y-auto border-t border-white/10 p-2">
          {IMAGE_STICKERS.length > 0 && (
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {IMAGE_STICKERS.map((s) => (
                <button
                  key={s.id}
                  onClick={(e) => sendSticker(e, s)}
                  disabled={sending}
                  title={s.label}
                  className="aspect-square overflow-hidden rounded-xl bg-white p-0.5 transition hover:scale-105 disabled:opacity-50"
                >
                  <StickerImage s={s} />
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_STICKERS.map((s) => (
              <button
                key={s.id}
                onClick={(e) => sendSticker(e, s)}
                disabled={sending}
                title={s.label}
                className="rounded-lg p-1 text-2xl transition hover:scale-125 hover:bg-white/10 disabled:opacity-50"
              >
                {s.emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {PHRASE_STICKERS.map((s) => (
              <button
                key={s.id}
                onClick={(e) => sendSticker(e, s)}
                disabled={sending}
                className="transition hover:scale-105 disabled:opacity-50"
              >
                <PhraseSticker s={s} small />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="px-3 pb-1 text-xs text-rose-300">{error}</p>}

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={(e) => {
            blur(e);
            setShowStickers((v) => !v);
          }}
          className={`shrink-0 rounded-xl px-2.5 py-2 text-xl transition hover:bg-white/10 ${showStickers ? "bg-white/10" : ""}`}
          title="الملصقات"
        >
          😀
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="اكتب رسالة..."
          className="input py-2"
        />
        <button type="submit" disabled={sending || !text.trim()} className="btn-primary shrink-0 px-4 py-2">
          إرسال
        </button>
      </form>
    </section>
  );
}

function ChatMessage({ m, mine, grouped }: { m: Message; mine: boolean; grouped: boolean }) {
  const sticker = m.kind === "sticker" ? getSticker(m.body) : undefined;
  return (
    <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <span className={`w-7 shrink-0 text-center text-xl ${grouped ? "invisible" : ""}`}>{m.avatar}</span>
      <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {!grouped && !mine && <span className="mb-0.5 px-1 text-xs text-indigo-300">{m.name}</span>}
        {m.kind === "sticker" ? (
          sticker ? (
            <div className="animate-sticker">
              {sticker.kind === "emoji" ? (
                <span className="block text-5xl leading-tight">{sticker.emoji}</span>
              ) : sticker.kind === "image" ? (
                <span className="block h-32 w-32 overflow-hidden rounded-2xl bg-white shadow-lg sm:h-36 sm:w-36">
                  <StickerImage s={sticker} />
                </span>
              ) : (
                <PhraseSticker s={sticker} />
              )}
            </div>
          ) : (
            <span className="text-sm text-indigo-300">ملصق غير متوفر</span>
          )
        ) : (
          <p
            dir="auto"
            className={`rounded-2xl px-3 py-1.5 break-words whitespace-pre-wrap ${
              mine ? "bg-indigo-500 text-white" : "bg-white/10"
            }`}
          >
            {m.body}
          </p>
        )}
      </div>
    </div>
  );
}

function PhraseSticker({ s, small = false }: { s: PhraseStickerT; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-2xl bg-linear-to-br font-black text-white shadow-lg ${s.color} ${
        small ? "w-full justify-center px-2 py-1.5 text-sm" : "-rotate-2 px-4 py-2.5 text-xl"
      }`}
    >
      <span className={small ? "text-base" : "text-2xl"}>{s.emoji}</span>
      {s.text}
    </span>
  );
}

function StickerImage({ s }: { s: ImageStickerT }) {
  return (
    // الموقع ثابت (static export) فلا حاجة لتحسين الصور عبر next/image
    // eslint-disable-next-line @next/next/no-img-element
    <img src={stickerSrc(s.file)} alt={s.label} loading="lazy" draggable={false} className="h-full w-full object-contain" />
  );
}

function previewText(m: Message): string {
  if (m.kind !== "sticker") return m.body;
  const s = getSticker(m.body);
  if (!s) return "ملصق";
  if (s.kind === "emoji") return `${s.emoji} ملصق`;
  if (s.kind === "image") return `🖼️ ${s.label}`;
  return `${s.emoji} ${s.text}`;
}
