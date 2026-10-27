import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BellRing, CheckCircle2, Clock, Hourglass, MapPin, PauseCircle, UserCheck, Users, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatCountdown, formatDate, formatMinutes, formatTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounced, useDocumentTitle, useNow, useOnConnect, useResource, useSocketEvent, useSocketStatus } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { Alert, Button, Card, ConfirmDialog, ErrorState, LiveIndicator, PageLoader, StatusBadge } from '../../components/ui/index.jsx';
import { QrPanel, ServiceRoom, confirmArrival } from './components.jsx';

function Hero({ token, now }) {
  const deadlineMs = token.noShowDeadline ? new Date(token.noShowDeadline) - now : 0;
  switch (token.status) {
    case 'WAITING':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Users className="h-3.5 w-3.5" aria-hidden /> People ahead
            </p>
            <p className="mt-1 text-3xl font-bold text-navy-900 tabular-nums">{token.queue.peopleAhead}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Hourglass className="h-3.5 w-3.5" aria-hidden /> Estimated wait
            </p>
            <p className="mt-1 text-3xl font-bold text-navy-900">
              {token.queue.estimatedWaitMinutes ? `~${formatMinutes(token.queue.estimatedWaitMinutes)}` : 'Soon'}
            </p>
          </div>
          <p className="col-span-2 text-xs text-slate-500">
            Estimate only — based on {token.queue.estimateBasis === 'recent' ? 'today’s actual service times' : 'the typical service duration'}. Actual
            times can vary.
          </p>
        </div>
      );
    case 'CALLED':
      if (token.arrivalConfirmedAt) {
        return (
          <Alert tone="success" icon={UserCheck} title="Arrival confirmed">
            Thanks! Staff will start your service in a moment.
          </Alert>
        );
      }
      return (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-950">
          <p className="flex items-center gap-2 text-lg font-bold">
            <BellRing className="h-5 w-5" aria-hidden /> It’s your turn — please go to the counter
          </p>
          <p className="mt-1 text-sm">
            Show your QR code to staff. Confirm your arrival before <strong>{formatTime(token.noShowDeadline)}</strong>.
          </p>
          <p className="mt-3 text-3xl font-extrabold tabular-nums" aria-live="polite">
            {deadlineMs > 0 ? formatCountdown(deadlineMs) : 'Grace period ended'}
          </p>
          {deadlineMs <= 0 && <p className="mt-1 text-xs">Please speak to staff — this token may be marked as a no-show.</p>}
        </div>
      );
    case 'SERVING':
      return (
        <Alert tone="info" icon={UserCheck} title="You are being served">
          Service started at {formatTime(token.servingAt)}.
        </Alert>
      );
    case 'COMPLETED':
      return (
        <Alert tone="success" icon={CheckCircle2} title="Service completed">
          Completed at {formatTime(token.completedAt)}. Thanks for using QueueLess.
        </Alert>
      );
    case 'CANCELLED':
      return (
        <Alert tone="warning" icon={XCircle} title="Token cancelled">
          {token.cancellationReason === 'QUEUE_CLOSED'
            ? 'The queue closed for the day before this token was called.'
            : `You cancelled this token at ${formatTime(token.cancelledAt)}.`}
        </Alert>
      );
    case 'NO_SHOW':
      return (
        <Alert tone="error" icon={XCircle} title={token.noShowExcused ? 'No-show (excused by staff)' : 'Marked as a no-show'}>
          {token.noShowExcused
            ? 'Staff excused this no-show, so it does not count against you.'
            : 'Arrival was not confirmed within the grace period. Three no-shows within 30 days pause joining at this organization for 72 hours.'}
        </Alert>
      );
    default:
      return null;
  }
}

