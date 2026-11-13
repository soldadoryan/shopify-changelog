export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <p>
          <strong>Não oficial — não afiliado à Shopify.</strong> Projeto independente, sem vínculo com a Shopify
          Inc. Shopify é marca de seus respectivos titulares.
        </p>
        <p>
          Conteúdo de{" "}
          <a href="https://shopify.dev/changelog" target="_blank" rel="noopener noreferrer">
            shopify.dev/changelog
            <span className="visually-hidden"> (abre em nova aba)</span>
          </a>
          , exibido para consulta. Resumos em português são gerados por IA; confira sempre a fonte original antes
          de agir.
        </p>
      </div>
    </footer>
  );
}
