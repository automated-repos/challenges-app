export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="text-5xl">⚙️</div>
      <h1 className="mt-4 text-2xl font-bold">لم يتم ربط Supabase بعد</h1>
      <p className="mt-3 text-indigo-200">
        انسخ الملف <code dir="ltr">.env.local.example</code> إلى <code dir="ltr">.env.local</code> وضع فيه
        رابط المشروع والمفتاح العام، ثم أعد تشغيل الخادم.
      </p>
    </main>
  );
}
