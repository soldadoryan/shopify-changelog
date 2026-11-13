export default function Loading() {
  return (
    <div className="container" aria-busy="true">
      <p className="visually-hidden" role="status">
        Carregando o item…
      </p>
      <div className="article-head" aria-hidden="true" style={{ paddingTop: 56 }}>
        <span className="skeleton" style={{ height: 20, width: 96 }} />
        <span className="skeleton" style={{ height: 44, width: "min(40rem, 100%)" }} />
        <span className="skeleton" style={{ height: 18, width: 240 }} />
      </div>
      <div className="article" aria-hidden="true">
        <div className="panel article__main">
          {[100, 96, 88, 100, 72].map((w, i) => (
            <span key={i} className="skeleton" style={{ height: 18, width: `${w}%` }} />
          ))}
        </div>
        <div className="panel facts article__facts">
          <span className="skeleton" style={{ height: 18, width: 80 }} />
          <span className="skeleton" style={{ height: 60 }} />
        </div>
      </div>
    </div>
  );
}
