// Shared UI primitives. Keep visual language consistent across all screens.
import { forwardRef, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import { STATUS_META } from '../../lib/format.js';

const cx = (...classes) => classes.filter(Boolean).join(' ');
export { cx };

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50',
  navy: 'bg-navy-900 text-white shadow-sm hover:bg-navy-800 disabled:bg-navy-900/50',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-600/50',
  'danger-outline': 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-600/50',
};
const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
});

// A router link styled as a button (never nest <button> inside <a>).
export function ButtonLink({ to, variant = 'primary', size = 'md', icon: Icon, className, children, ...props }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </Link>
  );
}

export function Field({ label, error, hint, children, id, required }) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, error, hint, className, id, required, ...props }, ref) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <Field label={label} error={error} hint={hint} id={inputId} required={required}>
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={cx('input', error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20', className)}
        {...props}
      />
    </Field>
  );
});

export function Select({ label, error, hint, className, id, children, required, ...props }) {
  const auto = useId();
  const selectId = id || auto;
  return (
    <Field label={label} error={error} hint={hint} id={selectId} required={required}>
      <select id={selectId} required={required} aria-invalid={Boolean(error)} className={cx('input pr-8', className)} {...props}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, error, hint, className, id, ...props }) {
  const auto = useId();
  const areaId = id || auto;
  return (
    <Field label={label} error={error} hint={hint} id={areaId}>
      <textarea id={areaId} aria-invalid={Boolean(error)} className={cx('input min-h-24', className)} {...props} />
    </Field>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cx('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div>
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  navy: 'bg-navy-900 text-white ring-navy-900',
};

export function Badge({ tone = 'slate', className, children }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }) {
  const meta = STATUS_META[status] || { label: status, tone: 'slate' };
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" className={cx('inline-flex items-center gap-2 text-sm text-slate-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </span>
  );
}

export function PageLoader({ label }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong', className }) {
  return (
    <div role="alert" className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-600">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{error?.message || 'Please try again.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, icon: Icon = AlertCircle, className, action }) {
  const styles = {
    info: 'border-brand-200 bg-brand-50 text-navy-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm', styles[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => e.target === ref.current && onClose?.()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-xl bg-white p-0 shadow-2xl backdrop:bg-navy-950/50', widths[size])}
      aria-labelledby="modal-title"
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="modal-title" className="text-base font-semibold text-navy-900">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close dialog">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', tone = 'primary', loading, onConfirm, onClose, children }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Keep it
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm text-slate-600">{description}</p>}
      {children}
    </Modal>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold tracking-wide text-brand-700 uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = 'brand' }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-600' };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
        {Icon && (
          <span className={cx('rounded-md p-1.5', tones[tone])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold text-navy-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function Toggle({ checked, onChange, label, description, disabled, id }) {
  const auto = useId();
  const toggleId = id || auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={toggleId} className="text-sm font-medium text-slate-800">
          {label}
        </label>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-300'
        )}
      >
        <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-2 pt-4" aria-label="Pagination">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-slate-500">
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function LiveIndicator({ connected }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500" title={connected ? 'Receiving live updates' : 'Reconnecting — data may be stale'}>
      <span className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  );
}
