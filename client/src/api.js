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

  return {
    load: (slug) => request(`/documents/${encodeURIComponent(slug)}`),
    create: (slug) => post('/documents', { slug }),
    checkpoint: (slug, pendingDraft) => post('/checkpoint', { slug, pendingDraft }),
    aiEdit: (slug, prompt, pendingDraft) => post('/ai-edit', { slug, prompt, pendingDraft }),
  };
}
