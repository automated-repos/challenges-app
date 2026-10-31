export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-indigo-200">{label}</span>
      {children}
    </label>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{children}</p>;
}

export function Avatar({ emoji, size = "md" }: { emoji: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "sm" ? "h-8 w-8 text-lg" : size === "lg" ? "h-16 w-16 text-4xl" : "h-10 w-10 text-2xl";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 ${cls}`}>{emoji}</span>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-4 py-24 text-center text-indigo-200">{children}</main>;
}
