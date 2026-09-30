/**
 * Static dashboard assets served by the API Lambda.
 *
 * Serving the form and the dashboard from the same origin as the API keeps the
 * demo single-origin: no CORS configuration on a proxy-integrated REST API and no
 * second local server. In the deployed asset the files sit in a `static/`
 * directory beside the bundle; in the repository they are under `dashboard/static`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface StaticAssets {
  get(name: string): Promise<string | null>;
}

export const STATIC_ASSET_NAMES = ['index.html', 'app.js', 'styles.css'] as const;
export type StaticAssetName = (typeof STATIC_ASSET_NAMES)[number];

/** Case-insensitive lookup so a `/APP.JS` request still resolves. */
const KNOWN_ASSETS: Record<StaticAssetName, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
};

export function contentTypeFor(name: string): string | null {
  const normalised = name.toLowerCase();
  return KNOWN_ASSETS[normalised as StaticAssetName] ?? null;
}

/** Test seam: a fixed asset map, so no dashboard file has to exist on disk. */
export function createStaticAssetsFromMap(files: Record<string, string>): StaticAssets {
  return {
    async get(name) {
      const key = name.toLowerCase().replace(/^\/+/, '');
      return files[key] ?? null;
    },
  };
}

/** Read assets from a directory; unknown names return null and never throw. */
export function createFileStaticAssets(directory: string): StaticAssets {
  return {
    async get(name) {
      const normalised = name.toLowerCase().replace(/^\/+/, '');
      if (contentTypeFor(normalised) === null) {
        return null;
      }
      try {
        return await readFile(path.join(directory, normalised), 'utf8');
      } catch {
        return null;
      }
    },
  };
}
