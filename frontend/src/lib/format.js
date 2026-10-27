// Display helpers. Canonical API statuses stay upper-case; labels are for people.

export const STATUS_META = {
  WAITING: { label: 'Waiting', tone: 'blue' },
  CALLED: { label: 'Called', tone: 'amber' },
  SERVING: { label: 'Being served', tone: 'indigo' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
  NO_SHOW: { label: 'No-show', tone: 'red' },
};

export const ROLE_LABEL = { CUSTOMER: 'Customer', STAFF: 'Staff', OWNER: 'Owner', SUPERVISOR: 'Supervisor' };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatTime(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));
}

export function formatDateTime(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

export function formatDate(value) {
  if (!value) return '—';
  const date = typeof value === 'string' && value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// "4:32" countdown from milliseconds.
export function formatCountdown(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function hoursLabel(day) {
  if (!day || day.closed) return 'Closed';
  return `${day.open} – ${day.close}`;
}

export const ACTION_LABELS = {
  TOKEN_CALLED: 'Token called',
  TOKEN_CANCELLED: 'Token cancelled by customer',
  ARRIVAL_REQUESTED: 'QR scanned — arrival requested',
  ARRIVAL_CONFIRMED: 'Customer confirmed arrival',
  SERVICE_STARTED: 'Service started',
  SERVICE_COMPLETED: 'Service completed',
  TOKEN_NO_SHOW_AUTO: 'No-show (automatic)',
  TOKEN_NO_SHOW_MANUAL: 'No-show (marked by staff)',
  NO_SHOW_EXCUSED: 'No-show excused',
  CALL_REVERTED: 'Call reverted',
  QUEUE_PAUSED: 'Queue paused',
  QUEUE_RESUMED: 'Queue resumed',
  RESTRICTION_APPLIED: 'Customer restricted',
  RESTRICTION_EXTENDED: 'Restriction extended',
  RESTRICTION_LIFTED: 'Restriction lifted',
  QUEUE_CLOSED_AUTO_CANCEL: 'Day closed — waiting tokens cancelled',
  ORG_CREATED: 'Organization created',
  ORG_UPDATED: 'Organization updated',
  SETTINGS_UPDATED: 'Settings updated',
  SERVICE_CREATED: 'Service created',
  SERVICE_UPDATED: 'Service updated',
  SERVICE_ACTIVATED: 'Service activated',
  SERVICE_DEACTIVATED: 'Service deactivated',
  STAFF_INVITED: 'Staff invited',
  INVITE_ACCEPTED: 'Invitation accepted',
  INVITE_REVOKED: 'Invitation revoked',
  STAFF_ROLE_CHANGED: 'Staff role changed',
  STAFF_REMOVED: 'Staff removed',
};
