"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Falha ao renderizar o changelog", error);
  }, [error]);

  return (
    <div className="container page-narrow">
      <section className="panel empty" role="alert">
        <h1 className="empty__title">Changelog indisponível no momento</h1>
        <p>
          Não conseguimos carregar os dados agora. Tente de novo em instantes ou consulte o changelog direto no
          shopify.dev.
        </p>
        <div className="filters__actions">
          <button type="button" className="button button--primary" onClick={() => reset()}>
            Tentar novamente
          </button>
          <a href="https://shopify.dev/changelog" target="_blank" rel="noopener noreferrer">
            Abrir shopify.dev/changelog
            <span className="visually-hidden"> (abre em nova aba)</span>
          </a>
        </div>
      </section>
    </div>
  );
}
