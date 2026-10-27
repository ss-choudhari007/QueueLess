import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  BellRing,
  Building2,
  CheckCheck,
  Clock,
  Hourglass,
  Megaphone,
  PauseCircle,
  PlayCircle,
  QrCode,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { ACTION_LABELS, ROLE_LABEL, formatCountdown, formatDateTime, formatMinutes, formatTime } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  useDebounced,
  useDocumentTitle,
  useNow,
  useOnConnect,
  useResource,
  useRoom,
  useSocketEvent,
  useSocketStatus,
} from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LiveIndicator,
  Modal,
  PageHeader,
  PageLoader,
  Stat,
  StatusBadge,
  Textarea,
  cx,
} from '../../components/ui/index.jsx';
import ScannerModal from './Scanner.jsx';

export function StaffHome() {
  useDocumentTitle('Queue console');
  const { user } = useAuth();
  if (user.organizations.length === 1) return <Navigate to={`/staff/${user.organizations[0].id}`} replace />;
  return (
    <Container size="lg">
      <PageHeader title="Queue console" description="Choose the organization you are working for." />
      {user.organizations.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={user.role === 'OWNER' ? 'Create an organization first' : 'No organization access yet'}
            description={
              user.role === 'OWNER'
                ? 'Set up your organization and services, then run its queue from here.'
                : 'Ask an organization owner to send you a staff invitation link.'
            }
            action={user.role === 'OWNER' && <ButtonLink to="/owner/new">Create organization</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {user.organizations.map((o) => (
            <ButtonLink key={o.id} to={`/staff/${o.id}`} variant="secondary" className="h-auto justify-between px-5 py-4 text-left">
              <span className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-brand-600" aria-hidden />
                <span>
                  <span className="block font-semibold text-navy-900">{o.name}</span>
                  <span className="block text-xs font-normal text-slate-500">{ROLE_LABEL[o.access]}</span>
                </span>
              </span>
            </ButtonLink>
          ))}
        </div>
      )}
    </Container>
  );
}

