import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Copy, Mail, Pencil, Plus, ShieldAlert, Trash2, UserPlus, Users, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ROLE_LABEL, formatDate, formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useResource } from '../../hooks/index.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageLoader,
  Select,
  Textarea,
} from '../../components/ui/index.jsx';

// ── Services ─────────────────────────────────────────────────

function ServiceModal({ open, service, orgId, onClose, onSaved }) {
  const blank = { name: '', description: '', tokenPrefix: 'A', avgDurationMinutes: 10, maxDailyTokens: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setError(null);
      setForm(service ? { ...blank, ...service, description: service.description ?? '', maxDailyTokens: service.maxDailyTokens ?? '' } : blank);
    }
  }
  const f = error?.fields || {};
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      tokenPrefix: form.tokenPrefix,
      avgDurationMinutes: Number(form.avgDurationMinutes),
      maxDailyTokens: form.maxDailyTokens === '' ? null : Number(form.maxDailyTokens),
    };
    try {
      const res = service
        ? await api.patch(`/api/owner/orgs/${orgId}/services/${service.id}`, body)
        : await api.post(`/api/owner/orgs/${orgId}/services`, body);
      onSaved(res.service, !service);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={service ? `Edit ${service.name}` : 'Add a service'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && !Object.keys(f).length && <Alert tone="error">{error.message}</Alert>}
        <Input label="Service name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} maxLength={80} />
        <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={f.description} maxLength={500} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Token prefix"
            value={form.tokenPrefix}
            onChange={(e) => setForm({ ...form, tokenPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) })}
            error={f.tokenPrefix}
            hint={`e.g. ${form.tokenPrefix || 'A'}-001`}
          />
          <Input label="Avg. minutes" type="number" min={1} max={240} value={form.avgDurationMinutes} onChange={(e) => setForm({ ...form, avgDurationMinutes: e.target.value })} error={f.avgDurationMinutes} />
          <Input label="Daily limit" type="number" min={1} max={1000} placeholder="Org default" value={form.maxDailyTokens} onChange={(e) => setForm({ ...form, maxDailyTokens: e.target.value })} error={f.maxDailyTokens} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {service ? 'Save service' : 'Add service'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function OwnerServices() {
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, setData, error, loading, retry } = useResource(() => api.get(`/api/owner/orgs/${org.id}/services`).then((d) => d.services), [org.id]);
  const [modal, setModal] = useState({ open: false, service: null });
  const [toggling, setToggling] = useState(null);

  const toggleActive = async (service) => {
    setToggling(service.id);
    try {
      const { service: next } = await api.patch(`/api/owner/orgs/${org.id}/services/${service.id}`, { isActive: !service.isActive });
      setData(data.map((s) => (s.id === next.id ? next : s)));
      toast.success(`${next.name} ${next.isActive ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setToggling(null);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  return (
    <Card>
      <CardHeader
        title="Services"
        description="Each service has its own queue and token numbering."
        action={
          <Button icon={Plus} onClick={() => setModal({ open: true, service: null })}>
            Add service
          </Button>
        }
      />
      {data.length === 0 ? (
        <EmptyState icon={Wrench} title="No services yet" description="Add the services customers can join a queue for, such as “General consultation”." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Service</th>
                <th className="px-3 py-2.5 font-medium">Prefix</th>
                <th className="px-3 py-2.5 font-medium">Avg. time</th>
                <th className="px-3 py-2.5 font-medium">Daily limit</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'bg-slate-50/60 text-slate-500'}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-navy-900">{s.name}</p>
                    {s.description && <p className="max-w-xs truncate text-xs text-slate-500">{s.description}</p>}
                  </td>
                  <td className="px-3 py-3 font-mono">{s.tokenPrefix}</td>
                  <td className="px-3 py-3">{s.avgDurationMinutes} min</td>
                  <td className="px-3 py-3">{s.maxDailyTokens ?? <span className="text-slate-400">Default ({org.settings.maxDailyTokens})</span>}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={s.isActive ? 'green' : 'slate'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                      {s.isPaused && <Badge tone="amber">Paused</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setModal({ open: true, service: s })}>
                        Edit
                      </Button>
                      <Button size="sm" variant={s.isActive ? 'danger-outline' : 'success'} loading={toggling === s.id} onClick={() => toggleActive(s)}>
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ServiceModal
        open={modal.open}
        service={modal.service}
        orgId={org.id}
        onClose={() => setModal({ open: false, service: null })}
        onSaved={(service, created) => {
          setData(created ? [...data, service] : data.map((s) => (s.id === service.id ? service : s)));
          setModal({ open: false, service: null });
          toast.success(created ? `${service.name} added.` : `${service.name} saved.`);
        }}
      />
    </Card>
  );
}

// ── Staff ────────────────────────────────────────────────────

export function OwnerStaff() {
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, error, loading, reload, retry } = useResource(() => api.get(`/api/owner/orgs/${org.id}/staff`), [org.id]);
  const [invite, setInvite] = useState({ email: '', role: 'STAFF' });
  const [inviteError, setInviteError] = useState(null);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(null);
  const [removing, setRemoving] = useState(null);

  const sendInvite = async (e) => {
    e.preventDefault();
    setBusy('invite');
    setInviteError(null);
    try {
      const res = await api.post(`/api/owner/orgs/${org.id}/invites`, invite);
      setCreated(res);
      setInvite({ email: '', role: 'STAFF' });
      reload();
    } catch (err) {
      setInviteError(err);
    } finally {
      setBusy(null);
    }
  };

  const act = async (key, fn, message) => {
    setBusy(key);
    try {
      await fn();
      toast.success(message);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Invitation link copied.');
    } catch {
      toast.error('Copy failed — select the link and copy it manually.');
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Staff members (${data.members.length})`} description="Supervisors can also pause queues, correct mistakes and view the activity log." />
          {data.members.length === 0 ? (
            <EmptyState icon={Users} title="No staff yet" description="You can run the queue yourself from the console, or invite staff to help." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy-900">{m.user.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {m.user.email} · since {formatDate(m.createdAt)}
                    </p>
                  </div>
                  <select
                    className="input h-8 w-36 py-0 text-xs"
                    aria-label={`Role for ${m.user.name}`}
                    value={m.role}
                    disabled={busy === `role:${m.id}`}
                    onChange={(e) => act(`role:${m.id}`, () => api.patch(`/api/owner/orgs/${org.id}/staff/${m.id}`, { role: e.target.value }), 'Role updated.')}
                  >
                    <option value="STAFF">Staff</option>
                    <option value="SUPERVISOR">Supervisor</option>
                  </select>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${m.user.name}`} onClick={() => setRemoving(m)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Pending invitations" />
          {data.invites.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Mail className="h-4 w-4 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium text-navy-900">{i.email}</span>
                  <Badge>{ROLE_LABEL[i.role]}</Badge>
                  <Badge tone={i.status === 'PENDING' ? 'blue' : 'slate'}>{i.status === 'PENDING' ? `Expires ${formatDate(i.expiresAt)}` : 'Expired'}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `revoke:${i.id}`}
                    onClick={() => act(`revoke:${i.id}`, () => api.delete(`/api/owner/orgs/${org.id}/invites/${i.id}`), 'Invitation revoked.')}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader title="Invite staff" description="Creates a single-use link valid for 7 days. Share it with the staff member directly." />
        <form onSubmit={sendInvite} className="space-y-4 px-5 py-4" noValidate>
          {inviteError && !inviteError.fields?.email && <Alert tone="error">{inviteError.message}</Alert>}
          <Input label="Staff email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} error={inviteError?.fields?.email} />
          <Select label="Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
            <option value="STAFF">Staff — run the queue</option>
            <option value="SUPERVISOR">Supervisor — also pause & correct</option>
          </Select>
          <Button type="submit" className="w-full" icon={UserPlus} loading={busy === 'invite'}>
            Create invitation link
          </Button>
        </form>
        {created && (
          <div className="border-t border-slate-100 px-5 py-4">
            <Alert tone="success" title={`Invitation for ${created.invite.email}`}>
              This link is shown only once. {created.hasExistingAccount ? 'They already have a staff account and will sign in to accept.' : 'They will create their staff account with it.'}
            </Alert>
            <div className="mt-3 flex gap-2">
              <input className="input font-mono text-xs" readOnly value={created.inviteUrl} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
              <Button variant="secondary" icon={Copy} onClick={() => copy(created.inviteUrl)} aria-label="Copy link" />
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.user.name}?`}
        description="They will immediately lose access to this organization's queue console. Their account is not deleted."
        confirmLabel="Remove access"
        tone="danger"
        loading={busy === 'remove'}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await act('remove', () => api.delete(`/api/owner/orgs/${org.id}/staff/${removing.id}`), 'Staff member removed.');
          setRemoving(null);
        }}
      />
    </div>
  );
}

