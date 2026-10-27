// Business constants shared across services. See docs/PROJECT_SPEC.md §4.

export const ORG_CATEGORIES = [
  'Clinic',
  'Hospital',
  'Salon',
  'Service center',
  'College office',
  'Document verification',
  'Government office',
  'Bank',
  'Other',
];

export const ACTIVE_STATUSES = ['WAITING', 'CALLED', 'SERVING'];
export const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

// No-show policy (§4.5)
export const NO_SHOW_WINDOW_DAYS = 30; // rolling window
export const NO_SHOW_THRESHOLD = 3; // unexcused no-shows within the window
export const RESTRICTION_HOURS = 72; // restriction length per organization

// Abuse limits
export const MAX_ACTIVE_TOKENS_PER_CUSTOMER = 5; // across all organizations
export const QR_MAX_FAILED_CODE_ATTEMPTS = 5; // manual-code guesses before revocation

// Socket.IO event names (documented in docs/API_CONTRACT.md §5)
export const EVENTS = {
  QUEUE_UPDATED: 'queue:updated',
  TOKEN_UPDATED: 'token:updated',
  TOKEN_CALLED: 'token:called',
  ARRIVAL_REQUESTED: 'arrival:requested',
  ARRIVAL_CONFIRMED: 'arrival:confirmed',
};
