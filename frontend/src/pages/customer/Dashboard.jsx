import { Link } from 'react-router-dom';
import { ChevronRight, Search, ShieldAlert, Ticket } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatMinutes, formatTime } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebounced, useDocumentTitle, useOnConnect, useResource, useSocketEvent } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { ServiceRoom } from './components.jsx';
import { Alert, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageLoader, StatusBadge } from '../../components/ui/index.jsx';

export default function CustomerDashboard() {
  useDocumentTitle('My tokens');
  const { user } = useAuth();
  const { data, error, loading, reload, retry } = useResource(async () => {
    const [active, restrictions] = await Promise.all([
      api.get('/api/customer/tokens/active'),
      api.get('/api/customer/restrictions'),
    ]);
    return { tokens: active.tokens, restrictions: restrictions.restrictions };
  }, []);
  const refresh = useDebounced(reload, 300);
  useSocketEvent('token:updated', refresh);
  useSocketEvent('queue:updated', refresh);
  useOnConnect(() => data && reload());

  return (
    <Container size="lg">
      {[...new Set((data?.tokens || []).map((t) => t.service.id))].map((id) => (
        <ServiceRoom key={id} serviceId={id} />
      ))}
      <PageHeader
        eyebrow={`Hi, ${user.name.split(' ')[0]}`}
        title="My tokens"
        description="Your active places in line. Positions and estimates update live."
        actions={<ButtonLink to="/orgs" icon={Search}>Join a queue</ButtonLink>}
      />
      {loading && !data ? (
        <PageLoader label="Loading your tokens" />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={retry} />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.restrictions.map((r) => (
            <Alert key={r.id} tone="warning" icon={ShieldAlert} title={`Joining restricted at ${r.organization.name}`}>
              Because of repeated no-shows you can join this organization’s queues again after {new Date(r.endsAt).toLocaleString()}. Other
              organizations are not affected.
            </Alert>
          ))}
          {data.tokens.length === 0 ? (
            <Card>
              <EmptyState
                icon={Ticket}
                title="No active tokens"
                description="When you join a queue your token will appear here with your live position."
                action={<ButtonLink to="/orgs" icon={Search}>Find a queue</ButtonLink>}
              />
            </Card>
          ) : (
            data.tokens.map((t) => (
              <Link
                key={t.id}
                to={`/app/tokens/${t.id}`}
                className={`card flex items-center gap-4 p-5 transition hover:shadow-md ${t.status === 'CALLED' ? 'border-amber-300 ring-2 ring-amber-200' : 'hover:border-brand-200'}`}
              >
                <div className="flex h-16 w-20 shrink-0 flex-col items-center justify-center rounded-lg bg-navy-900 text-white">
                  <span className="text-[10px] tracking-wide text-slate-300 uppercase">Token</span>
                  <span className="text-lg font-extrabold">{t.displayNumber}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-navy-900">{t.service.name}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="truncate text-sm text-slate-500">{t.organization.name}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {t.status === 'WAITING' &&
                      (t.queue.peopleAhead === 0 ? 'You’re next in line.' : `${t.queue.peopleAhead} ahead · ~${formatMinutes(t.queue.estimatedWaitMinutes)} estimated`)}
                    {t.status === 'CALLED' &&
                      (t.arrivalConfirmedAt
                        ? 'Arrival confirmed — service will start shortly.'
                        : `It’s your turn! Check in before ${formatTime(t.noShowDeadline)}.`)}
                    {t.status === 'SERVING' && 'You are being served.'}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden />
              </Link>
            ))
          )}
          <p className="text-right text-sm">
            <Link to="/app/history" className="font-medium text-brand-700 hover:underline">
              View queue history →
            </Link>
          </p>
        </div>
      )}
    </Container>
  );
}
