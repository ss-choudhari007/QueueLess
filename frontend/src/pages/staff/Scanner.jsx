import { useEffect, useId, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, Keyboard, ScanLine } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Alert, Button, Input, Modal, Select, cx } from '../../components/ui/index.jsx';

// Camera scanning with html5-qrcode (loaded on demand). If the camera is
// unavailable or permission is denied, staff can type the customer's
// 6-character code instead. A scan is never reported as successful unless
// the server validated it.
function CameraScanner({ onDecoded, paused }) {
  const regionId = `qr-region-${useId().replace(/:/g, '')}`;
  const scannerRef = useRef(null);
  const [state, setState] = useState('starting');
  const [message, setMessage] = useState(null);
  const decodedRef = useRef(onDecoded);
  decodedRef.current = onDecoded;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        setMessage('This browser cannot access a camera (a secure HTTPS connection is required). Use the manual code instead.');
        return;
      }
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            if (!pausedRef.current) decodedRef.current(text);
          },
          () => {}
        );
        if (cancelled) {
          await scanner.stop().catch(() => {});
          return;
        }
        setState('scanning');
      } catch (err) {
        if (cancelled) return;
        const denied = /permission|notallowed/i.test(`${err?.name} ${err?.message ?? err}`);
        setState('unavailable');
        setMessage(
          denied
            ? 'Camera permission was denied. Allow camera access in your browser settings, or use the manual code.'
            : 'No camera could be started on this device. Use the manual code instead.'
        );
      }
    })();
    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [regionId]);

  return (
    <div>
      <div id={regionId} className={cx('mx-auto overflow-hidden rounded-lg bg-slate-900', state === 'unavailable' ? 'hidden' : 'min-h-64 max-w-sm')} />
      {state === 'starting' && <p className="mt-3 text-center text-sm text-slate-500">Starting camera…</p>}
      {state === 'scanning' && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-slate-500">
          <ScanLine className="h-4 w-4" aria-hidden /> Point the camera at the customer’s QR code
        </p>
      )}
      {state === 'unavailable' && (
        <Alert tone="warning" icon={CameraOff}>
          {message}
        </Alert>
      )}
    </div>
  );
}

export default function ScannerModal({ open, onClose, orgId, calledTokens, onVerified, initialTokenId }) {
  const [mode, setMode] = useState('camera');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ tokenId: '', code: '' });

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setManual({ tokenId: initialTokenId || calledTokens[0]?.id || '', code: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTokenId]);

  const verify = async (body) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.post(`/api/staff/orgs/${orgId}/arrival/verify`, body);
      setResult(token);
      onVerified?.(token);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setManual((m) => ({ ...m, code: '' }));
  };

  return (
    <Modal open={open} onClose={onClose} title="Verify customer arrival" description="A successful scan asks the customer to confirm in their app." size="md">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {[
          ['camera', 'Scan QR', Camera],
          ['manual', 'Enter code', Keyboard],
        ].map(([value, label, Icon]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              reset();
            }}
            className={cx(
              'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium',
              mode === value ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {result ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
          <p className="mt-2 font-semibold text-navy-900">
            Code accepted for {result.displayNumber}
            {result.customerName ? ` · ${result.customerName}` : ''}
          </p>
          <p className="mt-1 text-sm text-slate-600">The customer has been asked to tap “I’m here”. Start service once they confirm.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Verify another
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <Alert tone="error" className="mb-3" title="Not accepted">
              {error.message}
            </Alert>
          )}
          {mode === 'camera' ? (
            open && <CameraScanner paused={busy || Boolean(error)} onDecoded={(payload) => verify({ payload })} />
          ) : calledTokens.length === 0 ? (
            <Alert tone="info">Only called customers can be checked in. Call the next customer first.</Alert>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                verify({ tokenId: manual.tokenId, code: manual.code.trim().toUpperCase() });
              }}
            >
              <Select label="Called token" value={manual.tokenId} onChange={(e) => setManual({ ...manual, tokenId: e.target.value })}>
                {calledTokens.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayNumber} — {t.customerName}
                  </option>
                ))}
              </Select>
              <Input
                label="Customer’s 6-character code"
                value={manual.code}
                onChange={(e) => setManual({ ...manual, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })}
                className="font-mono text-lg tracking-[0.3em] uppercase"
                autoComplete="off"
                inputMode="text"
                required
              />
              <Button type="submit" className="w-full" loading={busy} disabled={manual.code.length !== 6}>
                Verify code
              </Button>
            </form>
          )}
          {error && mode === 'camera' && (
            <div className="mt-3 text-center">
              <Button variant="secondary" size="sm" onClick={reset}>
                Scan again
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
