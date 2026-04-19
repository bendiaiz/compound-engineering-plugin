/**
 * compound-engineering-plugin
 * Core entry point for the Compound Engineering Plugin
 * Provides utilities for PR triage, code review automation, and engineering workflows
 */

export { triagePRs } from './commands/triage-prs';
export { getConfig } from './config';
export type { PluginConfig, PRTriageOptions, PRSummary } from './types';

import { getConfig } from './config';

/**
 * Initialize the plugin with optional configuration overrides
 */
export async function init(configOverrides?: Partial<import('./types').PluginConfig>): Promise<void> {
  const config = await getConfig(configOverrides);

  if (config.debug) {
    console.log('[compound-engineering-plugin] Initialized with config:', JSON.stringify(config, null, 2));
  }
}
