"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** يعرض المحتوى في المتصفح فقط (الصفحات تعتمد على الجلسة والتخزين المحلي) */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return mounted ? children : fallback;
}
