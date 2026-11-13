import Link from "next/link";
import Icon from "./Icon";

export default function Header() {
  return (
    <header className="topbar">
      <div className="container topbar__inner">
        <Link href="/" className="brand">
          <span className="brand__mark">
            <Icon name="log" />
          </span>
          <span className="brand__text">
            <span className="brand__name">Changelog Shopify Dev</span>
            <span className="brand__tag">Não oficial</span>
          </span>
        </Link>
        <nav className="topbar__nav" aria-label="Principal">
          <a href="https://shopify.dev/changelog" target="_blank" rel="noopener noreferrer">
            <span className="topbar__label">Fonte original</span>
            <Icon name="external" />
            <span className="visually-hidden"> (abre em nova aba)</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
