import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Globe2, Mail, MapPin, Phone, Ticket, Timer, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { WEEKDAYS, formatMinutes, hoursLabel } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounced, useDocumentTitle, useOnConnect, useResource, useRoom, useSocketEvent } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageLoader } from '../../components/ui/index.jsx';

function ServiceWatcher({ serviceId }) {
  useRoom('service', serviceId);
  return null;
}

function ServiceCard({ service, onJoin, joining, user }) {
  const q = service.queue;
  const canCustomerJoin = !user || user.role === 'CUSTOMER';
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-navy-900">{service.name}</h3>
          {service.description && <p className="mt-0.5 text-sm text-slate-500">{service.description}</p>}
        </div>
        {q.isPaused ? <Badge tone="amber">Paused</Badge> : q.canJoin ? <Badge tone="green">Accepting tokens</Badge> : <Badge>Unavailable</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-[11px] text-slate-500">Waiting</dt>
          <dd className="text-lg font-bold text-navy-900 tabular-nums">{q.waitingCount}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-[11px] text-slate-500">Est. wait</dt>
          <dd className="text-lg font-bold text-navy-900">{q.waitingCount ? `~${formatMinutes(q.estimatedWaitMinutes)}` : 'None'}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-[11px] text-slate-500">Now serving</dt>
          <dd className="truncate text-lg font-bold text-navy-900">{q.nowServing[0] || '—'}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Average service ~{formatMinutes(q.averageServiceMinutes)}
        {q.estimateBasis === 'recent' ? ' (based on today)' : ''} · {q.issuedToday}/{q.dailyLimit} tokens issued today
      </p>
      <div className="mt-4">
        {!q.canJoin ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{q.unavailableMessage}</p>
        ) : !canCustomerJoin ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Sign in with a customer account to join queues.</p>
        ) : (
          <Button className="w-full" icon={Ticket} loading={joining} onClick={() => onJoin(service)}>
            Join queue
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function OrgDetail() {
  const { idOrSlug } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [joining, setJoining] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const { data, error, loading, reload, retry } = useResource(() => api.get(`/api/orgs/${idOrSlug}`), [idOrSlug]);
  useDocumentTitle(data?.organization.name);

  const refresh = useDebounced(reload, 300);
  useSocketEvent('queue:updated', (payload) => {
    if (data?.services.some((s) => s.id === payload.serviceId)) refresh();
  });
  useOnConnect(() => data && reload());

  const join = async (service) => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/orgs/${idOrSlug}`)}`);
      return;
    }
    setJoining(service.id);
    setJoinError(null);
    try {
      const { token } = await api.post('/api/customer/tokens', { serviceId: service.id });
      toast.success(`You’re in! Your token is ${token.displayNumber}.`);
      navigate(`/app/tokens/${token.id}`);
    } catch (err) {
      if (err.code === 'ALREADY_IN_QUEUE' && err.details?.tokenId) {
        toast.info('You already have a token for this service today.');
        navigate(`/app/tokens/${err.details.tokenId}`);
        return;
      }
      setJoinError(err);
      reload();
    } finally {
      setJoining(null);
    }
  };

  if (loading && !data) return <PageLoader label="Loading organization" />;
  if (error) {
    return (
      <Container size="md">
        <Card>
          <ErrorState error={error} onRetry={error.status === 404 ? undefined : retry} title={error.status === 404 ? 'Organization not found' : undefined} />
        </Card>
      </Container>
    );
  }

  const org = data.organization;
  return (
    <Container>
      {data.services.map((s) => (
        <ServiceWatcher key={s.id} serviceId={s.id} />
      ))}
      <Link to="/orgs" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-navy-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All organizations
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-navy-900">{org.name}</h1>
            <Badge tone={org.isOpenNow ? 'green' : 'slate'}>{org.isOpenNow ? 'Open now' : 'Closed now'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{org.category}</p>
          {org.description && <p className="mt-3 max-w-2xl text-slate-600">{org.description}</p>}
        </div>
      </div>

      {joinError && (
        <Alert
          tone={joinError.code === 'CUSTOMER_RESTRICTED' ? 'warning' : 'error'}
          title={joinError.code === 'CUSTOMER_RESTRICTED' ? 'Joining is temporarily restricted' : 'Could not join the queue'}
          className="mb-4"
        >
          {joinError.code === 'CUSTOMER_RESTRICTED' && joinError.details?.endsAt
            ? `Because of repeated no-shows you can join this organization's queues again after ${new Date(joinError.details.endsAt).toLocaleString()}. Other organizations are not affected.`
            : joinError.message}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="services-heading">
          <h2 id="services-heading" className="mb-3 text-lg font-semibold text-navy-900">
            Services
          </h2>
          {data.services.length === 0 ? (
            <Card>
              <EmptyState icon={Users} title="No services available" description="This organization has not published any services yet." />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {data.services.map((s) => (
                <ServiceCard key={s.id} service={s} user={user} joining={joining === s.id} onJoin={join} />
              ))}
            </div>
          )}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
            <Timer className="h-3.5 w-3.5" aria-hidden /> Waiting times are estimates based on the queue and typical service duration — not a guarantee.
          </p>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Contact" />
            <ul className="space-y-3 px-5 py-4 text-sm text-slate-600">
              {org.address && (
                <li className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  {org.address}
                </li>
              )}
              {org.phone && (
                <li className="flex gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <a href={`tel:${org.phone}`} className="hover:text-brand-700">
                    {org.phone}
                  </a>
                </li>
              )}
              {org.email && (
                <li className="flex gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <a href={`mailto:${org.email}`} className="hover:text-brand-700">
                    {org.email}
                  </a>
                </li>
              )}
              <li className="flex gap-2">
                <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                Times shown in {org.timezone}
              </li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Opening hours" />
            <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
              {(org.weeklyHours || []).map((day, i) => (
                <li key={WEEKDAYS[i]} className="flex justify-between py-2">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    {WEEKDAYS[i]}
                  </span>
                  <span className={day.closed ? 'text-slate-400' : 'font-medium text-navy-900'}>{hoursLabel(day)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {!user && (
            <Card className="p-5">
              <p className="text-sm text-slate-600">Sign in or create a free account to join a queue.</p>
              <div className="mt-3 flex gap-2">
                <ButtonLink to={`/login?next=/orgs/${idOrSlug}`} variant="secondary" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink to={`/register?next=/orgs/${idOrSlug}`} size="sm">
                  Create account
                </ButtonLink>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}
