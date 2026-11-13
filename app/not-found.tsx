import type { Metadata } from "next";
import EmptyState from "@/components/EmptyState";

export const metadata: Metadata = { title: "Página não encontrada", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="container page-narrow">
      <EmptyState
        icon="search"
        title="Página não encontrada"
        description="O item ou a página que você procura não existe ou mudou de endereço."
        action={{ href: "/", label: "Voltar ao changelog" }}
      />
    </div>
  );
}
