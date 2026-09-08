/**
 * The landing page and the success view (CLAUDE.md §12b), chunk 15.
 *
 * The copy is human-ratified verbatim, so it is asserted against the constants
 * rather than against sentences retyped here — a test that retyped them would
 * pass while the page said something else, and a test that paraphrased them would
 * be the second place the wording lives.
 *
 * The success view gets the most attention. It is the one screen where a person
 * receives something they cannot get back: there is no login and no recovery, so a
 * link that is shown badly is documents lost.
 */

// Before anything that reaches react-dom. See test/helpers/dom.js.
import './helpers/dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISCLAIMERS, KEY_DISCLOSURE, LANDING_COPY, wordmarked } from '../client/src/landing-copy.js';
import { Landing } from '../client/src/Landing.js';
import { h } from '../client/src/h.js';
import { render } from './helpers/render.js';

const count = (view, selector) => view.findAll(selector).length;

/** Whitespace-insensitive containment: React splits text across nodes. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Mount the landing page with no network.
 *
 * @param {{respond?: (body: object) => object}} options `respond` is handed the
 *   parsed request body and returns `{status, body}`.
 */
async function mountLanding({ respond } = {}) {
  const posted = [];

  const view = await render(
    h(Landing, {
      origin: 'https://wordwright.ink',
      createApi: () => ({ health: async () => ({ status: 'ok', version: '0.1.2' }) }),
      clipboard: { writeText: async (text) => posted.push({ copied: text }) },
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        posted.push({ url, method: options.method, body });
        const answer = respond
          ? respond(body)
          : { status: 201, body: { token: 'a'.repeat(32), address: `/t/${'a'.repeat(32)}/welcome-doc`, slug: 'welcome-doc' } };
        return {
          ok: answer.status < 400,
          status: answer.status,
          json: async () => answer.body,
        };
      },
    }),
  );
  await view.flush();

  /** Fill both fields and submit, the way a person does. */
  async function signUp({ name = 'Ada Lovelace', email = 'ada@example.com' } = {}) {
    const [nameField, emailField] = view.findAll('.claim-field input');
    await view.type(nameField, name);
    await view.type(emailField, email);
    await view.act(async () => {
      view.find('.claim-form').dispatchEvent(
        new globalThis.window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await view.flush();
  }

  return { ...view, posted, signUp };
}

// ── the landing view ──────────────────────────────────────────────────────────

test('the landing page carries the ratified copy, verbatim', async () => {
  const view = await mountLanding();

  try {
    const text = flat(view.text());
    for (const paragraph of LANDING_COPY) {
      assert.ok(text.includes(flat(paragraph)), `missing: ${paragraph.slice(0, 48)}…`);
    }
    assert.ok(text.includes(flat(DISCLAIMERS)), 'the disclaimers are on the page');

    // Spelling, American, matching the masthead. The one word most likely to be
    // "corrected" by a well-meaning edit.
    assert.match(text, /human judgment/);
    assert.doesNotMatch(text, /judgement/i);
  } finally {
    await view.unmount();
  }
});

test('every rendered "WordWright" is set in the masthead face, including mid-sentence', async () => {
  const view = await mountLanding();

  try {
    const marks = view.findAll('.wordmark-inline');
    // Three in LANDING_COPY (two in the first paragraph's neighbourhood, one
    // opening the second) and two in DISCLAIMERS.
    const occurrences =
      [...LANDING_COPY, DISCLAIMERS].join(' ').split('WordWright').length - 1;
    assert.equal(marks.length, occurrences, `one span per occurrence (${occurrences})`);
    assert.ok(marks.every((node) => node.textContent === 'WordWright'));

    // The lockup is the h1 and is NOT one of these — it has its own rule.
    assert.equal(view.find('.masthead h1').textContent, 'WordWright');
    assert.equal(count(view, '.masthead .wordmark-inline'), 0);
  } finally {
    await view.unmount();
  }
});

test('wordmarked() changes no character of the copy it marks up', () => {
  // The typographic-not-editorial guarantee, stated as a test: whatever the
  // splitter does, the text a reader selects is the text that was ratified.
  const rebuild = (text) =>
    wordmarked(text)
      .map((part) => (typeof part === 'string' ? part : part.props.children))
      .join('');

  for (const text of [...LANDING_COPY, DISCLAIMERS, KEY_DISCLOSURE, 'WordWright', 'no name here', '']) {
    assert.equal(rebuild(text), text, `round-trips: ${text.slice(0, 40)}`);
  }
});

test('the form posts name and email to the public claim endpoint', async () => {
  const view = await mountLanding();

  try {
    await view.signUp({ name: 'Ada Lovelace', email: 'ada@example.com' });

    assert.equal(view.posted[0].url, '/api/public/claim');
    assert.equal(view.posted[0].method, 'POST');
    assert.deepEqual(view.posted[0].body, { name: 'Ada Lovelace', email: 'ada@example.com' });
  } finally {
    await view.unmount();
  }
});

// ── the success view ──────────────────────────────────────────────────────────

test('a successful claim shows the whole link, a copy button, and the key disclosure', async () => {
  const token = 'b'.repeat(32);
  const view = await mountLanding({
    respond: () => ({ status: 201, body: { token, address: `/t/${token}/welcome-doc`, slug: 'welcome-doc' } }),
  });

  try {
    await view.signUp();

    // THE LINK, absolute — the visitor is going to paste it somewhere that is not
    // this page, so a relative address would be useless.
    const link = view.find('.claim-link');
    assert.ok(link, 'the link is on the page');
    assert.equal(link.textContent, `https://wordwright.ink/t/${token}/welcome-doc`);

    // §0.5's disclosure, beside it. Word for word: this is the sentence that
    // stops someone treating a capability URL as private.
    assert.ok(flat(view.find('.claim-disclosure').textContent).includes(flat(KEY_DISCLOSURE)));

    // Start writing goes to the same URL — one link, not two that could differ.
    const start = view.findByText('a', 'Start Writing');
    assert.equal(start.getAttribute('href'), `https://wordwright.ink/t/${token}/welcome-doc`);

    // The copy button puts exactly that on the clipboard.
    await view.click(view.findByText('button', 'Copy Link'));
    await view.flush();
    assert.deepEqual(
      view.posted.filter((entry) => entry.copied),
      [{ copied: `https://wordwright.ink/t/${token}/welcome-doc` }],
    );
    assert.ok(view.findByText('button', 'Copied'), 'and says it did');

    // The form is gone: this view has one job.
    assert.equal(count(view, '.claim-form'), 0);
  } finally {
    await view.unmount();
  }
});

// ── failures, all of them inline ──────────────────────────────────────────────

test('a rate-limited claim says so on the page, and the form survives', async () => {
  const view = await mountLanding({
    respond: () => ({
      status: 429,
      body: { error: 'That is 5 sign-ups from this connection in the last hour. Wait a little and try again.', rate_limited: true },
    }),
  });

  try {
    await view.signUp();

    const error = view.find('.claim-error');
    assert.ok(error, 'the failure is on the page, not in the console');
    assert.equal(error.getAttribute('role'), 'alert');
    assert.match(error.textContent, /5 sign-ups from this connection/);

    assert.equal(count(view, '.claim-link'), 0, 'and no link was invented');
    assert.ok(view.find('.claim-form'), 'the form is still there to try again with');
  } finally {
    await view.unmount();
  }
});

test('an invalid-input refusal and a server error both render calmly', async () => {
  for (const [status, message] of [
    [400, 'That does not look like an email address — check it and try again.'],
    [500, 'Something went wrong making your workspace. Nothing was saved — please try again.'],
  ]) {
    const view = await mountLanding({ respond: () => ({ status, body: { error: message } }) });
    try {
      await view.signUp();
      assert.match(view.find('.claim-error').textContent, new RegExp(message.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(count(view, '.claim-link'), 0);
    } finally {
      await view.unmount();
    }
  }
});

test('a network that never answers is a sentence, not a blank page', async () => {
  const view = await render(
    h(Landing, {
      origin: 'https://wordwright.ink',
      createApi: () => ({ health: async () => ({ version: '0.1.2' }) }),
      fetchImpl: async () => {
        throw new Error('Failed to fetch');
      },
    }),
  );
  await view.flush();

  try {
    const [nameField, emailField] = view.findAll('.claim-field input');
    await view.type(nameField, 'Ada');
    await view.type(emailField, 'ada@example.com');
    await view.act(async () => {
      view.find('.claim-form').dispatchEvent(new globalThis.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await view.flush();

    assert.match(view.find('.claim-error').textContent, /Failed to fetch/);
    assert.ok(view.find('.claim-form'), 'and the page still works');
  } finally {
    await view.unmount();
  }
});

test('a claim in flight disables the button, so a double click mints one namespace', async () => {
  // Two namespaces from one impatient person means the first is stranded: it
  // exists, it is in the registry, and nobody will ever open it.
  let resolveClaim;
  const view = await render(
    h(Landing, {
      origin: 'https://wordwright.ink',
      createApi: () => ({ health: async () => ({ version: '0.1.2' }) }),
      fetchImpl: () =>
        new Promise((resolve) => {
          resolveClaim = () =>
            resolve({ ok: true, status: 201, json: async () => ({ token: 'c'.repeat(32), address: `/t/${'c'.repeat(32)}/welcome-doc` }) });
        }),
    }),
  );
  await view.flush();

  try {
    const [nameField, emailField] = view.findAll('.claim-field input');
    await view.type(nameField, 'Ada');
    await view.type(emailField, 'ada@example.com');
    await view.act(async () => {
      view.find('.claim-form').dispatchEvent(new globalThis.window.Event('submit', { bubbles: true, cancelable: true }));
    });

    const button = view.find('.claim-submit');
    assert.equal(button.disabled, true, 'the button is dead while the claim is in flight');
    assert.match(button.textContent, /Making Your Workspace/);

    await view.act(async () => {
      resolveClaim();
    });
    await view.flush();
    assert.ok(view.find('.claim-link'), 'and it lands');
  } finally {
    await view.unmount();
  }
});