export default function TokenDetail() {
  const { tokenId } = useParams();
  const toast = useToast();
  const now = useNow(1000);
  const connected = useSocketStatus();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { data: token, setData, error, loading, reload, retry } = useResource(
    () => api.get(`/api/customer/tokens/${tokenId}`).then((d) => d.token),
    [tokenId]
  );
  const yourTurn = token?.status === 'CALLED' && !token.arrivalConfirmedAt;
  useDocumentTitle(token ? (yourTurn ? `🔔 ${token.displayNumber} — your turn!` : `${token.displayNumber} · ${token.service.name}`) : 'Token');

  const refresh = useDebounced(reload, 250);
  useSocketEvent('token:updated', ({ token: next }) => next?.id === tokenId && setData(next));
  useSocketEvent('queue:updated', (p) => token && p.serviceId === token.service.id && refresh());
  useSocketEvent('arrival:requested', (p) => p.tokenId === tokenId && reload());
  useOnConnect(() => token && reload());

  const doCancel = async () => {
    setBusy('cancel');
    setActionError(null);
    try {
      const { token: next } = await api.post(`/api/customer/tokens/${tokenId}/cancel`);
      setData(next);
      setCancelOpen(false);
      toast.success('Your token was cancelled. Cancelling in advance never counts as a no-show.');
    } catch (err) {
      setActionError(err);
      setCancelOpen(false);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const doConfirm = async () => {
    setBusy('confirm');
    setActionError(null);
    try {
      setData(await confirmArrival(tokenId));
      toast.success('Arrival confirmed.');
    } catch (err) {
      setActionError(err);
      reload();
    } finally {
      setBusy(null);
    }
  };

  if (loading && !token) return <PageLoader label="Loading your token" />;
  if (error) {
    return (
      <Container size="md">
        <Card>
          <ErrorState error={error} onRetry={error.status === 404 ? undefined : retry} title={error.status === 404 ? 'Token not found' : undefined} />
        </Card>
      </Container>
    );
  }

  const active = ['WAITING', 'CALLED', 'SERVING'].includes(token.status);
  const awaitingConfirm = token.status === 'CALLED' && token.arrivalRequestedAt && !token.arrivalConfirmedAt;
  // Once staff scanned the code it is spent; the confirmation prompt replaces it.
  const showQr = ['WAITING', 'CALLED'].includes(token.status) && !token.arrivalRequestedAt;

  return (
    <Container size="md">
      <ServiceRoom serviceId={token.service.id} />
      <div className="mb-4 flex items-center justify-between">
        <Link to="/app" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-navy-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> My tokens
        </Link>
        {active && <LiveIndicator connected={connected} />}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="bg-navy-900 px-6 py-6 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs tracking-wide text-slate-300 uppercase">{token.service.name}</p>
                  <p className="mt-1 text-5xl font-extrabold tracking-tight">{token.displayNumber}</p>
                </div>
                <StatusBadge status={token.status} className="bg-white! text-navy-900!" />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-300">
                <MapPin className="h-4 w-4" aria-hidden />
                <Link to={`/orgs/${token.organization.slug}`} className="hover:text-white hover:underline">
                  {token.organization.name}
                </Link>
              </p>
            </div>
            <div className="space-y-4 p-6">
              {actionError && <Alert tone="error">{actionError.message}</Alert>}
              {awaitingConfirm && (
                <div className="pulse-ring rounded-xl border border-brand-200 bg-brand-50 p-4">
                  <p className="font-semibold text-navy-900">Staff scanned your code</p>
                  <p className="mt-0.5 text-sm text-slate-600">Confirm that you are at the counter so your service can begin.</p>
                  <Button variant="success" size="lg" className="mt-3 w-full" icon={CheckCircle2} loading={busy === 'confirm'} onClick={doConfirm}>
                    I’m here
                  </Button>
                </div>
              )}
              <Hero token={token} now={now} />
              {active && token.queue && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                  <span>
                    At the counter: <strong className="text-navy-900">{token.queue.nowServing.length ? token.queue.nowServing.join(', ') : '—'}</strong>
                  </span>
                  {token.queue.isPaused && (
                    <span className="flex items-center gap-1 text-amber-700">
                      <PauseCircle className="h-4 w-4" aria-hidden /> Queue temporarily paused
                    </span>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-navy-900">Timeline</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {[
                ['Joined', token.createdAt],
                ['Called', token.calledAt],
                ['QR scanned', token.arrivalRequestedAt],
                ['Arrival confirmed', token.arrivalConfirmedAt],
                ['Service started', token.servingAt],
                ['Completed', token.completedAt],
                ['Cancelled', token.cancelledAt],
                ['No-show recorded', token.noShowAt],
              ]
                .filter(([, at]) => at)
                .map(([label, at]) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate-600">
                      <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      {label}
                    </span>
                    <span className="font-medium text-navy-900 tabular-nums">{formatTime(at)}</span>
                  </li>
                ))}
            </ol>
            <p className="mt-3 text-xs text-slate-400">Service date {formatDate(token.serviceDate)}</p>
          </Card>
        </div>

        <div className="space-y-4">
          {showQr && <QrPanel tokenId={token.id} emphasized={token.status === 'CALLED'} />}
          {token.canCancel && (
            <Card className="p-5">
              <p className="text-sm font-semibold text-navy-900">Can’t make it?</p>
              <p className="mt-0.5 text-xs text-slate-500">Cancelling before you’re called frees your spot and never counts as a no-show.</p>
              <Button variant="danger-outline" className="mt-3 w-full" onClick={() => setCancelOpen(true)}>
                Cancel token
              </Button>
            </Card>
          )}
          {token.status === 'CALLED' && !token.canCancel && (
            <p className="px-1 text-xs text-slate-500">Tokens can no longer be cancelled once they’re called.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title={`Cancel ${token.displayNumber}?`}
        description="You will lose your place in this queue. You can join again later, but you'll receive a new token number at the back of the line."
        confirmLabel="Cancel token"
        tone="danger"
        loading={busy === 'cancel'}
        onConfirm={doCancel}
        onClose={() => setCancelOpen(false)}
      />
    </Container>
  );
}
