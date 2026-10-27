import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Clock, MapPin, Search, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { hoursLabel } from '../../lib/format.js';
import { useDocumentTitle, useResource } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Spinner } from '../../components/ui/index.jsx';

export default function Browse() {
  useDocumentTitle('Find a queue');
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get('search') || '',
    category: params.get('category') || '',
    city: params.get('city') || '',
    openNow: params.get('openNow') === 'true' ? 'true' : '',
    page: Number(params.get('page')) || 1,
  };
  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);

  const { data, error, loading, retry } = useResource(
    () => api.get('/api/orgs', { ...filters, pageSize: 12 }),
    [filters.search, filters.category, filters.city, filters.openNow, filters.page]
  );

  const update = (patch) => {
    const next = { ...filters, page: 1, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([k, v]) => v && !(k === 'page' && v === 1)));
    setParams(clean);
  };

  return (
    <Container>
      <PageHeader title="Find a queue" description="Search organizations, check live waiting times and join from your phone." />
      <Card className="mb-6 p-4">
        <form
          className="grid gap-3 md:grid-cols-[1fr_200px_180px_auto_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            update({ search: searchText.trim() });
          }}
          role="search"
        >
          <div>
            <label htmlFor="search" className="label">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden />
              <input
                id="search"
                className="input pl-9"
                placeholder="Organization, service or city"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                maxLength={80}
              />
            </div>
          </div>
          <Select label="Category" value={filters.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {data?.filters.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select label="City" value={filters.city} onChange={(e) => update({ city: e.target.value })}>
            <option value="">All cities</option>
            {data?.filters.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={filters.openNow === 'true'}
              onChange={(e) => update({ openNow: e.target.checked ? 'true' : '' })}
            />
            Open now
          </label>
          <Button type="submit" icon={Search}>
            Search
          </Button>
        </form>
      </Card>

      {loading && !data ? (
        <div className="py-16 text-center">
          <Spinner label="Loading organizations" />
        </div>
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={retry} />
        </Card>
      ) : data.organizations.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No organizations match"
            description={
              filters.search || filters.category || filters.city || filters.openNow
                ? 'Try removing a filter or searching for something else.'
                : 'No organizations have joined QueueLess yet.'
            }
            action={
              (filters.search || filters.category || filters.city || filters.openNow) && (
                <Button variant="secondary" onClick={() => setParams({})}>
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {data.pagination.total} organization{data.pagination.total === 1 ? '' : 's'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.organizations.map((org) => (
              <Link key={org.id} to={`/orgs/${org.slug}`} className="card group flex flex-col p-5 transition hover:border-brand-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-navy-900 group-hover:text-brand-700">{org.name}</h2>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {org.city || 'Location not listed'}
                    </p>
                  </div>
                  <Badge tone={org.isOpenNow ? 'green' : 'slate'}>{org.isOpenNow ? 'Open now' : 'Closed'}</Badge>
                </div>
                {org.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{org.description}</p>}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Badge tone="blue">{org.category}</Badge>
                  {org.services.slice(0, 3).map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                  {org.services.length > 3 && <Badge>+{org.services.length - 3} more</Badge>}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {org.waitingNow} waiting now
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    Today: {hoursLabel(org.todayHours)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={(page) => update({ page })} />
        </>
      )}
    </Container>
  );
}
