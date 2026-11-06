import { Suspense } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { Home } from "@/components/Home";

export default function Page() {
  return (
    <ClientOnly>
      {/* Home يقرأ ?from= بـ useSearchParams، فيحتاج حدّ Suspense في التصدير الثابت */}
      <Suspense>
        <Home />
      </Suspense>
    </ClientOnly>
  );
}
