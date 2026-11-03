"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, getSupabase, isConfigured } from "@/lib/supabase";
import { parseRoomCode } from "@/lib/roomCode";
import { DIFFICULTIES, type Category, type Difficulty } from "@/lib/types";
import { SetupNotice } from "./SetupNotice";
import { useAuth } from "./auth/useAuth";
import { AuthForm } from "./auth/AuthForm";
import { ProfileBar } from "./auth/ProfileBar";
import { Center, ErrorBox, Field } from "./ui";
import { InstallButton } from "./InstallApp";

export function Home() {
  if (!isConfigured) return <SetupNotice />;
  return <HomeInner />;
}

function HomeInner() {
  const [tab, setTab] = useState<"join" | "create">("join");
  const auth = useAuth();

  if (auth.loading) return <Center>جارٍ التحميل...</Center>;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <header className="mb-8 text-center">
        <div className="text-6xl">🏆</div>
        <h1 className="mt-2 text-4xl font-black">تحدي الأسئلة</h1>
        <p className="mt-2 text-indigo-200">العب مع أصدقائك بالضغط (الأسرع يجيب) أو بالأدوار، فردياً أو في فرق.</p>
        <div className="mt-4 flex justify-center">
          <InstallButton />
        </div>
      </header>

      {!auth.profile ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
          <AuthForm />
        </section>
      ) : (
        <div className="space-y-4">
          <ProfileBar profile={auth.profile} onChange={auth.refresh} />
          <Link
            href="/history"
            className="flex items-center justify-between rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 font-bold transition hover:bg-amber-400/20"
          >
            <span>🏆 لوحة الشرف وسجل المسابقات</span>
            <span className="text-amber-200">←</span>
          </Link>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
            {(["join", "create"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-xl py-2.5 font-bold transition ${
                  tab === t ? "bg-indigo-500 text-white shadow" : "text-indigo-200 hover:bg-white/5"
                }`}
              >
                {t === "join" ? "انضمام لمسابقة" : "إنشاء مسابقة"}
              </button>
            ))}
          </div>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
            {tab === "join" ? <JoinForm /> : <CreateTab />}
          </section>
        </div>
      )}
    </main>
  );
}

function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await getSupabase().rpc("join_room", {
        p_code: code.trim(),
      });
      if (error) throw error;
      router.push(`/room/?code=${code.trim()}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="رمز الغرفة">
        <input
          value={code}
          onChange={(e) => setCode(parseRoomCode(e.target.value))}
          inputMode="numeric"
          placeholder="123456"
          dir="ltr"
          required
          className="input text-center text-3xl tracking-[0.4em]"
        />
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy || code.length !== 6} className="btn-primary w-full">
        {busy ? "جارٍ الانضمام..." : "انضمام"}
      </button>
    </form>
  );
}

/** اختيار نوع اللعبة ثم إعداداتها */
function CreateTab() {
  const [game, setGame] = useState<"quiz" | "stop" | "ludo" | "chess">("quiz");
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { id: "quiz", icon: "🧠", name: "مسابقة أسئلة" },
            { id: "stop", icon: "🚌", name: "أتوبيس كومبليت" },
            { id: "ludo", icon: "🎲", name: "لودو" },
            { id: "chess", icon: "♟️", name: "شطرنج" },
          ] as const
        ).map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGame(g.id)}
            className={`rounded-2xl border px-3 py-3 font-bold transition ${
              game === g.id
                ? "border-indigo-400 bg-indigo-500/30 ring-2 ring-indigo-400"
                : "border-white/15 bg-white/5 hover:bg-white/10"
            }`}
          >
            <span className="block text-3xl">{g.icon}</span>
            {g.name}
          </button>
        ))}
      </div>
      {game === "quiz" ? (
        <CreateForm />
      ) : game === "stop" ? (
        <StopForm />
      ) : game === "ludo" ? (
        <LudoForm />
      ) : (
        <ChessForm />
      )}
    </div>
  );
}

function LudoForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]); // فارغة = الكل
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [turnPick, setTurnPick] = useState<"random" | "choose">("random");
  const [steps, setSteps] = useState(20);
  const [seconds, setSeconds] = useState(20);
  const [pointsCorrect, setPointsCorrect] = useState(10);
  const [pointsWrong, setPointsWrong] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategories().then(setCategories, (e) => setError(errorMessage(e)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data, error } = await getSupabase().rpc("create_ludo_room", {
        p_steps: steps,
        p_seconds: seconds,
        p_points_correct: pointsCorrect,
        p_points_wrong: pointsWrong,
        p_category_ids: selected.length ? selected : null,
        p_difficulty: difficulty,
        p_turn_pick: turnPick,
      });
      if (error) throw error;
      router.push(`/room/?code=${data}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="rounded-2xl bg-white/5 p-3 text-sm text-indigo-200">
        لودو الأسئلة: فردي أو فرق (حتى 6 ألوان)، والدور بالترتيب. بعد كل رمية سؤال: الإجابة الصحيحة تحرّكك بعدد الزهر،
        والخاطئة تمنع الحركة وتخصم نقاطاً. الـ 6 + إجابة صحيحة تخرجك من البيت، والوصول للنهاية بالرقم بالضبط. من يصل
        أولاً يأخذ المركز الأول، وتستمر اللعبة للمركز الثاني والثالث...
        <br />
        مكافأة الوصول: الأول +30، الثاني +20، الثالث +10.
      </p>

      <Field label={`عدد الخطوات للفوز: ${steps}`}>
        <input
          type="range"
          min={10}
          max={30}
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="w-full accent-amber-400"
        />
      </Field>

      <CategoryField categories={categories} selected={selected} onChange={setSelected} difficulty={difficulty} />

      <Field label="السؤال">
        <div className="flex flex-wrap gap-2">
          <Chip active={turnPick === "random"} onClick={() => setTurnPick("random")}>
            🎲 سؤال عشوائي
          </Chip>
          <Chip active={turnPick === "choose"} onClick={() => setTurnPick("choose")}>
            🗂️ صاحب الدور يختار المجال
          </Chip>
        </div>
      </Field>

      <DifficultyField value={difficulty} onChange={setDifficulty} />

      <div className="grid grid-cols-2 gap-4">
        <NumberField label="ثواني الإجابة" value={seconds} onChange={setSeconds} min={10} max={60} />
        <NumberField label="نقاط الإجابة الصحيحة" value={pointsCorrect} onChange={setPointsCorrect} min={0} max={100} />
        <NumberField label="خصم الإجابة الخاطئة" value={pointsWrong} onChange={setPointsWrong} min={0} max={100} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy || !categories} className="btn-primary w-full">
        {busy ? "جارٍ الإنشاء..." : "إنشاء الغرفة"}
      </button>
    </form>
  );
}

function ChessForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]); // فارغة = الكل
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [seconds, setSeconds] = useState(20);
  const [pointsCorrect, setPointsCorrect] = useState(10);
  const [pointsWrong, setPointsWrong] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategories().then(setCategories, (e) => setError(errorMessage(e)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data, error } = await getSupabase().rpc("create_chess_room", {
        p_seconds: seconds,
        p_points_correct: pointsCorrect,
        p_points_wrong: pointsWrong,
        p_category_ids: selected.length ? selected : null,
        p_difficulty: difficulty,
      });
      if (error) throw error;
      router.push(`/room/?code=${data}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="rounded-2xl bg-white/5 p-3 text-sm text-indigo-200">
        شطرنج الأسئلة: لاعبان، أو فريقان. في كل فريق قائد واحد يحرك، والباقون يقترحون حركات تظهر على شاشته بأسمائهم. أكل
        القلعة أو الفيل أو الحصان = سؤال للقائدين، وأكل الوزير = 3 أسئلة: إن أجاب المهاجم صح تُؤكل القطعة، وإن أخطأ
        تُلغى الحركة وينتقل الدور. أكل العسكري عادي. لا ساعة للعبة.
        <br />
        الفوز بكش مات: +30 لكل أعضاء الطرف الفائز، والتعادل +10 للجميع.
      </p>

      <CategoryField categories={categories} selected={selected} onChange={setSelected} difficulty={difficulty} />
      <DifficultyField value={difficulty} onChange={setDifficulty} />

      <div className="grid grid-cols-2 gap-4">
        <NumberField label="ثواني كل سؤال" value={seconds} onChange={setSeconds} min={10} max={60} />
        <NumberField label="نقاط الإجابة الصحيحة" value={pointsCorrect} onChange={setPointsCorrect} min={0} max={100} />
        <NumberField label="خصم الإجابة الخاطئة" value={pointsWrong} onChange={setPointsWrong} min={0} max={100} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy || !categories} className="btn-primary w-full">
        {busy ? "جارٍ الإنشاء..." : "إنشاء الغرفة"}
      </button>
    </form>
  );
}

