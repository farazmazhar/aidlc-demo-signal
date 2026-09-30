/**
 * `signal-api` Lambda entrypoint.
 *
 * Thin by design: read configuration for this invocation (FR6.2), build the
 * adapters, and hand the proxy event to the same handler the unit tests drive.
 */

import { createHandler } from '../api/handler';
import type { ApiHandler, ProxyEvent } from '../api/handler';
import { loadConfig } from '../config/config';
import { buildApiDependencies } from './dependencies';

export const handler: ApiHandler = async (event: ProxyEvent, context?: unknown) => {
  const config = loadConfig(process.env);
  if (config.apiStageName.length === 0) {
    throw new Error('API_STAGE_NAME must not be empty.');
  }
  return createHandler(buildApiDependencies(config))(event, context);
};

export default handler;
