/**
 * T13–T15 — frontend behaviour.
 *
 * T13 happy: the web-form builder emits exactly the API payload with
 *            `source: "web"`.
 * T14 edge:  the view-model builders render themes, trends and urgent items from
 *            an API payload — including the empty-corpus state — and the filter
 *            controls carry the FR2.2 values.
 * T15 error: drill-down and filter mapping refuse an unknown theme id and an
 *            unknown filter value instead of issuing a malformed request.
 *
 * DOM rendering itself is verified at the narrowest effective level: the smoke
 * run fetches `GET /` and `GET /app.js` from the emulated API and asserts the
 * served markers, because `poc`'s Minimal strategy has no DOM runner.
 */

import {
  FILTER_VALUES,
  buildDashboardViewModel,
  buildDrilldownRequest,
  buildFilters,
  buildQueryRequest,
  buildSubmitPayload,
  buildThemeView,
  buildTrendView,
  buildUrgentView,
} from '../../dashboard/static/app.js';

import { describe, expect, test } from 'bun:test';

import { CATEGORIES, SENTIMENTS, URGENCIES } from '../domain/types';

describe('dashboard behaviour', () => {
  test('T13 the web form builder emits exactly the API payload', () => {
    expect(
      buildSubmitPayload({
        text: '  Checkout fails when the coupon field is empty  ',
        submitter_email: '  tester@example.com ',
        product_area: ' checkout ',
      }),
    ).toEqual({
      source: 'web',
      text: 'Checkout fails when the coupon field is empty',
      submitter_email: 'tester@example.com',
      product_area: 'checkout',
    });

    // Optional fields are omitted, never sent blank.
    expect(buildSubmitPayload({ text: 'Just the message' })).toEqual({
      source: 'web',
      text: 'Just the message',
    });

    // A blank message produces no request at all.
    expect(buildSubmitPayload({ text: '   ' })).toBeNull();
  });

  test('T14 view models render the panels, the empty state and the FR2.2 filter values', () => {
    const payloads = {
      themes: {
        themes: [
          { id: 'run-1-theme-1', label: 'Theme 1: bug', summary: '3 items, mostly bug', memberIds: ['a', 'b', 'c'] },
        ],
        run: { id: 'run-1', summary: 'Two themes this week: checkout failures and pricing confusion.' },
      },
      trends: {
        trends: [
          { weekStart: '2026-09-21T00:00:00.000Z', itemCount: 1, themeCount: 1 },
          { weekStart: '2026-09-28T00:00:00.000Z', itemCount: 4, themeCount: 1 },
        ],
      },
      urgent: {
        urgent: [{ id: 'item-1', text: 'Checkout is down', classification: { category: 'bug', urgency: 'high' } }],
      },
    };

    const view = buildDashboardViewModel(payloads);
    expect(view.isEmpty).toBe(false);
    expect(view.summary).toBe('Two themes this week: checkout failures and pricing confusion.');
    expect(view.themes).toEqual([
      { id: 'run-1-theme-1', label: 'Theme 1: bug', summary: '3 items, mostly bug', memberCount: 3 },
    ]);
    expect(view.urgent).toEqual([
      { id: 'item-1', text: 'Checkout is down', category: 'bug', urgency: 'high' },
    ]);
    expect(view.trends.at(-1)).toEqual({
      weekStart: '2026-09-28T00:00:00.000Z',
      label: '09-28',
      itemCount: 4,
      themeCount: 1,
      widthPercent: 100,
    });
    expect(view.trends[0]?.widthPercent).toBe(25);

    // Empty corpus renders as empty panels plus the empty flag and no summary.
    const empty = buildDashboardViewModel({});
    expect(empty).toEqual({ themes: [], trends: [], urgent: [], summary: '', isEmpty: true });
    expect(buildThemeView({})).toEqual([]);
    expect(buildTrendView({ trends: [] })).toEqual([]);
    expect(buildUrgentView({ urgent: [] })).toEqual([]);

    // The dashboard's filter values are the FR2.2 ones — this fails if they drift.
    const filters = buildFilters();
    expect(filters.category).toEqual([...CATEGORIES]);
    expect(filters.sentiment).toEqual([...SENTIMENTS]);
    expect(filters.urgency).toEqual([...URGENCIES]);
    expect(FILTER_VALUES.category).toEqual([...CATEGORIES]);
    expect(FILTER_VALUES.sentiment).toEqual([...SENTIMENTS]);
    expect(FILTER_VALUES.urgency).toEqual([...URGENCIES]);
  });

  test('T15 unknown theme ids and filter values never become malformed requests', () => {
    const payload = { themes: [{ id: 'run-1-theme-1' }] };

    expect(buildDrilldownRequest('run-1-theme-1', payload)).toEqual({
      path: './themes/run-1-theme-1/items',
    });
    expect(buildDrilldownRequest('theme-that-does-not-exist', payload)).toBeNull();
    expect(buildDrilldownRequest('run-1-theme-1', {})).toBeNull();

    expect(buildQueryRequest({ category: 'bug', urgency: 'high' })).toEqual({
      path: './dashboard/themes?category=bug&urgency=high',
    });
    expect(buildQueryRequest({})).toEqual({ path: './dashboard/themes' });
    expect(buildQueryRequest({ category: 'infrastructure' })).toBeNull();
    expect(buildQueryRequest({ urgency: 'blocker' })).toBeNull();
    expect(buildQueryRequest({ sentiment: 'furious' })).toBeNull();
  });
});