// الخانات الشائعة في أتوبيس كومبليت (يمكن إضافة خانات خاصة)
const STOP_PRESETS = [
  "اسم ولد",
  "اسم بنت",
  "حيوان",
  "نبات",
  "جماد",
  "بلد",
  "مدينة",
  "أكلة",
  "مهنة",
  "لون",
  "ماركة",
  "مشهور",
  "فيلم أو مسلسل",
];
const STOP_DEFAULT = ["اسم ولد", "اسم بنت", "حيوان", "نبات", "جماد", "بلد"];

function StopForm() {
  const router = useRouter();
  const [cats, setCats] = useState<string[]>(STOP_DEFAULT);
  const [custom, setCustom] = useState("");
  const [rounds, setRounds] = useState(5);
  const [seconds, setSeconds] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(c: string) {
    setCats((s) => (s.includes(c) ? s.filter((x) => x !== c) : s.length >= 8 ? s : [...s, c]));
  }

  function addCustom() {
    const c = custom.trim().slice(0, 20);
    if (c && !cats.includes(c) && cats.length < 8) setCats([...cats, c]);
    setCustom("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data, error } = await getSupabase().rpc("create_stop_room", {
        p_categories: cats,
        p_rounds: rounds,
        p_seconds: seconds,
      });
      if (error) throw error;
      router.push(`/room/?code=${data}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="rounded-2xl bg-white/5 p-3 text-sm text-indigo-200">
        يظهر حرف عشوائي، وكل لاعب يكتب كلمة تبدأ به في كل خانة. أول من يُكمل يضغط <b>ستوب!</b> ثم يصوّت الجميع على
        الكلمات الخاطئة. الكلمة الوحيدة في خانتها = 20، غير المكررة = 10، المكررة = 5.
      </p>
      <Field label={`الخانات (${cats.length} من 3 إلى 8)`}>
        <div className="flex flex-wrap gap-2">
          {[...STOP_PRESETS, ...cats.filter((c) => !STOP_PRESETS.includes(c))].map((c) => (
            <Chip key={c} active={cats.includes(c)} onClick={() => toggle(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            maxLength={20}
            placeholder="خانة أخرى..."
            className="input py-2"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!custom.trim() || cats.length >= 8}
            className="btn-ghost shrink-0"
          >
            إضافة
          </button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <NumberField label="عدد الجولات" value={rounds} onChange={setRounds} min={1} max={15} />
        <NumberField label="ثواني كل جولة" value={seconds} onChange={setSeconds} min={30} max={300} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy || cats.length < 3} className="btn-primary w-full">
        {busy ? "جارٍ الإنشاء..." : "إنشاء الغرفة"}
      </button>
    </form>
  );
}

function CreateForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]); // فارغة = الكل
  const [total, setTotal] = useState(10);
  const [questionSeconds, setQuestionSeconds] = useState(20);
  const [answerSeconds, setAnswerSeconds] = useState(10);
  const [pointsCorrect, setPointsCorrect] = useState(10);
  const [pointsWrong, setPointsWrong] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [playMode, setPlayMode] = useState<"buzzer" | "turns">("buzzer");
  const [turnPick, setTurnPick] = useState<"random" | "choose" | "same">("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategories().then(setCategories, (e) => setError(errorMessage(e)));
  }, []);

  const available = categories
    ? (selected.length ? categories.filter((c) => selected.includes(c.id)) : categories).reduce(
        (sum, c) => sum + Number(difficulty ? c[`${difficulty}_count`] : c.question_count),
        0,
      )
    : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data, error } = await getSupabase().rpc("create_room", {
        p_category_ids: selected.length ? selected : null,
        p_total: total,
        p_question_seconds: questionSeconds,
        p_answer_seconds: answerSeconds,
        p_points_correct: pointsCorrect,
        p_points_wrong: pointsWrong,
        p_difficulty: difficulty,
        p_play_mode: playMode,
        p_turn_pick: turnPick,
      });
      if (error) throw error;
      router.push(`/room/?code=${data}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <CategoryField categories={categories} selected={selected} onChange={setSelected} difficulty={difficulty} />

      <Field label="طريقة اللعب">
        <div className="flex flex-wrap gap-2">
          <Chip active={playMode === "buzzer"} onClick={() => setPlayMode("buzzer")}>
            🔔 بالضغط: الأسرع يجيب
          </Chip>
          <Chip active={playMode === "turns"} onClick={() => setPlayMode("turns")}>
            🔄 بالأدوار: كل لاعب في دوره
          </Chip>
        </div>
        {playMode === "turns" && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip active={turnPick === "random"} onClick={() => setTurnPick("random")}>
              🎲 سؤال عشوائي
            </Chip>
            <Chip active={turnPick === "choose"} onClick={() => setTurnPick("choose")}>
              🗂️ صاحب الدور يختار المجال
            </Chip>
            <Chip active={turnPick === "same"} onClick={() => setTurnPick("same")}>
              🎯 نفس المجال للجميع في كل جولة
            </Chip>
          </div>
        )}
        {playMode === "turns" && turnPick === "same" && (
          <p className="mt-2 text-xs text-indigo-300">
            في كل جولة يُختار مجال عشوائي، ويجيب كل فريق (أو لاعب) عن سؤال مختلف من نفس المجال. عدد الأسئلة يُضبط
            ليتساوى الجميع.
          </p>
        )}
      </Field>

      <DifficultyField value={difficulty} onChange={setDifficulty} />

      <div className="grid grid-cols-2 gap-4">
        <NumberField label="عدد الأسئلة" value={total} onChange={setTotal} min={1} max={100} />
        {playMode === "buzzer" ? (
          <>
            <NumberField
              label="ثواني انتظار الضغط"
              value={questionSeconds}
              onChange={setQuestionSeconds}
              min={5}
              max={120}
            />
            <NumberField label="ثواني الإجابة" value={answerSeconds} onChange={setAnswerSeconds} min={3} max={60} />
          </>
        ) : (
          <NumberField label="ثواني كل دور" value={questionSeconds} onChange={setQuestionSeconds} min={5} max={120} />
        )}
        <NumberField
          label="نقاط الإجابة الصحيحة"
          value={pointsCorrect}
          onChange={setPointsCorrect}
          min={0}
          max={1000}
        />
        <NumberField label="خصم الإجابة الخاطئة" value={pointsWrong} onChange={setPointsWrong} min={0} max={1000} />
      </div>

      {categories && total > available && (
        <p className="text-sm text-amber-300">
          {available === 0
            ? "لا توجد أسئلة بهذا المستوى في المجالات المختارة."
            : `يوجد ${available} سؤالاً فقط ${difficulty ? "بهذا المستوى " : ""}في المجالات المختارة، وسيُستخدم هذا العدد.`}
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <button disabled={busy || !categories || available === 0} className="btn-primary w-full">
        {busy ? "جارٍ الإنشاء..." : "إنشاء الغرفة"}
      </button>
    </form>
  );
}

async function loadCategories(): Promise<Category[]> {
  const { data, error } = await getSupabase().rpc("list_categories");
  if (error) throw error;
  return data as Category[];
}

/** اختيار المجالات (فارغة = الكل) مع عدد الأسئلة بالمستوى المختار */
function CategoryField({
  categories,
  selected,
  onChange,
  difficulty,
}: {
  categories: Category[] | null;
  selected: number[];
  onChange: (ids: number[]) => void;
  difficulty: Difficulty | null;
}) {
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Field label="المجالات">
      {!categories ? (
        <p className="text-sm text-indigo-200">جارٍ التحميل...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Chip active={selected.length === 0} onClick={() => onChange([])}>
            🌐 الكل
          </Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={selected.includes(c.id)} onClick={() => toggle(c.id)}>
              {c.icon} {c.name}
              <span className="opacity-60"> ({difficulty ? c[`${difficulty}_count`] : c.question_count})</span>
            </Chip>
          ))}
        </div>
      )}
    </Field>
  );
}

function DifficultyField({ value, onChange }: { value: Difficulty | null; onChange: (d: Difficulty | null) => void }) {
  return (
    <Field label="مستوى الصعوبة">
      <div className="flex flex-wrap gap-2">
        {DIFFICULTIES.map((d) => (
          <Chip key={d.label} active={value === d.value} onClick={() => onChange(d.value)}>
            {d.label}
          </Chip>
        ))}
      </div>
    </Field>
  );
}

function NumberField(props: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="input text-center"
      />
    </Field>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-indigo-400 bg-indigo-500 text-white"
          : "border-white/15 bg-white/5 text-indigo-100 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
