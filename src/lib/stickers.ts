// الملصقات المتاحة في دردشة الغرفة.
// يُرسل المعرّف فقط (id)، فلإضافة ملصق جديد أضفه هنا بمعرّف إنجليزي قصير
// (حروف إنجليزية صغيرة وأرقام و _ فقط، حتى 20 حرفاً).
// لا تحذف ولا تغيّر معرّفاً قديماً حتى تبقى الرسائل السابقة تظهر.
//
// ملصق صورة جديد: ضع الصورة في public/stickers/ (يفضّل مربعة، 512×512، webp أو png)
// ثم أضف سطراً في قسم الصور أدناه.
//
// ملصق صوتي جديد: ضع الملف في public/sounds/ (mp3 قصير، ثانية إلى 5 ثوانٍ)
// ثم أضف سطراً في قسم الأصوات أدناه. يسمعه كل من في الغرفة عند إرساله.

export type Sticker =
  | { id: string; kind: "emoji"; emoji: string; label: string }
  | { id: string; kind: "phrase"; emoji: string; text: string; color: string }
  | { id: string; kind: "image"; file: string; label: string }
  | { id: string; kind: "sound"; file: string; label: string; emoji: string };

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

  { id: "img_1", kind: "image", file: "sticker_1.webp", label: "مين دا؟" },
  { id: "img_11", kind: "image", file: "sticker_11.webp", label: "نظرة" },
  { id: "img_2", kind: "image", file: "sticker_2.png", label: "اهو غلاسة كده" },
  { id: "img_7", kind: "image", file: "sticker_7.png", label: "ولعت 🔥" },

  { id: "snd_laeiba", kind: "sound", file: "ya_ibn_allaeiba.mp3", label: "يا ابن اللعيبه", emoji: "😎" },
];

/** رابط صورة الملصق (يعمل محلياً وعلى GitHub Pages) */
export const stickerSrc = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/stickers/${file}`;

/** رابط ملف الملصق الصوتي */
export const soundSrc = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sounds/${file}`;

const byId = new Map(STICKERS.map((s) => [s.id, s]));
export const getSticker = (id: string) => byId.get(id);
