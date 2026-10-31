import { ClientOnly } from "@/components/ClientOnly";
import { HistoryPage } from "@/components/history/HistoryPage";

export default function Page() {
  return (
    <ClientOnly>
      <HistoryPage />
    </ClientOnly>
  );
}
