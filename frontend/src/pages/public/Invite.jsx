import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ROLE_LABEL } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDocumentTitle } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { Alert, Button, ButtonLink, Card, ErrorState, Input, PageLoader } from '../../components/ui/index.jsx';

// The invitation token lives in the URL fragment (#…), which browsers never
// send to servers, and is posted to the API in the request body.
export default function InvitePage() {
  useDocumentTitle('Staff invitation');
  const { user, signedIn, reload } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(new Error('This invitation link is incomplete. Ask the owner to send it again.'));
      return;
    }
    api
      .post('/api/invites/lookup', { token })
      .then((d) => setInvite(d.invite))
      .catch(setError);
  }, [token]);

  const acceptNew = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const data = await api.post('/api/invites/accept-new', { token, ...form });
      signedIn(data.user);
      toast.success(`Welcome to ${invite.organization.name}!`);
      navigate('/staff', { replace: true });
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const acceptExisting = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/api/invites/accept', { token });
      await reload();
      toast.success(`You now have access to ${invite.organization.name}.`);
      navigate('/staff', { replace: true });
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <Container size="md">
        <Card>
          <ErrorState title="Invitation unavailable" error={error} />
        </Card>
      </Container>
    );
  }
  if (!invite) return <PageLoader label="Checking invitation" />;

  const signedInAsInvitee = user && user.email === invite.email && user.role === 'STAFF';

  return (
    <Container size="md">
      <Card className="mx-auto max-w-lg p-6 sm:p-8">
        <BadgeCheck className="h-8 w-8 text-brand-600" aria-hidden />
        <h1 className="mt-3 text-xl font-bold text-navy-900">Join {invite.organization.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          You’ve been invited as <strong>{ROLE_LABEL[invite.role]}</strong> using <strong>{invite.email}</strong>.
        </p>
        {formError && (
          <Alert tone="error" className="mt-4">
            {formError.message}
          </Alert>
        )}
        <div className="mt-6">
          {signedInAsInvitee ? (
            <Button className="w-full" onClick={acceptExisting} loading={submitting}>
              Accept invitation
            </Button>
          ) : user ? (
            <Alert tone="warning" title="You’re signed in with a different account">
              Sign out, then open this link again to accept the invitation for {invite.email}.
            </Alert>
          ) : invite.hasAccount ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">A staff account already exists for this email. Sign in, then open the link again.</p>
              <ButtonLink to={`/login?next=${encodeURIComponent(`/invite${window.location.hash}`)}`} className="w-full">
                Sign in to accept
              </ButtonLink>
            </div>
          ) : (
            <form onSubmit={acceptNew} className="space-y-4" noValidate>
              <Input label="Email" value={invite.email} disabled />
              <Input label="Full name" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={formError?.fields?.name} />
              <Input
                label="Choose a password"
                type="password"
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                error={formError?.fields?.password}
                hint="At least 8 characters, including a letter and a number."
              />
              <Button type="submit" className="w-full" loading={submitting} icon={UserPlus}>
                Create staff account
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Not expecting this? You can ignore it — the link expires on {new Date(invite.expiresAt).toLocaleDateString()}. <Link to="/" className="underline">Go home</Link>
        </p>
      </Card>
    </Container>
  );
}