function ReasonModal({ open, title, description, confirmLabel, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert tone="error">{error.message}</Alert>}
        <Textarea
          label="Reason (recorded in the audit log)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          required
          error={error?.fields?.reason}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CounterCard({ token, now, busy, onAction, onScan, canSupervise }) {
  const deadline = token.noShowDeadline ? new Date(token.noShowDeadline) - now : null;
  const graceOver = deadline !== null && deadline <= 0;
  let arrival;
  if (token.status === 'SERVING') arrival = { tone: 'indigo', text: `Serving since ${formatTime(token.servingAt)}` };
  else if (token.arrivalConfirmedAt) arrival = { tone: 'green', text: 'Arrival confirmed' };
  else if (token.arrivalRequestedAt) arrival = { tone: 'blue', text: 'Waiting for customer to confirm' };
  else arrival = { tone: 'slate', text: 'Not checked in yet' };

  return (
    <div className={cx('rounded-xl border p-4', token.status === 'SERVING' ? 'border-indigo-200 bg-indigo-50/40' : 'border-amber-200 bg-amber-50/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-3xl font-extrabold tracking-tight text-navy-900">{token.displayNumber}</p>
          <p className="text-sm font-medium text-slate-700">{token.customerName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={token.status} />
          <Badge tone={arrival.tone}>{arrival.text}</Badge>
        </div>
      </div>
      {token.status === 'CALLED' && !token.arrivalConfirmedAt && (
        <p className={cx('mt-2 flex items-center gap-1.5 text-sm', graceOver ? 'font-semibold text-red-700' : 'text-slate-600')}>
          <Clock className="h-4 w-4" aria-hidden />
          {graceOver ? 'Grace period ended' : `Grace period: ${formatCountdown(deadline)} left`}
          <span className="text-xs text-slate-400">(called {formatTime(token.calledAt)})</span>
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {token.status === 'CALLED' && !token.arrivalConfirmedAt && !graceOver && (
          <Button size="sm" variant="secondary" icon={QrCode} onClick={() => onScan(token.id)}>
            Scan / enter code
          </Button>
        )}
        {token.status === 'CALLED' && (
          <Button
            size="sm"
            variant="success"
            icon={PlayCircle}
            disabled={!token.arrivalConfirmedAt}
            title={token.arrivalConfirmedAt ? undefined : 'Available after the customer confirms arrival'}
            loading={busy === `start:${token.id}`}
            onClick={() => onAction('start', token)}
          >
            Start service
          </Button>
        )}
        {token.status === 'SERVING' && (
          <Button size="sm" icon={CheckCheck} loading={busy === `complete:${token.id}`} onClick={() => onAction('complete', token)}>
            Complete
          </Button>
        )}
        {token.status === 'CALLED' && !token.arrivalConfirmedAt && (
          <Button
            size="sm"
            variant="danger-outline"
            icon={UserX}
            disabled={!graceOver}
            title={graceOver ? undefined : 'Available after the grace period ends'}
            loading={busy === `no-show:${token.id}`}
            onClick={() => onAction('no-show', token)}
          >
            Mark no-show
          </Button>
        )}
        {token.status === 'CALLED' && !token.arrivalConfirmedAt && canSupervise && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onAction('revert', token)}>
            Revert call
          </Button>
        )}
      </div>
      {token.status === 'CALLED' && !token.arrivalConfirmedAt && !graceOver && (
        <p className="mt-2 text-xs text-slate-500">No-show can be marked once the grace period ends (the system also does this automatically).</p>
      )}
    </div>
  );
}

function ActivityLog({ orgId }) {
  const { data, error, loading, retry } = useResource(() => api.get(`/api/staff/orgs/${orgId}/audit`, { limit: 40 }), [orgId]);
  return (
    <Card>
      <CardHeader title="Activity log" description="Recent queue and administrative changes (supervisors and owners)." action={<Button size="sm" variant="secondary" onClick={retry}>Refresh</Button>} />
      {loading && !data ? (
        <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : data.entries.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" />
      ) : (
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-sm">
              <span>
                <span className="font-medium text-navy-900">{ACTION_LABELS[e.action] || e.action}</span>
                <span className="text-slate-500"> · {e.actor.name}</span>
                {e.details?.reason && <span className="block text-xs text-slate-500">Reason: {e.details.reason}</span>}
              </span>
              <span className="text-xs text-slate-400 tabular-nums">{formatDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function StaffConsole() {
  const { orgId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const now = useNow(1000);
  const connected = useSocketStatus();
  const serviceId = params.get('service') || undefined;
  const [busy, setBusy] = useState(null);
  const [scanner, setScanner] = useState({ open: false, tokenId: null });
  const [correction, setCorrection] = useState(null);
  const [tab, setTab] = useState('queue');

  const { data, error, loading, reload, retry } = useResource(() => api.get(`/api/staff/orgs/${orgId}/queue`, { serviceId }), [orgId, serviceId]);
  useDocumentTitle(data ? `${data.organization.name} queue` : 'Queue console');
  const room = useRoom('org', orgId);
  const refresh = useDebounced(reload, 200);
  useSocketEvent('queue:updated', (p) => p.orgId === orgId && refresh());
  useSocketEvent('arrival:confirmed', (p) => {
    toast.success(`${p.displayNumber} confirmed arrival — you can start service.`);
    refresh();
  });
  useOnConnect(() => data && reload());

  const queue = data?.queue;
  const counter = useMemo(() => (queue ? [...queue.called, ...queue.serving] : []), [queue]);

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      const result = await fn();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      await reload();
      return result;
    } catch (err) {
      toast.error(err.message);
      reload();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const base = `/api/staff/orgs/${orgId}`;
  const callNext = () =>
    run('call', () => api.post(`${base}/services/${queue.service.id}/call-next`), (r) => `Called ${r.token.displayNumber} (${r.token.customerName}).`);
  const togglePause = () =>
    run('pause', () => api.post(`${base}/services/${queue.service.id}/pause`, { paused: !queue.service.isPaused }), queue.service.isPaused ? 'Queue resumed.' : 'Queue paused — new joins and calls are blocked.');

  const onAction = (action, token) => {
    if (action === 'revert') return setCorrection({ type: 'revert', token });
    const labels = { start: 'Service started', complete: 'Service completed', 'no-show': 'Marked as no-show' };
    return run(`${action}:${token.id}`, () => api.post(`${base}/tokens/${token.id}/${action}`), `${labels[action]} for ${token.displayNumber}.`);
  };

  if (loading && !data) return <PageLoader label="Loading queue" />;
  if (error) {
    return (
      <Container size="md">
        <Card>
          <ErrorState
            error={error}
            title={error.status === 403 ? 'No access to this organization' : error.status === 404 ? 'Organization not found' : undefined}
            onRetry={error.status >= 500 || error.status === 0 ? retry : undefined}
          />
        </Card>
      </Container>
    );
  }

  const { access } = data;
  return (
    <Container>
      <PageHeader
        eyebrow={`${ROLE_LABEL[access.role]} · ${data.organization.name}`}
        title="Queue console"
        description={`Service date ${data.serviceDate} · grace period ${data.graceMinutes} min after each call`}
        actions={
          <div className="flex items-center gap-3">
            <LiveIndicator connected={connected && room.joined} />
            {user.organizations.length > 1 && (
              <select className="input h-9 w-auto py-1" aria-label="Switch organization" value={orgId} onChange={(e) => navigate(`/staff/${e.target.value}`)}>
                {user.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {data.services.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No active services"
            description={access.isOwner ? 'Add a service in your organization settings to start a queue.' : 'An owner needs to add a service before customers can join.'}
            action={access.isOwner && <ButtonLink to={`/owner/orgs/${orgId}/services`}>Manage services</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Services">
            {data.services.map((s) => {
              const selected = queue?.service.id === s.id;
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setParams({ service: s.id })}
                  className={cx(
                    'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                    selected ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  )}
                >
                  {s.name}
                  <span className={cx('rounded-full px-1.5 text-xs', selected ? 'bg-white/15' : 'bg-slate-100 text-slate-600')}>{s.counts.waiting}</span>
                  {s.isPaused && <PauseCircle className="h-3.5 w-3.5 text-amber-500" aria-label="Paused" />}
                </button>
              );
            })}
            {access.canSupervise && (
              <button
                role="tab"
                aria-selected={tab === 'activity'}
                onClick={() => setTab(tab === 'activity' ? 'queue' : 'activity')}
                className={cx('ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium', tab === 'activity' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden /> Activity log
              </button>
            )}
          </div>

          {tab === 'activity' ? (
            <ActivityLog orgId={orgId} />
          ) : (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Waiting" value={queue.service.counts.waiting} icon={Users} />
                <Stat label="At counter" value={queue.service.counts.called + queue.service.counts.serving} icon={BellRing} tone="amber" />
                <Stat label="Completed" value={queue.service.counts.completed} icon={CheckCheck} tone="green" />
                <Stat label="No-shows" value={queue.service.counts.noShow} icon={UserX} tone="red" />
                <Stat
                  label="Est. wait (new)"
                  value={queue.status.waitingCount ? `~${formatMinutes(queue.status.estimatedWaitMinutes)}` : '—'}
                  hint={`avg ${formatMinutes(queue.status.averageServiceMinutes)} / customer`}
                  icon={Hourglass}
                  tone="slate"
                />
              </div>

              {queue.service.isPaused && (
                <Alert tone="warning" icon={PauseCircle} title="This queue is paused" className="mb-4">
                  New customers cannot join and the next token cannot be called. Customers already in line keep their place.
                </Alert>
              )}

              <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                <div className="space-y-6">
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        size="lg"
                        icon={Megaphone}
                        onClick={callNext}
                        loading={busy === 'call'}
                        disabled={queue.service.isPaused || queue.waiting.length === 0}
                        title={queue.waiting.length === 0 ? 'Nobody is waiting' : undefined}
                      >
                        Call next{queue.waiting[0] ? ` (${queue.waiting[0].displayNumber})` : ''}
                      </Button>
                      <Button variant="secondary" size="lg" icon={QrCode} onClick={() => setScanner({ open: true, tokenId: null })}>
                        Scan QR
                      </Button>
                      {access.canSupervise ? (
                        <Button variant="ghost" icon={queue.service.isPaused ? PlayCircle : PauseCircle} onClick={togglePause} loading={busy === 'pause'}>
                          {queue.service.isPaused ? 'Resume queue' : 'Pause queue'}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">Pausing requires a supervisor or owner.</span>
                      )}
                    </div>
                    {queue.waiting.length === 0 && !queue.service.isPaused && <p className="mt-3 text-sm text-slate-500">Nobody is waiting right now.</p>}
                  </Card>

                  <section aria-labelledby="counter-heading">
                    <h2 id="counter-heading" className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                      At the counter
                    </h2>
                    {counter.length === 0 ? (
                      <Card>
                        <EmptyState icon={UserCheck} title="No one is at the counter" description="Call the next customer to begin." />
                      </Card>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {counter.map((t) => (
                          <CounterCard
                            key={t.id}
                            token={t}
                            now={now}
                            busy={busy}
                            canSupervise={access.canSupervise}
                            onAction={onAction}
                            onScan={(tokenId) => setScanner({ open: true, tokenId })}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <Card>
                    <CardHeader title="Finished today" description="Most recent first." />
                    {queue.recent.length === 0 ? (
                      <p className="px-5 py-6 text-sm text-slate-500">Nothing finished yet today.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {queue.recent.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                            <span className="w-16 font-mono font-bold text-navy-900">{t.displayNumber}</span>
                            <span className="min-w-0 flex-1 truncate text-slate-700">{t.customerName}</span>
                            <StatusBadge status={t.status} />
                            {t.noShowExcused && <Badge tone="green">Excused</Badge>}
                            {t.status === 'NO_SHOW' && !t.noShowExcused && access.canSupervise && (
                              <Button size="sm" variant="ghost" onClick={() => setCorrection({ type: 'excuse', token: t })}>
                                Excuse
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                <Card className="self-start">
                  <CardHeader title={`Waiting (${queue.waiting.length})`} description="Called in token order." />
                  {queue.waiting.length === 0 ? (
                    <EmptyState icon={Users} title="Queue is empty" description="New customers appear here instantly." />
                  ) : (
                    <ol className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                      {queue.waiting.map((t, i) => (
                        <li key={t.id} className={cx('flex items-center gap-3 px-5 py-3 text-sm', i === 0 && 'bg-brand-50/50')}>
                          <span className="w-16 font-mono font-bold text-navy-900">{t.displayNumber}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-700">{t.customerName}</span>
                          <span className="text-xs text-slate-400 tabular-nums">{formatTime(t.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
      )}

      <ScannerModal
        open={scanner.open}
        initialTokenId={scanner.tokenId}
        onClose={() => setScanner({ open: false, tokenId: null })}
        orgId={orgId}
        calledTokens={queue ? queue.called.filter((t) => !t.arrivalConfirmedAt) : []}
        onVerified={() => reload()}
      />
      <ReasonModal
        open={correction?.type === 'revert'}
        title={`Revert call for ${correction?.token.displayNumber}?`}
        description="Use this when a token was called by mistake. It returns to the waiting list in its original position."
        confirmLabel="Revert call"
        onClose={() => setCorrection(null)}
        onSubmit={async (reason) => {
          await api.post(`${base}/tokens/${correction.token.id}/revert-call`, { reason });
          toast.success(`${correction.token.displayNumber} is back in the waiting list.`);
          setCorrection(null);
          reload();
        }}
      />
      <ReasonModal
        open={correction?.type === 'excuse'}
        title={`Excuse no-show ${correction?.token.displayNumber}?`}
        description="An excused no-show stays in history but no longer counts towards the customer's restriction."
        confirmLabel="Excuse no-show"
        onClose={() => setCorrection(null)}
        onSubmit={async (reason) => {
          const res = await api.post(`${base}/tokens/${correction.token.id}/excuse-no-show`, { reason });
          toast.success(res.restrictionsLifted ? 'No-show excused and the customer’s restriction was lifted.' : 'No-show excused.');
          setCorrection(null);
          reload();
        }}
      />
    </Container>
  );
}
