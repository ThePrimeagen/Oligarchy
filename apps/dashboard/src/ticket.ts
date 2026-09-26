// The same Linear issue url viz opens with L. The ticket text is the only control that goes
// there; the rest of a ticketed row opens the session feed.
export const LINEAR_ISSUES = "https://linear.app/issue/";

export const linearHref = (ticket: string): string =>
  `${LINEAR_ISSUES}${encodeURIComponent(ticket)}`;

export const followHref = (ticket: string): string => `/tickets/${encodeURIComponent(ticket)}`;

export const feedHref = (ticket: string): string => `${followHref(ticket)}/feed`;

// A ticket is one path segment. A dot, a slash, or a leading mark is not an id, so those routes
// refuse before anyone asks the database.
export const isTicket = (ticket: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(ticket);

// Five seconds: the operator asked for the feed to move that often, tighter than viz's redraw.
export const FOLLOW_POLL = "every 5s";
