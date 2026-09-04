/**
 * The HTTP client. Every call carries the namespace token (CLAUDE.md §0.5).
 *
 * The token comes from the URL the human was given and goes back to the server on
 * every request — it is the whole identity. Nothing is stored, and there is no
 * login to lose.
 */

/** An error carrying the server's structured fields, so the UI can read them. */
export class ApiError extends Error {
  constructor(message, body = {}, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = body.reason;
    this.stopReason = body.stop_reason;
    // §2.3: the one fact the human most needs after a failed AI turn.
    this.draft_unchanged = body.draft_unchanged === true;
    this.invalid_token = body.invalid_token === true;
    // The operator has run out of credit or hit a spend limit. A distinct state
    // from an ordinary failure because retrying cannot fix it and the person
    // reading the message is not the person who can.
    this.budget_exhausted = body.budget_exhausted === true;
    // §0.5's F37 refusal: the fixed development namespace, off localhost.
    this.default_token_refused = body.default_token_refused === true;
  }
}

/**
 * @param {{token: string, fetchImpl?: typeof fetch}} options
 */
export function createApi({ token, fetchImpl = fetch }) {
  const base = `/api/t/${token}`;

  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...options,
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      /* a body-less error is still an error */
    }

    if (!response.ok) {
      throw new ApiError(body.error ?? `the server returned ${response.status}.`, body, response.status);
    }
    return body;
  }

  const post = (path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload) });
  const del = (path, payload) => request(path, { method: 'DELETE', body: JSON.stringify(payload) });

  return {
    /**
     * The server's liveness and the version it is running.
     *
     * The one call that does NOT go through `base`: a health check that needs a
     * capability token is not a health check. It is also why the footer shows the
     * version the SERVER is running rather than one baked into this bundle at
     * build time — that is the number a bug report needs.
     */
    health: () => fetchImpl('/health').then((response) => response.json()),

    // Within this namespace only. There is no call that reaches another one —
    // the token in `base` is the whole address space (§0.5).
    list: () => request('/library'),
    load: (slug) => request(`/documents/${encodeURIComponent(slug)}`),
    create: (slug) => post('/documents', { slug }),
    checkpoint: (slug, pendingDraft) => post('/checkpoint', { slug, pendingDraft }),
    aiEdit: (slug, prompt, pendingDraft) => post('/ai-edit', { slug, prompt, pendingDraft }),
    // §4. `pendingDraft` goes along so uncommitted hand edits become their own turn
    // before the draft is replaced, rather than being thrown away by the restore.
    restore: (slug, turnId, pendingDraft) =>
      post('/restore', { slug, turn_id: turnId, pendingDraft }),

    // §8 and §10. NONE of these commits a turn (§0.10) — separate addresses from
    // /ai-edit precisely so that is checkable from outside.
    context: {
      list: (slug) => request(`/context/${encodeURIComponent(slug)}`),
      add: (slug, file) => post('/context', { slug, ...file }),
      describe: (slug, id, description) =>
        post(`/context/${encodeURIComponent(id)}/description`, { slug, description }),
      remove: (slug, id) => del(`/context/${encodeURIComponent(id)}`, { slug }),
      clear: (slug) => post('/context/clear', { slug }),
    },
    rules: {
      add: (slug, text, scope) => post('/rules', { slug, text, scope }),
      update: (slug, id, patch) => post(`/rules/${encodeURIComponent(id)}`, { slug, ...patch }),
      remove: (slug, id) => del(`/rules/${encodeURIComponent(id)}`, { slug }),
    },
  };
}
