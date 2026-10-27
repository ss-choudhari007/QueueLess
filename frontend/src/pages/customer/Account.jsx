import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import { ROLE_LABEL, formatDate } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDocumentTitle } from '../../hooks/index.js';
import { Container } from '../../components/layout/Layout.jsx';
import { Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader } from '../../components/ui/index.jsx';

export default function AccountPage() {
  useDocumentTitle('Account');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async (everywhere) => {
    setBusy(true);
    await logout(everywhere);
    navigate('/login', { replace: true });
  };

  return (
    <Container size="md">
      <PageHeader title="Account" description="Your profile and sign-in sessions." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Profile" />
          <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-navy-900">{user.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-navy-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Account type</dt>
              <dd>
                <Badge tone="blue">{ROLE_LABEL[user.role]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Member since</dt>
              <dd className="font-medium text-navy-900">{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
        </Card>
        {user.organizations.length > 0 && (
          <Card>
            <CardHeader title="Organizations" description="Where you can work or manage." />
            <ul className="divide-y divide-slate-100">
              {user.organizations.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="flex items-center gap-2 font-medium text-navy-900">
                    <Building2 className="h-4 w-4 text-slate-400" aria-hidden />
                    {o.name}
                  </span>
                  <Badge>{ROLE_LABEL[o.access]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <CardHeader title="Sessions" description="Sessions are stored securely in HTTP-only cookies and expire after 7 days." />
          <div className="flex flex-wrap gap-3 px-5 py-4">
            <Button variant="secondary" icon={LogOut} onClick={() => signOut(false)} loading={busy}>
              Sign out on this device
            </Button>
            <Button variant="danger-outline" icon={ShieldCheck} onClick={() => setConfirmAll(true)} disabled={busy}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmAll}
        title="Sign out of all devices?"
        description="Every active session for your account, including this one, will end immediately."
        confirmLabel="Sign out everywhere"
        tone="danger"
        loading={busy}
        onConfirm={() => signOut(true)}
        onClose={() => setConfirmAll(false)}
      />
    </Container>
  );
}