// ── Restrictions ─────────────────────────────────────────────

export function OwnerRestrictions() {
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, error, loading, reload, retry } = useResource(() => api.get(`/api/owner/orgs/${org.id}/restrictions`).then((d) => d.restrictions), [org.id]);
  const [lifting, setLifting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const lift = async () => {
    setBusy(true);
    try {
      await api.post(`/api/owner/orgs/${org.id}/restrictions/${lifting.id}/lift`, { reason });
      toast.success('Restriction lifted.');
      setLifting(null);
      setReason('');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  return (
    <Card>
      <CardHeader title="Customer restrictions" description="Created automatically after 3 unexcused no-shows in 30 days. Each lasts 72 hours and applies only to this organization." />
      {data.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No restrictions" description="Customers who repeatedly miss their turn will appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-navy-900">{r.customer.name}</p>
                <p className="text-xs text-slate-500">
                  {r.reason} · {formatDateTime(r.startsAt)} → {formatDateTime(r.endsAt)}
                </p>
              </div>
              <Badge tone={r.isActive ? 'red' : 'slate'}>{r.isActive ? 'Active' : r.liftedAt ? 'Lifted' : 'Expired'}</Badge>
              {r.isActive && (
                <Button size="sm" variant="secondary" onClick={() => setLifting(r)}>
                  Lift early
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(lifting)}
        title={`Lift restriction for ${lifting?.customer.name}?`}
        confirmLabel="Lift restriction"
        loading={busy}
        onConfirm={lift}
        onClose={() => setLifting(null)}
      >
        <div className="mt-3">
          <Textarea label="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
      </ConfirmDialog>
    </Card>
  );
}

