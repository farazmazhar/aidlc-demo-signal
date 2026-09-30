/**
 * Dashboard behaviour.
 *
 * Everything that can be decided without the DOM is a pure builder, so it is
 * unit-testable and the render step stays a thin assignment pass. No framework,
 * no chart library and no external asset: the demo must run with no network
 * beyond the emulator (NFR5).
 *
 * `FILTER_VALUES` mirrors the FR2.2 vocabularies from `src/domain/types.ts`.
 * The browser bundle cannot import from `src/`, so the mirror is checked by the
 * unit test against the domain constants — if the two drift, the test fails.
 */

/** @type {{ category: string[], sentiment: string[], urgency: string[] }} */
export const FILTER_VALUES = {
  category: ['bug', 'feature request', 'usability', 'performance', 'pricing', 'other'],
  sentiment: ['positive', 'neutral', 'negative'],
  urgency: ['low', 'medium', 'high'],
};

/** All several FR2.2 filter values, as select options (FR5.3). */
export function buildFilters() {
  return {
    category: [...FILTER_VALUES.category],
    sentiment: [...FILTER_VALUES.sentiment],
    urgency: [...FILTER_VALUES.urgency],
  };
}

function isKnownFilterValue(kind, value) {
  return typeof value === 'string' && FILTER_VALUES[kind].includes(value);
}

/**
 * Build the ingest payload from the web form (FR1.2).
 *
 * Returns `null` for a blank message so the UI can refuse the request locally
 * instead of sending one the API would reject.
 *
 * @param {{ text?: string, submitter_email?: string, product_area?: string }} form
 */
export function buildSubmitPayload(form) {
  const text = (form.text ?? '').trim();
  if (text.length === 0) {
    return null;
  }
  /** @type {{ source: string, text: string, submitter_email?: string, product_area?: string }} */
  const payload = { source: 'web', text };
  const email = (form.submitter_email ?? '').trim();
  if (email.length > 0) {
    payload.submitter_email = email;
  }
  const area = (form.product_area ?? '').trim();
  if (area.length > 0) {
    payload.product_area = area;
  }
  return payload;
}

/**
 * Turn a filter selection into a request, or `null` when a value is not an FR2.2
 * value — a malformed request is never issued (FR5.3).
 *
 * @param {{ category?: string, sentiment?: string, urgency?: string }} filters
 */
export function buildQueryRequest(filters) {
  const params = new URLSearchParams();
  for (const kind of /** @type {const} */ (['category', 'sentiment', 'urgency'])) {
    const value = filters[kind];
    if (value === undefined || value === '') {
      continue;
    }
    if (!isKnownFilterValue(kind, value)) {
      return null;
    }
    params.set(kind, value);
  }
  const query = params.toString();
  return { path: `./dashboard/themes${query ? `?${query}` : ''}` };
}

/** @param {{ themes?: Array<{ id: string, label?: string, summary?: string, memberIds?: string[] }> }} payload */
export function buildThemeView(payload) {
  return (payload.themes ?? []).map((theme) => ({
    id: theme.id,
    label: theme.label ?? theme.id,
    summary: theme.summary ?? '',
    memberCount: (theme.memberIds ?? []).length,
  }));
}

/**
 * @param {{ trends?: Array<{ weekStart: string, itemCount?: number, themeCount?: number }> }} payload
 */
export function buildTrendView(payload) {
  const points = payload.trends ?? [];
  const peak = points.reduce((max, point) => Math.max(max, point.itemCount ?? 0), 0);
  return points.map((point) => ({
    weekStart: point.weekStart,
    label: point.weekStart.slice(5, 10),
    itemCount: point.itemCount ?? 0,
    themeCount: point.themeCount ?? 0,
    widthPercent: peak === 0 ? 0 : Math.round(((point.itemCount ?? 0) / peak) * 100),
  }));
}

/** @param {{ urgent?: Array<{ id: string, text?: string, classification?: { category?: string, urgency?: string } }> }} payload */
export function buildUrgentView(payload) {
  return (payload.urgent ?? []).map((item) => ({
    id: item.id,
    text: item.text ?? '',
    category: item.classification?.category ?? 'other',
    urgency: item.classification?.urgency ?? 'low',
  }));
}

/**
 * Compose the three panels, the weekly summary and the empty state (FR4.2, FR5.1).
 *
 * @param {{ themes?: object, trends?: object, urgent?: object }} payloads
 */
export function buildDashboardViewModel(payloads) {
  const themes = buildThemeView(payloads.themes ?? {});
  const trends = buildTrendView(payloads.trends ?? {});
  const urgent = buildUrgentView(payloads.urgent ?? {});
  return {
    themes,
    trends,
    urgent,
    summary: payloads.themes?.run?.summary ?? '',
    isEmpty: themes.length === 0 && urgent.length === 0,
  };
}

/**
 * Build the drill-down request for a theme, or `null` when the theme is not in
 * the loaded payload (FR5.2).
 *
 * @param {string} themeId
 * @param {{ themes?: Array<{ id: string }> }} payload
 */
export function buildDrilldownRequest(themeId, payload) {
  const known = (payload.themes ?? []).some((theme) => theme.id === themeId);
  if (!known) {
    return null;
  }
  return { path: `./themes/${encodeURIComponent(themeId)}/items` };
}

