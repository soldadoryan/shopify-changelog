import Link from "next/link";
import Icon from "./Icon";
import { listHref, type ListParams } from "./href";

type PaginationProps = {
  page: number;
  totalPages: number;
  basePath?: string;
  params?: Omit<ListParams, "page">;
};

export default function Pagination({ page, totalPages, basePath = "/", params = {} }: PaginationProps) {
  if (totalPages <= 1) return null;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  return (
    <nav className="pagination" aria-label="Paginação">
      <p className="pagination__status tabular">
        Página {page} de {totalPages}
      </p>
      <div className="pagination__links">
        {hasPrev ? (
          <Link className="button" href={listHref({ ...params, page: page - 1 }, basePath)} rel="prev">
            <Icon name="chevronLeft" />
            Anterior
          </Link>
        ) : (
          <span className="button" aria-disabled="true">
            <Icon name="chevronLeft" />
            Anterior
          </span>
        )}
        {hasNext ? (
          <Link className="button" href={listHref({ ...params, page: page + 1 }, basePath)} rel="next">
            Próxima
            <Icon name="chevronRight" />
          </Link>
        ) : (
          <span className="button" aria-disabled="true">
            Próxima
            <Icon name="chevronRight" />
          </span>
        )}
      </div>
    </nav>
  );
}
