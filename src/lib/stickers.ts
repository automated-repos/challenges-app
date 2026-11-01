// الملصقات المتاحة في دردشة الغرفة.
// يُرسل المعرّف فقط (id)، فلإضافة ملصق جديد أضفه هنا بمعرّف إنجليزي قصير
// (حروف إنجليزية صغيرة وأرقام و _ فقط، حتى 20 حرفاً).
// لا تحذف ولا تغيّر معرّفاً قديماً حتى تبقى الرسائل السابقة تظهر.
//
// ملصق صورة جديد: ضع الصورة في public/stickers/ (يفضّل مربعة، 512×512، webp أو png أو gif)
// الصور المتحركة (webp متحرك أو gif) تعمل كما هي.
// ثم أضف سطراً في قسم الصور أدناه.
//
// ملصق صوتي جديد: ضع الملف في public/sounds/ (mp3 قصير، ثانية إلى 5 ثوانٍ)
// ثم أضف سطراً في قسم الأصوات أدناه. يسمعه كل من في الغرفة عند إرساله.

export type Sticker =
  | { id: string; kind: "emoji"; emoji: string; label: string }
  | { id: string; kind: "phrase"; emoji: string; text: string; color: string }
  | {
      id: string;
      kind: "image";
      file: string;
      label: string;
      /** نقاط تُخصم من المرسل. يجب أن تطابق دالة _sticker_cost في 0008_sticker_cost.sql */
      cost?: number;
    }
  | {
      id: string;
      kind: "sound";
      file: string;
      label: string;
      emoji: string;
      /** نقاط تُخصم من المرسل. يجب أن تطابق دالة _sticker_cost في 0008_sticker_cost.sql */
      cost?: number;
    };

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
  { id: "img_kid_smile", kind: "image", file: "1.webp", label: "ابتسامة بريئة" },
  { id: "img_happy", kind: "image", file: "2.webp", label: "مبسوط" },
  { id: "img_thinking", kind: "image", file: "3.webp", label: "بفكر 🤔" },
  { id: "img_cat_love", kind: "image", file: "4.webp", label: "بحبكم ❤️" },
  { id: "img_messy_hair", kind: "image", file: "5.webp", label: "لسه صاحي" },
  { id: "img_relaxed", kind: "image", file: "7.webp", label: "رايق" },
  { id: "img_juice", kind: "image", file: "8.webp", label: "ساكت وبشرب العصير 🧃" },
  { id: "img_monkey", kind: "image", file: "9.webp", label: "مصدوم 🐒" },
  { id: "img_shy_girl", kind: "image", file: "10.webp", label: "بتدلع", cost: 5 },
  { id: "img_hiding", kind: "image", file: "11.webp", label: "مكسوف 🙈" },
  { id: "img_newspaper", kind: "image", file: "12.webp", label: "مش مهتم 📰" },
  { id: "img_dance_wave", kind: "image", file: "13.webp", label: "رقصة 💃" },
  { id: "img_kid_dance", kind: "image", file: "14.webp", label: "برقص 🕺" },
  { id: "img_celebrate", kind: "image", file: "16.webp", label: "فرحان 🙌" },
  { id: "img_cat_stare", kind: "image", file: "17.webp", label: "بص بص 👀" },

  { id: "snd_laeiba", kind: "sound", file: "ya_ibn_allaeiba.mp3", label: "يا ابن اللعيبه", emoji: "😎" },
  { id: "snd_yamaa", kind: "sound", file: "yamaa.mp3", label: "يامااااا", emoji: "😱" },
  { id: "snd_ayez_anam", kind: "sound", file: "ayez_anam.mp3", label: "انا عايز انام", emoji: "😴" },
  { id: "snd_allahu_akbar", kind: "sound", file: "allahu_akbar_alek.mp3", label: "الله اكبر عليك", emoji: "🤲" },
  { id: "snd_cat_laugh", kind: "sound", file: "cat_laugh.mp3", label: "ضحكة القطة", emoji: "😹" },
  { id: "snd_samo_aleko", kind: "sound", file: "samo_aleko.mp3", label: "سامو عليكو", emoji: "👋" },
  { id: "snd_dammartni", kind: "sound", file: "dammartni.mp3", label: "دمرتني", emoji: "💥" },
  { id: "snd_enta_mnen", kind: "sound", file: "enta_mnen.mp3", label: "انت منين؟ انت من فرنسا؟", emoji: "🇫🇷" },
  { id: "snd_ana_amalt_eh", kind: "sound", file: "ana_amalt_eh.mp3", label: "انا عملت ايه", emoji: "😳" },
  { id: "snd_ragel_khodar", kind: "sound", file: "ragel_khodar.mp3", label: "انا راجل بتاع خضار وفاكهة", emoji: "🍅" },
  { id: "snd_bydawar", kind: "sound", file: "bydawar_alaya.mp3", label: "بيدور عليا", emoji: "🔍" },
  { id: "snd_rabena_ykremo", kind: "sound", file: "rabena_ykremo.mp3", label: "ربنا يكرمه", emoji: "🙏" },
  { id: "snd_gomla", kind: "sound", file: "gomla_mortabta.mp3", label: "جملة مرتبطة باللي قبلها", emoji: "🤓" },
  { id: "snd_homar_helw", kind: "sound", file: "homar_helw.mp3", label: "عايزين حمار حلو زيك", emoji: "🫏", cost: 10 },
  { id: "snd_shaklak_fahem", kind: "sound", file: "shaklak_fahem.mp3", label: "شكلك فاهم يا نصه", emoji: "🧐" },
  { id: "snd_khasran", kind: "sound", file: "khasran_kol_haga.mp3", label: "انت خسران كل حاجة", emoji: "📉" },
  { id: "snd_sadaqni", kind: "sound", file: "sadaqni_law_aaraf.mp3", label: "صدقني انا لو اعرف اقولك", emoji: "🤷" },
  { id: "snd_hadretak", kind: "sound", file: "hadretak_betoul_eh.mp3", label: "حضرتك بتقول ايه", emoji: "🤨" },
  { id: "snd_haydara", kind: "sound", file: "haydara.mp3", label: "انا الذي سمتني امي حيدرة", emoji: "🦁" },
  { id: "snd_estislami", kind: "sound", file: "estislami.mp3", label: "انا بعلن استسلامي", emoji: "🏳️" },
  { id: "snd_hasbiya_allah", kind: "sound", file: "hasbiya_allah.mp3", label: "حسبي الله ونعم الوكيل", emoji: "😤" },
  { id: "snd_mostahil", kind: "sound", file: "mostahil.mp3", label: "مستحيل مستحيل", emoji: "🙅" },
  { id: "snd_eskot", kind: "sound", file: "eskot.mp3", label: "اسكت", emoji: "🤫" },
];

/** رابط صورة الملصق (يعمل محلياً وعلى GitHub Pages) */
export const stickerSrc = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/stickers/${file}`;

/** رابط ملف الملصق الصوتي */
export const soundSrc = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sounds/${file}`;

const byId = new Map(STICKERS.map((s) => [s.id, s]));
export const getSticker = (id: string) => byId.get(id);
