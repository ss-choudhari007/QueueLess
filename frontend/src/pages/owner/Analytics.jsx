import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CheckCircle2, Clock, Timer, UserX, Users, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, formatMinutes } from '../../lib/format.js';
import { useResource } from '../../hooks/index.js';
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, PageLoader, Select, Stat, cx } from '../../components/ui/index.jsx';

const COLORS = { issued: '#1b3a6b', completed: '#2563eb', cancelled: '#94a3b8', noShow: '#dc2626' };
const PRESETS = [
  ['Today', 0],
  ['7 days', 6],
  ['30 days', 29],
  ['90 days', 89],
];

function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function minusDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const shortDate = (d) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

export default function OwnerAnalytics() {
  const { org } = useOutletContext();
  const today = todayIn(org.timezone);
  const [range, setRange] = useState({ from: minusDays(today, 6), to: today, preset: 6 });
  const [draft, setDraft] = useState(range);
  const [serviceId, setServiceId] = useState('');
  const services = useResource(() => api.get(`/api/owner/orgs/${org.id}/services`).then((d) => d.services), [org.id]);
  const { data, error, loading, retry } = useResource(
    () => api.get(`/api/owner/orgs/${org.id}/analytics`, { from: range.from, to: range.to, serviceId }),
    [org.id, range.from, range.to, serviceId]
  );

  const applyPreset = (days) => {
    const next = { from: minusDays(today, days), to: today, preset: days };
    setRange(next);
    setDraft(next);
  };

  const t = data?.totals;
  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Date range presets">
            {PRESETS.map(([label, days]) => (
              <button
                key={label}
                onClick={() => applyPreset(days)}
                aria-pressed={range.preset === days}
                className={cx('rounded-md px-3 py-1.5 text-sm font-medium', range.preset === days ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900')}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setRange({ ...draft, preset: null });
            }}
          >
            <div className="w-40">
              <Input label="From" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </div>
            <div className="w-40">
              <Input label="To" type="date" value={draft.to} min={draft.from} max={today} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </div>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
          <div className="ml-auto w-56">
            <Select label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">All services</option>
              {(services.data || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {loading && !data ? (
        <PageLoader label="Crunching numbers" />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={retry} />
        </Card>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {formatDate(data.range.from)} – {formatDate(data.range.to)} · {data.range.days} day{data.range.days === 1 ? '' : 's'} · {data.range.timezone}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Tokens issued" value={t.issued} icon={Users} />
            <Stat label="Completed" value={t.completed} icon={CheckCircle2} tone="green" hint={t.completionRate !== null ? `${t.completionRate}% completion` : undefined} />
            <Stat label="Cancelled" value={t.cancelled} icon={XCircle} tone="slate" hint={`${t.cancelledByCustomer} by customers`} />
            <Stat label="No-shows" value={t.noShow} icon={UserX} tone="red" hint={t.noShowRate !== null ? `${t.noShowRate}% · ${t.noShowExcused} excused` : undefined} />
            <Stat label="Avg wait" value={formatMinutes(t.averageWaitMinutes)} icon={Clock} tone="amber" hint="Join → called" />
            <Stat label="Avg service" value={formatMinutes(t.averageServiceMinutes)} icon={Timer} tone="brand" hint="Start → complete" />
          </div>

          {t.issued === 0 ? (
            <Card>
              <EmptyState icon={BarChart3} title="No tokens in this period" description="Analytics appear as soon as customers start joining your queues." />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Daily volume" />
                <div className="h-72 px-2 py-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={16} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} width={36} />
                      <Tooltip labelFormatter={(d) => formatDate(d)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="issued" name="Issued" stroke={COLORS.issued} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="completed" name="Completed" stroke={COLORS.completed} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke={COLORS.cancelled} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="noShow" name="No-shows" stroke={COLORS.noShow} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="When customers join" description={`Hour of day, ${data.range.timezone}`} />
                  <div className="h-64 px-2 py-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.hourly.filter((h) => h.hour >= 6 && h.hour <= 22)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} width={36} />
                        <Tooltip labelFormatter={(h) => `${h}:00 – ${h}:59`} />
                        <Bar dataKey="joined" name="Joined" fill={COLORS.completed} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="By service" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">Service</th>
                          <th className="px-3 py-2.5 text-right font-medium">Issued</th>
                          <th className="px-3 py-2.5 text-right font-medium">Done</th>
                          <th className="px-3 py-2.5 text-right font-medium">No-show</th>
                          <th className="px-5 py-2.5 text-right font-medium">Avg wait</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.byService.map((s) => (
                          <tr key={s.serviceId}>
                            <td className="px-5 py-2.5 font-medium text-navy-900">{s.name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{s.issued}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{s.completed}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{s.noShow}</td>
                            <td className="px-5 py-2.5 text-right">{formatMinutes(s.averageWaitMinutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