/** Fetch JSON and surface a typed failure instead of an unchecked parse. */
async function fetchJson(path, init) {
  const response = await fetch(path, init);
  const text = await response.text();
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = body?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function optionMarkup(values) {
  return ['<option value="">Any</option>']
    .concat(values.map((value) => `<option value="${value}">${value}</option>`))
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

/** @param {Document} doc */
function byTestId(doc, id) {
  return doc.querySelector(`[data-testid="${id}"]`);
}

/** Read the current filter selection from the DOM. */
function readFilterSelection(doc) {
  return {
    category: byTestId(doc, 'dashboard-filter-category')?.value ?? '',
    sentiment: byTestId(doc, 'dashboard-filter-sentiment')?.value ?? '',
    urgency: byTestId(doc, 'dashboard-filter-urgency')?.value ?? '',
  };
}

/** Load and render every panel; failures land in the status line, never silently. */
async function refreshDashboard(doc) {
  const filters = readFilterSelection(doc);
  const query = buildQueryRequest(filters);
  const suffix = query ? query.path.split('?')[1] ?? '' : '';

  const [themes, trends, urgent] = await Promise.all([
    fetchJson(`./dashboard/themes${suffix ? `?${suffix}` : ''}`),
    fetchJson(`./dashboard/trends${suffix ? `?${suffix}` : ''}`),
    fetchJson(`./dashboard/urgent${suffix ? `?${suffix}` : ''}`),
  ]);

  const view = buildDashboardViewModel({ themes, trends, urgent });

  const summary = byTestId(doc, 'dashboard-summary');
  if (summary) {
    summary.textContent = view.summary || (view.isEmpty ? 'No feedback yet.' : `${view.themes.length} theme(s) this week.`);
  }

  const themeList = byTestId(doc, 'dashboard-themes');
  if (themeList) {
    themeList.innerHTML = view.themes
      .map(
        (theme) =>
          `<li><button type="button" data-theme-id="${escapeHtml(theme.id)}">${escapeHtml(theme.label)}</button> — ${escapeHtml(theme.summary)} (${theme.memberCount} items)</li>`,
      )
      .join('');
  }

  const trendList = byTestId(doc, 'dashboard-trends');
  if (trendList) {
    trendList.innerHTML = view.trends
      .map(
        (point) =>
          `<li><span class="trend-label">${escapeHtml(point.label)}</span><span class="trend-bar" style="width: ${point.widthPercent}%"></span><span class="trend-count">${point.itemCount}</span></li>`,
      )
      .join('');
  }

  const urgentList = byTestId(doc, 'dashboard-urgent');
  if (urgentList) {
    urgentList.innerHTML = view.urgent
      .map(
        (item) =>
          `<li data-urgent-id="${escapeHtml(item.id)}">${escapeHtml(item.text)} <em>(${escapeHtml(item.category)}, ${escapeHtml(item.urgency)})</em></li>`,
      )
      .join('');
  }
}

/** @param {Document} doc */
async function showDrilldown(doc, themeId, payload) {
  const request = buildDrilldownRequest(themeId, payload);
  if (request === null) {
    return;
  }
  const drilldown = await fetchJson(request.path);
  const panel = byTestId(doc, 'dashboard-drilldown-panel');
  if (panel) {
    panel.hidden = false;
  }
  const summary = byTestId(doc, 'dashboard-drilldown-summary');
  if (summary) {
    summary.textContent = `${drilldown.theme.label} — ${drilldown.theme.summary}`;
  }
  const list = byTestId(doc, 'dashboard-drilldown');
  if (list) {
    list.innerHTML = (drilldown.items ?? [])
      .map((item) => `<li>${escapeHtml(item.text)} <em>(${escapeHtml(item.classification.urgency)})</em></li>`)
      .join('');
  }
}

/** Wire the form, the filters and the drill-down; called only in a browser. */
export async function init(doc = document) {
  const filters = buildFilters();
  for (const kind of ['category', 'sentiment', 'urgency']) {
    const select = byTestId(doc, `dashboard-filter-${kind}`);
    if (select) {
      select.innerHTML = optionMarkup(filters[kind]);
    }
  }

  const status = byTestId(doc, 'dashboard-submit-status');
  const form = byTestId(doc, 'dashboard-submit-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = buildSubmitPayload({
      text: byTestId(doc, 'dashboard-feedback-text')?.value ?? '',
      submitter_email: byTestId(doc, 'dashboard-feedback-email')?.value ?? '',
      product_area: byTestId(doc, 'dashboard-feedback-area')?.value ?? '',
    });
    if (payload === null) {
      if (status) {
        status.textContent = 'Please describe the feedback before sending.';
      }
      return;
    }
    try {
      const created = await fetchJson('./feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (status) {
        status.textContent = `Recorded ${created.id} as ${created.classification.category} / ${created.classification.urgency}.`;
      }
      await refreshDashboard(doc);
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    }
  });

  byTestId(doc, 'dashboard-filter-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await refreshDashboard(doc);
  });

  byTestId(doc, 'dashboard-themes')?.addEventListener('click', async (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest('button[data-theme-id]') : null;
    const themeId = target?.getAttribute('data-theme-id');
    if (!themeId) {
      return;
    }
    const themesPayload = await fetchJson('./dashboard/themes');
    await showDrilldown(doc, themeId, themesPayload);
  });

  byTestId(doc, 'dashboard-drilldown-close')?.addEventListener('click', () => {
    const panel = byTestId(doc, 'dashboard-drilldown-panel');
    if (panel) {
      panel.hidden = true;
    }
  });

  await refreshDashboard(doc);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  init().catch((error) => {
    console.error('dashboard initialisation failed', error);
  });
}
