// الملصقات المتاحة في دردشة الغرفة.
// يُرسل المعرّف فقط (id)، فلإضافة ملصق جديد أضفه هنا بمعرّف إنجليزي قصير.
// لا تحذف ولا تغيّر معرّفاً قديماً حتى تبقى الرسائل السابقة تظهر.

export type Sticker =
  | { id: string; kind: "emoji"; emoji: string; label: string }
  | { id: string; kind: "phrase"; emoji: string; text: string; color: string };

export const STICKERS: Sticker[] = [
  { id: "laugh", kind: "emoji", emoji: "😂", label: "ضحك" },
  { id: "fire", kind: "emoji", emoji: "🔥", label: "نار" },
  { id: "clap", kind: "emoji", emoji: "👏", label: "تصفيق" },
  { id: "shock", kind: "emoji", emoji: "😱", label: "صدمة" },
  { id: "mindblown", kind: "emoji", emoji: "🤯", label: "انفجار" },
  { id: "cool", kind: "emoji", emoji: "😎", label: "واثق" },
  { id: "think", kind: "emoji", emoji: "🤔", label: "تفكير" },
  { id: "cry", kind: "emoji", emoji: "😭", label: "بكاء" },
  { id: "monkey", kind: "emoji", emoji: "🙈", label: "خجل" },
  { id: "eyes", kind: "emoji", emoji: "👀", label: "أراقب" },
  { id: "party", kind: "emoji", emoji: "🎉", label: "احتفال" },
  { id: "trophy", kind: "emoji", emoji: "🏆", label: "كأس" },
  { id: "muscle", kind: "emoji", emoji: "💪", label: "قوة" },
  { id: "turtle", kind: "emoji", emoji: "🐢", label: "بطيء" },
  { id: "zap", kind: "emoji", emoji: "⚡", label: "سريع" },
  { id: "heart", kind: "emoji", emoji: "❤️", label: "حب" },

  { id: "bravo", kind: "phrase", emoji: "👏", text: "صح عليك", color: "from-emerald-500 to-teal-600" },
  { id: "genius", kind: "phrase", emoji: "🧠", text: "عبقري!", color: "from-violet-500 to-fuchsia-600" },
  { id: "unlucky", kind: "phrase", emoji: "🍀", text: "حظ أوفر", color: "from-sky-500 to-indigo-600" },
  { id: "toofast", kind: "phrase", emoji: "⚡", text: "ما أسرعك!", color: "from-amber-400 to-orange-600" },
  { id: "easy", kind: "phrase", emoji: "😏", text: "سهلة!", color: "from-pink-500 to-rose-600" },
  { id: "hard", kind: "phrase", emoji: "😵", text: "صعبة مرة", color: "from-slate-500 to-slate-700" },
  { id: "comeon", kind: "phrase", emoji: "🔥", text: "يلا يلا", color: "from-orange-500 to-red-600" },
  { id: "gg", kind: "phrase", emoji: "🤝", text: "لعبة حلوة", color: "from-cyan-500 to-blue-600" },
];

const byId = new Map(STICKERS.map((s) => [s.id, s]));
export const getSticker = (id: string) => byId.get(id);
