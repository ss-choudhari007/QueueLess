import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History as HistoryIcon } from 'lucide-react';
import { api } from '../../lib/api.js';
import { STATUS_META, formatDate, formatTime } from '../../lib/format.js';
import { useDocumentTitle, useResource } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Spinner, StatusBadge } from '../../components/ui/index.jsx';

export default function HistoryPage() {
  useDocumentTitle('Queue history');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, retry } = useResource(
    () => api.get('/api/customer/tokens/history', { status, page, pageSize: 10 }),
    [status, page]
  );

  return (
    <Container size="lg">
      <PageHeader
        title="Queue history"
        description="Every token you’ve held, newest first."
        actions={
          <div className="w-44">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <Card>
        {loading && !data ? (
          <div className="py-12 text-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={retry} />
        ) : data.tokens.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title={status ? 'No tokens with this status' : 'No queue history yet'}
            description="Tokens you join will be listed here."
            action={!status && <ButtonLink to="/orgs">Find a queue</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.tokens.map((t) => (
              <li key={t.id}>
                <Link to={`/app/tokens/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-slate-50">
                  <span className="w-20 font-mono text-sm font-bold text-navy-900">{t.displayNumber}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy-900">{t.service.name}</span>
                    <span className="block truncate text-xs text-slate-500">{t.organization.name}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDate(t.serviceDate)} · {formatTime(t.createdAt)}
                  </span>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />}
    </Container>
  );
}
