const ROWS = 6;

export default function Loading() {
  return (
    <div className="container home" aria-busy="true">
      <p className="visually-hidden" role="status">
        Carregando o changelog…
      </p>
      <div className="intro" aria-hidden="true">
        <span className="skeleton" style={{ height: 40, width: "min(32rem, 100%)" }} />
        <span className="skeleton" style={{ height: 20, width: "min(40rem, 90%)" }} />
      </div>
      <div className="home__filters" aria-hidden="true">
        <div className="panel filters">
          <span className="skeleton" style={{ height: 18, width: 64 }} />
          <span className="skeleton" style={{ height: 40 }} />
          <span className="skeleton" style={{ height: 40 }} />
          <span className="skeleton" style={{ height: 40 }} />
        </div>
      </div>
      <div className="home__results" aria-hidden="true">
        <span className="skeleton" style={{ height: 46, borderRadius: 12 }} />
        <span className="skeleton" style={{ height: 20, width: 120 }} />
        <ul className="feed">
          {Array.from({ length: ROWS }, (_, i) => (
            <li className="entry" key={i}>
              <span className="skeleton" style={{ height: 40 }} />
              <span style={{ display: "grid", gap: 8 }}>
                <span className="skeleton" style={{ height: 20, width: 96 }} />
                <span className="skeleton" style={{ height: 22, width: "80%" }} />
                <span className="skeleton" style={{ height: 16 }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
