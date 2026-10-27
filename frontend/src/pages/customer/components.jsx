import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { BellRing, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatCountdown } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useNow, useOnConnect, useRoom, useSocketEvent } from '../../hooks/index.js';
import { Alert, Button, Modal, Spinner } from '../../components/ui/index.jsx';

// Dynamic QR credential. Each credential is short-lived and single-use;
// the panel fetches a fresh one shortly before the current one expires.
export function QrPanel({ tokenId, emphasized }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const now = useNow(1000);
  const timer = useRef(null);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    if (document.visibilityState === 'hidden') return;
    try {
      const data = await api.post(`/api/customer/tokens/${tokenId}/qr`);
      setQr(data.qr);
      setError(null);
      const refreshIn = Math.max(new Date(data.qr.expiresAt) - Date.now() - 10_000, 5_000);
      timer.current = setTimeout(load, refreshIn);
    } catch (err) {
      setError(err);
    }
  }, [tokenId]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const remaining = qr ? new Date(qr.expiresAt) - now : 0;
  return (
    <div className={`rounded-xl border p-5 text-center ${emphasized ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200 bg-white'}`}>
      <p className="text-sm font-semibold text-navy-900">Your check-in QR code</p>
      <p className="mt-0.5 text-xs text-slate-500">Show this to staff at the counter when you’re called.</p>
      <div className="mt-4 flex justify-center">
        {error ? (
          <Alert tone="error" className="text-left" action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={load}>Retry</Button>}>
            {error.message}
          </Alert>
        ) : !qr ? (
          <div className="flex h-48 items-center">
            <Spinner label="Generating code" />
          </div>
        ) : (
          <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <QRCodeSVG value={qr.payload} size={184} level="M" marginSize={1} title="Arrival QR code" />
          </div>
        )}
      </div>
      {qr && !error && (
        <>
          <p className="mt-4 text-xs text-slate-500">Camera not working? Read this code to staff:</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-navy-900" aria-label={`Manual code ${qr.manualCode.split('').join(' ')}`}>
            {qr.manualCode}
          </p>
          <p className="mt-2 text-xs text-slate-400">Refreshes automatically · valid for {formatCountdown(remaining)}</p>
        </>
      )}
    </div>
  );
}

export async function confirmArrival(tokenId) {
  const data = await api.post(`/api/customer/tokens/${tokenId}/confirm-arrival`);
  return data.token;
}

// Mounted once for signed-in customers: shows "you've been called" toasts
// and the arrival-confirmation prompt on any page. On (re)connect it checks
// the API for a pending prompt, so a missed socket event is never lost.
export function CustomerNotifications() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const isCustomer = user?.role === 'CUSTOMER';

  const checkPending = useCallback(async () => {
    if (!isCustomer) return;
    try {
      const { tokens } = await api.get('/api/customer/tokens/active');
      const waitingConfirm = tokens.find((t) => t.status === 'CALLED' && t.arrivalRequestedAt && !t.arrivalConfirmedAt);
      setPending(waitingConfirm ? { tokenId: waitingConfirm.id, displayNumber: waitingConfirm.displayNumber, deadline: waitingConfirm.noShowDeadline } : null);
    } catch {
      // Non-critical; the token page shows the same prompt.
    }
  }, [isCustomer]);

  useOnConnect(checkPending);
  useSocketEvent('token:called', (p) => {
    if (!isCustomer) return;
    toast.info(`It’s your turn! ${p.displayNumber} — please go to the ${p.serviceName} counter.`, { duration: 10000 });
  });
  useSocketEvent('arrival:requested', (p) => {
    if (!isCustomer) return;
    setError(null);
    setPending({ tokenId: p.tokenId, deadline: p.deadline });
    checkPending();
  });

  const confirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const token = await confirmArrival(pending.tokenId);
      toast.success('Arrival confirmed. Staff will start your service shortly.');
      setPending(null);
      navigate(`/app/tokens/${token.id}`);
    } catch (err) {
      setError(err);
      if (['ARRIVAL_ALREADY_CONFIRMED', 'GRACE_PERIOD_EXPIRED', 'INVALID_STATUS_TRANSITION'].includes(err.code)) checkPending();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={Boolean(pending)}
      onClose={() => setPending(null)}
      title="Confirm your arrival"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => setPending(null)}>
            Not now
          </Button>
          <Button variant="success" icon={CheckCircle2} loading={confirming} onClick={confirm}>
            I’m here
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
        <div className="text-sm text-slate-600">
          <p>
            Staff just scanned your QR code{pending?.displayNumber ? ` for ${pending.displayNumber}` : ''}. Tap <strong>I’m here</strong> to confirm you
            are at the counter.
          </p>
          {pending?.deadline && <p className="mt-2 text-xs text-slate-500">Please confirm before {new Date(pending.deadline).toLocaleTimeString()}.</p>}
          {error && (
            <Alert tone="error" className="mt-3">
              {error.message}
            </Alert>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Subscribes to anonymous queue-change pings for one service while mounted.
export function ServiceRoom({ serviceId }) {
  useRoom('service', serviceId);
  return null;
}
