import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, LogIn, UserRound, UserPlus } from 'lucide-react';
import { homePathFor, safeNext, useAuth } from '../../context/AuthContext.jsx';
import { useDocumentTitle } from '../../hooks/index.js';
import { Alert, Button, Card, Input, cx } from '../../components/ui/index.jsx';
import { Logo } from '../../components/layout/Layout.jsx';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-xl font-bold text-navy-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
        {footer && <p className="mt-4 text-center text-sm text-slate-500">{footer}</p>}
      </div>
    </div>
  );
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(form.email, form.password);
      navigate(safeNext(params.get('next')) || homePathFor(user), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your tokens or your organization."
      footer={
        <>
          New to QueueLess?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`} className="font-semibold text-brand-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error.message}</Alert>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={error?.fields?.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={error?.fields?.password}
        />
        <Button type="submit" className="w-full" loading={submitting} icon={LogIn}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    accountType: params.get('type') === 'owner' ? 'OWNER' : 'CUSTOMER',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await register(form);
      const next = safeNext(params.get('next'));
      navigate(user.role === 'OWNER' ? '/owner/new' : next || homePathFor(user), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const types = [
    { value: 'CUSTOMER', label: 'I want to join queues', icon: UserRound },
    { value: 'OWNER', label: 'I run an organization', icon: Building2 },
  ];

  return (
    <AuthShell
      title="Create your account"
      subtitle="Staff accounts are created from an invitation sent by an organization owner."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="label">Account type</legend>
          <div className="grid grid-cols-2 gap-2">
            {types.map((t) => (
              <label
                key={t.value}
                className={cx(
                  'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-xs font-medium transition',
                  form.accountType === t.value ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                )}
              >
                <input
                  type="radio"
                  name="accountType"
                  value={t.value}
                  className="sr-only"
                  checked={form.accountType === t.value}
                  onChange={() => setForm({ ...form, accountType: t.value })}
                />
                <t.icon className="h-5 w-5" aria-hidden />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        {error && !Object.keys(error.fields).length && <Alert tone="error">{error.message}</Alert>}
        <Input label="Full name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error?.fields?.name} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={error?.fields?.email} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          error={error?.fields?.password}
          hint="At least 8 characters, including a letter and a number."
        />
        <Button type="submit" className="w-full" loading={submitting} icon={UserPlus}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
