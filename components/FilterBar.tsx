import Link from "next/link";
import Icon from "./Icon";
import { listHref } from "./href";

export type Facet = { value: string; n: number };

export type FilterValues = {
  q?: string;
  type?: string;
  area?: string;
  version?: string;
};

type FilterBarProps = {
  facets: { areas: Facet[]; versions: Facet[] };
  values: FilterValues;
  action?: string;
};

function Select({
  id,
  label,
  name,
  all,
  options,
  value,
}: {
  id: string;
  label: string;
  name: string;
  all: string;
  options: Facet[];
  value?: string;
}) {
  const known = !value || options.some((o) => o.value === value);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} className="select" defaultValue={value ?? ""}>
        <option value="">{all}</option>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.n})
          </option>
        ))}
      </select>
    </div>
  );
}

export default function FilterBar({ facets, values, action = "/" }: FilterBarProps) {
  const hasFilters = Boolean(values.q || values.area || values.version);
  return (
    <form method="get" action={action} role="search" aria-labelledby="filtros-titulo" className="panel filters">
      <h2 className="filters__heading" id="filtros-titulo">
        Filtrar
      </h2>
      {values.type ? <input type="hidden" name="type" value={values.type} /> : null}
      <div className="filters__fields">
        <div className="field">
          <label className="field__label" htmlFor="f-q">
            Buscar
          </label>
          <div className="input-icon">
            <Icon name="search" />
            <input
              id="f-q"
              name="q"
              type="search"
              className="input"
              defaultValue={values.q ?? ""}
              placeholder="Ex.: webhooks, checkout"
              maxLength={200}
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
        </div>
        <Select
          id="f-area"
          label="Área"
          name="area"
          all="Todas"
          value={values.area}
          options={facets.areas}
        />
        <Select
          id="f-version"
          label="Versão da API"
          name="version"
          all="Todas"
          value={values.version}
          options={facets.versions}
        />
      </div>
      <div className="filters__actions">
        <button type="submit" className="button button--primary">
          Filtrar
        </button>
        {hasFilters ? (
          <Link className="filters__clear" href={listHref({ type: values.type }, action)}>
            Limpar
          </Link>
        ) : null}
      </div>
    </form>
  );
}
