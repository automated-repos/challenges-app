import { Suspense } from "react";
import { RoomPage } from "@/components/room/Room";

export default function Page() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-indigo-200">جارٍ التحميل...</p>}>
      <RoomPage />
    </Suspense>
  );
}
