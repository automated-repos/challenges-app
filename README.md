# تحدي الأسئلة 🏆

مسابقة أسئلة عامة باللغة العربية للعب الجماعي عن بُعد. من يضغط الزر أولاً يجيب، والإجابة الخاطئة تخصم نقاطاً وتفتح السؤال للباقين، وفي النهاية يظهر ترتيب الجميع.

**التقنيات:** Next.js + Supabase (قاعدة البيانات + التحديث اللحظي + الحسابات). التسجيل باسم مستخدم وكلمة مرور فقط، بدون بريد إلكتروني، ولكل لاعب اسم ظاهر وأفاتار.

## الإعداد

### 1. Supabase
شغّل هذه الملفات بالترتيب من **SQL Editor**:
1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql): الجداول ومنطق اللعبة
2. [`supabase/migrations/0002_accounts.sql`](supabase/migrations/0002_accounts.sql): الحسابات والأفاتار
3. [`supabase/migrations/0003_history.sql`](supabase/migrations/0003_history.sql): سجل المسابقات ولوحة الشرف
4. [`supabase/migrations/0004_chat.sql`](supabase/migrations/0004_chat.sql): دردشة الغرفة والملصقات
5. [`supabase/migrations/0005_ready.sql`](supabase/migrations/0005_ready.sql): زر "جاهز" قبل البدء
6. [`supabase/migrations/0006_teams.sql`](supabase/migrations/0006_teams.sql): وضع الفرق
7. [`supabase/migrations/0007_gifts.sql`](supabase/migrations/0007_gifts.sql): إهداء النقاط
8. [`supabase/migrations/0008_sticker_cost.sql`](supabase/migrations/0008_sticker_cost.sql): ملصقات تخصم نقاطاً
9. [`supabase/migrations/0009_difficulty.sql`](supabase/migrations/0009_difficulty.sql): مستوى الصعوبة
10. [`supabase/migrations/0010_no_solo.sql`](supabase/migrations/0010_no_solo.sql): منع اللعب منفرداً (لا تبدأ مسابقة إلا بلاعبين)
11. [`supabase/seed.sql`](supabase/seed.sql) ثم [`supabase/seed_more.sql`](supabase/seed_more.sql): الأسئلة (520 سؤالاً في 14 مجالاً)
12. [`supabase/seed_difficulty.sql`](supabase/seed_difficulty.sql): تصنيف الأسئلة (225 سهل، 217 متوسط، 78 صعب)

ثم من **Authentication → Sign In / Providers → Email**:
- تأكد أن **Email** مفعّل
- أطفئ **Confirm email** (التسجيل باسم مستخدم بدون بريد حقيقي)

يمكن تشغيل كل الملفات أكثر من مرة دون مشاكل.

### 2. التطبيق
```bash
cp .env.local.example .env.local   # ثم ضع رابط المشروع والمفتاح العام
npm install
npm run dev
```
افتح http://localhost:3000

> للتجربة وحدك: سجّل حسابين، وافتح الثاني في نافذة تصفح خفي (Incognito) أو متصفح آخر.

### 3. الغرفة الصوتية (اختياري)
يسمع اللاعبون بعضهم أثناء اللعب عبر [LiveKit](https://livekit.io). الخطة المجانية تعطي 5,000 دقيقة اتصال شهرياً (كل لاعب متصل يُحسب وحده).

1. أنشئ حساباً في [cloud.livekit.io](https://cloud.livekit.io) ثم مشروعاً جديداً.
2. من **Settings → API Keys** أنشئ مفتاحاً، وانسخ: رابط المشروع (`wss://...livekit.cloud`) و **API Key** و **API Secret**.
3. من مجلد المشروع:
```bash
supabase link --project-ref <رقم-مشروع-supabase>
supabase secrets set LIVEKIT_URL=wss://xxxx.livekit.cloud LIVEKIT_API_KEY=xxxx LIVEKIT_API_SECRET=xxxx
supabase functions deploy voice-token --no-verify-jwt
```
الدالة [`voice-token`](supabase/functions/voice-token/index.ts) تتحقق بنفسها من تسجيل الدخول ومن أن اللاعب عضو في الغرفة قبل إعطائه تذكرة الصوت. المفتاح السري لا يصل للمتصفح أبداً.

## طريقة اللعب
1. منشئ الغرفة يختار المجالات (أو الكل) ومستوى الصعوبة (سهل / متوسط / صعب / مختلط) وعدد الأسئلة والأوقات والنقاط، فيحصل على رمز من 6 أرقام.
2. المتسابقون يسجلون الدخول ويدخلون الرمز من أجهزتهم.
   كل متسابق يضغط **أنا جاهز**، ومنشئ الغرفة لا يستطيع البدء إلا بعد جاهزية الجميع.
   **وضع الفرق (اختياري):** منشئ الغرفة يختار فرقاً من 2 أو 3 أو 4، وكل لاعب يختار فريقه أو يضغط منشئ الغرفة **توزيع عشوائي**. الإجابة الخاطئة تمنع الفريق كله من السؤال، والفائز هو الفريق صاحب أعلى مجموع نقاط.
3. يظهر السؤال للجميع، وأول من يضغط الزر (أو المسافة) يختار الإجابة (أو الأرقام 1-4).
4. إجابة صحيحة: نقاط ثم السؤال التالي. إجابة خاطئة أو انتهاء الوقت: خصم، ويُمنع من هذا السؤال، ويُفتح للباقين.
5. في النهاية تظهر لوحة الترتيب.
6. أثناء المسابقة: زر **🎁 إهداء نقاط** تحت الترتيب يحوّل جزءاً من نقاطك للاعب آخر كروح رياضية، ويظهر الإهداء للجميع في الدردشة.
7. زر 💬 أسفل الشاشة يفتح دردشة الغرفة: رسائل نصية وملصقات. لإضافة ملصقات عدّل [`src/lib/stickers.ts`](src/lib/stickers.ts).
8. صفحة **لوحة الشرف** تعرض مجموع نقاط كل لاعب عبر كل المسابقات وعدد انتصاراته، وصفحة **السجل** تعرض كل مسابقة: متى انتهت ومن فاز بها.

## إضافة أسئلة
أضفها في `supabase/seed_more.sql` بنفس الشكل (`correct_index` يبدأ من 0) وأعد تشغيله، أو من **Table Editor** مباشرة. السؤال الجديد يكون **متوسطاً** تلقائياً، ويمكن تغيير عمود `difficulty` إلى `easy` أو `hard`.

## الحماية
- الإجابة الصحيحة لا تصل لأي متصفح قبل كشف السؤال؛ التحقق يتم داخل قاعدة البيانات.
- حسم "من ضغط أولاً" يتم في القاعدة بقفل صف الغرفة، فلا يمكن أن يفوز متسابقان بنفس الضغطة.
- كل الكتابة تتم عبر دوال (RPC) فقط؛ المتصفح لا يستطيع تعديل النقاط أو الحالة مباشرة.

## النشر على GitHub Pages
النشر تلقائي: كل `push` إلى فرع `main` يبني الموقع وينشره عبر GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)).

مرة واحدة فقط: من إعدادات المستودع **Settings → Pages → Build and deployment → Source** اختر **GitHub Actions**.

الرابط: `https://<اسم-الحساب>.github.io/<اسم-المستودع>/`

> رابط المشروع والمفتاح العام موجودان في ملف النشر. المفتاح العام (publishable) آمن للنشر لأنه يظهر في المتصفح أصلاً؛ الحماية الحقيقية في قواعد قاعدة البيانات (RLS والدوال).
