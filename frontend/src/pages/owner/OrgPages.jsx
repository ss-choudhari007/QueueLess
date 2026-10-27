import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { BarChart3, Building2, CalendarClock, CheckCircle2, Circle, ExternalLink, LayoutDashboard, MonitorPlay, Plus, Save, ShieldAlert, Store, Users, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { WEEKDAYS, formatMinutes } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDocumentTitle, useResource } from '../../hooks/index.js';
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
  Input,
  PageHeader,
  PageLoader,
  Select,
  Stat,
  Textarea,
  Toggle,
  cx,
} from '../../components/ui/index.jsx';

export const CATEGORIES = ['Clinic', 'Hospital', 'Salon', 'Service center', 'College office', 'Document verification', 'Government office', 'Bank', 'Other'];
const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
})();

export function OwnerHome() {
  useDocumentTitle('Organizations');
  const { data, error, loading, retry } = useResource(() => api.get('/api/owner/orgs'), []);
  return (
    <Container>
      <PageHeader title="Your organizations" description="Set up services, hours and staff, and see how your queues perform." actions={<ButtonLink to="/owner/new" icon={Plus}>New organization</ButtonLink>} />
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={retry} />
        </Card>
      ) : data.organizations.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Create your first organization"
            description="Add your clinic, salon or office, then create the services customers can queue for."
            action={<ButtonLink to="/owner/new" icon={Plus}>Create organization</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.organizations.map((o) => (
            <Card key={o.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-navy-900">{o.name}</h2>
                  <p className="text-sm text-slate-500">
                    {o.category}
                    {o.city ? ` · ${o.city}` : ''}
                  </p>
                </div>
                <Badge tone={o.isActive ? 'green' : 'slate'}>{o.isActive ? 'Listed' : 'Hidden'}</Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                {o.serviceCount} service{o.serviceCount === 1 ? '' : 's'} · {o.staffCount} staff
              </p>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <ButtonLink to={`/owner/orgs/${o.id}`} size="sm" icon={Wrench}>
                  Manage
                </ButtonLink>
                <ButtonLink to={`/staff/${o.id}`} size="sm" variant="secondary" icon={MonitorPlay}>
                  Queue console
                </ButtonLink>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
}

function OrgForm({ initial, onSubmit, submitLabel, showActive }) {
  const [form, setForm] = useState(() => ({
    name: '',
    category: 'Clinic',
    description: '',
    address: '',
    city: '',
    phone: '',
    email: '',
    timezone: 'Asia/Kolkata',
    isActive: true,
    ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { name, category, description, address, city, phone, email, timezone, isActive } = form;
      await onSubmit({ name, category, description, address, city, phone, email, timezone, ...(showActive ? { isActive } : {}) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const f = error?.fields || {};
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && !Object.keys(f).length && <Alert tone="error">{error.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Organization name" required value={form.name} onChange={set('name')} error={f.name} maxLength={100} />
        <Select label="Category" value={form.category} onChange={set('category')} error={f.category}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
      <Textarea label="Description" value={form.description} onChange={set('description')} error={f.description} maxLength={1000} hint="Shown on your public page." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Address" value={form.address} onChange={set('address')} error={f.address} maxLength={200} />
        <Input label="City" value={form.city} onChange={set('city')} error={f.city} maxLength={60} />
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={f.phone} maxLength={30} />
        <Input label="Contact email" type="email" value={form.email} onChange={set('email')} error={f.email} />
      </div>
      <Select label="Timezone" value={form.timezone} onChange={set('timezone')} error={f.timezone} hint="Used for opening hours, service dates and analytics.">
        {/* Browsers list aliases differently (e.g. Asia/Calcutta vs Asia/Kolkata); always include the saved value. */}
        {[...new Set([form.timezone, 'Asia/Kolkata', 'UTC', ...TIMEZONES])].map((tz) => (
          <option key={tz}>{tz}</option>
        ))}
      </Select>
      {showActive && (
        <div className="rounded-lg border border-slate-200 p-4">
          <Toggle
            label="Listed publicly"
            description="When off, the organization is hidden from browsing and cannot accept new tokens."
            checked={form.isActive}
            onChange={(isActive) => setForm({ ...form, isActive })}
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} icon={Save}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function CreateOrgPage() {
  useDocumentTitle('New organization');
  const navigate = useNavigate();
  const { reload } = useAuth();
  const toast = useToast();
  return (
    <Container size="md">
      <PageHeader eyebrow="Step 1 of 2" title="Create your organization" description="You can change everything later. Next you’ll add the services customers queue for." />
      <Card className="p-6">
        <OrgForm
          submitLabel="Create organization"
          onSubmit={async (body) => {
            const { organization } = await api.post('/api/owner/orgs', body);
            await reload();
            toast.success(`${organization.name} created. Now add your first service.`);
            navigate(`/owner/orgs/${organization.id}/services`, { replace: true });
          }}
        />
      </Card>
    </Container>
  );
}

const TABS = [
  ['', 'Overview', LayoutDashboard],
  ['profile', 'Profile', Store],
  ['services', 'Services', Wrench],
  ['settings', 'Hours & queue', CalendarClock],
  ['staff', 'Staff', Users],
  ['analytics', 'Analytics', BarChart3],
  ['restrictions', 'Restrictions', ShieldAlert],
];

export function OwnerOrgLayout() {
  const { orgId } = useParams();
  const resource = useResource(() => api.get(`/api/owner/orgs/${orgId}`).then((d) => d.organization), [orgId]);
  const org = resource.data;
  useDocumentTitle(org?.name);
  if (resource.loading && !org) return <PageLoader label="Loading organization" />;
  if (resource.error) {
    return (
      <Container size="md">
        <Card>
          <ErrorState error={resource.error} title={resource.error.status === 403 ? 'You do not manage this organization' : undefined} />
        </Card>
      </Container>
    );
  }
  return (
    <Container>
      <PageHeader
        eyebrow="Manage organization"
        title={org.name}
        description={`${org.category}${org.city ? ` · ${org.city}` : ''} · ${org.timezone}`}
        actions={
          <>
            <ButtonLink to={`/orgs/${org.slug}`} variant="secondary" icon={ExternalLink}>
              Public page
            </ButtonLink>
            <ButtonLink to={`/staff/${org.id}`} icon={MonitorPlay}>
              Queue console
            </ButtonLink>
          </>
        }
      />
      {!org.isActive && (
        <Alert tone="warning" className="mb-4" title="This organization is hidden">
          Customers cannot find it or join its queues. Turn on “Listed publicly” in Profile.
        </Alert>
      )}
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Organization sections">
        {TABS.map(([path, label, Icon]) => (
          <NavLink
            key={label}
            to={path ? `/owner/orgs/${orgId}/${path}` : `/owner/orgs/${orgId}`}
            end
            className={({ isActive }) =>
              cx(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium',
                isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-navy-900'
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ org, setOrg: resource.setData, reloadOrg: resource.reload }} />
    </Container>
  );
}

export function OwnerOverview() {
  const { org } = useOutletContext();
  const { data, error, loading, retry } = useResource(async () => {
    const [services, staff, today] = await Promise.all([
      api.get(`/api/owner/orgs/${org.id}/services`),
      api.get(`/api/owner/orgs/${org.id}/staff`),
      api.get(`/api/owner/orgs/${org.id}/analytics`, { from: undefined }),
    ]);
    return { services: services.services, staff, analytics: today };
  }, [org.id]);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  const t = data.analytics.totals;
  const activeServices = data.services.filter((s) => s.isActive).length;
  const openDays = (org.settings?.weeklyHours || []).filter((d) => !d.closed).length;
  const checklist = [
    { done: activeServices > 0, label: 'Add at least one active service', to: 'services' },
    { done: openDays > 0, label: 'Set your weekly opening hours', to: 'settings' },
    { done: data.staff.members.length > 0, label: 'Invite staff (optional — owners can run the queue too)', to: 'staff' },
    { done: org.isActive, label: 'List the organization publicly', to: 'profile' },
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">Last 7 days</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tokens issued" value={t.issued} icon={Users} />
          <Stat label="Completed" value={t.completed} icon={CheckCircle2} tone="green" hint={t.completionRate !== null ? `${t.completionRate}% of finished` : undefined} />
          <Stat label="Avg wait" value={formatMinutes(t.averageWaitMinutes)} icon={CalendarClock} tone="slate" />
          <Stat label="No-shows" value={t.noShow} icon={ShieldAlert} tone="red" hint={t.noShowRate !== null ? `${t.noShowRate}% of finished` : undefined} />
        </div>
      </div>
      <Card>
        <CardHeader title="Setup checklist" />
        <ul className="divide-y divide-slate-100">
          {checklist.map((c) => (
            <li key={c.label}>
              <NavLink to={`/owner/orgs/${org.id}/${c.to}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                {c.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Done" /> : <Circle className="h-5 w-5 text-slate-300" aria-label="To do" />}
                <span className={c.done ? 'text-slate-500' : 'font-medium text-navy-900'}>{c.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function OwnerProfile() {
  const { org, setOrg } = useOutletContext();
  const toast = useToast();
  const { reload } = useAuth();
  return (
    <Card className="p-6">
      <OrgForm
        initial={org}
        showActive
        submitLabel="Save changes"
        onSubmit={async (body) => {
          const { organization } = await api.patch(`/api/owner/orgs/${org.id}`, body);
          setOrg(organization);
          reload();
          toast.success('Organization details saved.');
        }}
      />
    </Card>
  );
}

export function OwnerSettings() {
  const { org, setOrg } = useOutletContext();
  const toast = useToast();
  const initial = useMemo(
    () => ({
      maxDailyTokens: org.settings.maxDailyTokens,
      noShowGracePeriodMinutes: org.settings.noShowGracePeriodMinutes,
      qrTtlSeconds: org.settings.qrTtlSeconds,
      weeklyHours: org.settings.weeklyHours.map((d) => ({ ...d })),
    }),
    [org]
  );
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(initial), [initial]);

  const setDay = (i, patch) => setForm({ ...form, weeklyHours: form.weeklyHours.map((d, j) => (i === j ? { ...d, ...patch } : d)) });
  const f = error?.fields || {};

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { organization } = await api.put(`/api/owner/orgs/${org.id}/settings`, {
        ...form,
        maxDailyTokens: Number(form.maxDailyTokens),
        noShowGracePeriodMinutes: Number(form.noShowGracePeriodMinutes),
        qrTtlSeconds: Number(form.qrTtlSeconds),
      });
      setOrg(organization);
      toast.success('Hours and queue settings saved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px]" noValidate>
      <Card>
        <CardHeader title="Weekly opening hours" description={`Customers can join only while open. Times are in ${org.timezone}.`} />
        <div className="divide-y divide-slate-100">
          {form.weeklyHours.map((d, i) => {
            const dayError = Object.entries(f).find(([k]) => k.startsWith(`weeklyHours.${i}`))?.[1];
            return (
              <div key={WEEKDAYS[i]} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-24 text-sm font-medium text-navy-900">{WEEKDAYS[i]}</span>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!d.closed} onChange={(e) => setDay(i, { closed: !e.target.checked })} />
                    Open
                  </label>
                  <input type="time" aria-label={`${WEEKDAYS[i]} opening time`} className="input w-32" value={d.open} disabled={d.closed} onChange={(e) => setDay(i, { open: e.target.value })} />
                  <span className="text-slate-400">to</span>
                  <input type="time" aria-label={`${WEEKDAYS[i]} closing time`} className="input w-32" value={d.close} disabled={d.closed} onChange={(e) => setDay(i, { close: e.target.value })} />
                </div>
                {dayError && <p className="mt-1 text-xs font-medium text-red-600">{dayError}</p>}
              </div>
            );
          })}
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Queue rules" />
          <div className="space-y-4 px-5 py-4">
            {error && !Object.keys(f).length && <Alert tone="error">{error.message}</Alert>}
            <Input label="Daily token limit per service" type="number" min={1} max={1000} value={form.maxDailyTokens} onChange={(e) => setForm({ ...form, maxDailyTokens: e.target.value })} error={f.maxDailyTokens} hint="Services can override this individually." />
            <Input
              label="Arrival grace period (minutes)"
              type="number"
              min={1}
              max={30}
              value={form.noShowGracePeriodMinutes}
              onChange={(e) => setForm({ ...form, noShowGracePeriodMinutes: e.target.value })}
              error={f.noShowGracePeriodMinutes}
              hint="Policy default is 5 minutes after a token is called."
            />
            <Input label="QR code lifetime (seconds)" type="number" min={30} max={600} value={form.qrTtlSeconds} onChange={(e) => setForm({ ...form, qrTtlSeconds: e.target.value })} error={f.qrTtlSeconds} hint="Customer QR codes refresh automatically before expiring." />
          </div>
        </Card>
        <Alert tone="info" title="No-show policy">
          Three unexcused no-shows within 30 days restrict a customer from joining this organization for 72 hours. Advance cancellations never count.
        </Alert>
        <Button type="submit" className="w-full" loading={busy} icon={Save}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
