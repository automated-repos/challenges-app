import { ClientOnly } from "@/components/ClientOnly";
import { Home } from "@/components/Home";

export default function Page() {
  return (
    <ClientOnly>
      <Home />
    </ClientOnly>
  );
}
