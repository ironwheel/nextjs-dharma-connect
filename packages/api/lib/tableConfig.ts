/**
 * @file packages/api/lib/tableConfig.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the configuration for all the DynamoDB tables used in the application.
 */

export interface TableConfig {
  resource: string;
  envVar: string;
  pk: string;
  sk: string;
  ops: Array<'get' | 'list' | 'delete' | 'put' | 'count' | 'update' | 'query'>;
}

export const tables: TableConfig[] = [
  { resource: 'dryrun-recipients', envVar: 'DYNAMODB_TABLE_DRYRUN_RECIPIENTS', pk: 'campaignString', sk: '', ops: ['get', 'list'] },
  { resource: 'send-recipients', envVar: 'DYNAMODB_TABLE_SEND_RECIPIENTS', pk: 'campaignString', sk: '', ops: ['get', 'list'] },
  { resource: 'work-orders', envVar: 'DYNAMODB_TABLE_WORK_ORDERS', pk: 'id', sk: '', ops: ['get', 'list', 'put', 'delete', 'update'] },
  { resource: 'work-order-audit-logs', envVar: 'DYNAMODB_TABLE_WORK_ORDER_AUDIT_LOGS', pk: 'workOrderId', sk: 'timestamp', ops: ['get', 'list', 'put'] },
  { resource: 'students', envVar: 'DYNAMODB_TABLE_PARTICIPANTS', pk: 'id', sk: '', ops: ['get', 'put', 'list', 'count', 'update'] },
  { resource: 'prompts', envVar: 'DYNAMODB_TABLE_PROMPTS', pk: 'prompt', sk: 'language', ops: ['get', 'list', 'put', 'delete'] },
  { resource: 'events', envVar: 'DYNAMODB_TABLE_EVENTS', pk: 'aid', sk: '', ops: ['get', 'list', 'count', 'put', 'delete'] },
  { resource: 'stages', envVar: 'DYNAMODB_TABLE_STAGES', pk: 'stage', sk: '', ops: ['get', 'list'] },
  { resource: 'config', envVar: 'DYNAMODB_TABLE_CONFIG', pk: 'key', sk: '', ops: ['get', 'list'] },
  { resource: 'auth', envVar: 'DYNAMODB_TABLE_AUTH', pk: 'id', sk: '', ops: ['get', 'put'] },
  { resource: 'actions-profile', envVar: 'DYNAMODB_TABLE_ACTIONS_PROFILES', pk: 'profile', sk: '', ops: ['get', 'list'] },
  { resource: 'sessions', envVar: 'DYNAMODB_TABLE_SESSIONS', pk: 'id', sk: 'fingerprint', ops: ['get', 'put'] },
  { resource: 'verification-tokens', envVar: 'DYNAMODB_TABLE_VERIFICATION_TOKENS', pk: 'verificationTokenId', sk: '', ops: ['get', 'put'] },
  { resource: 'pools', envVar: 'DYNAMODB_TABLE_POOLS', pk: 'name', sk: '', ops: ['get', 'list', 'count', 'put', 'delete'] },
  { resource: 'scripts', envVar: 'DYNAMODB_TABLE_SCRIPTS', pk: 'name', sk: '', ops: ['get', 'list', 'count', 'put', 'delete'] },
  { resource: 'offering-config', envVar: 'DYNAMODB_TABLE_OFFERING_CONFIG', pk: 'oid', sk: '', ops: ['get', 'list', 'count', 'put', 'delete'] },
  { resource: 'views', envVar: 'DYNAMODB_TABLE_VIEWS', pk: 'name', sk: '', ops: ['get', 'list', 'count', 'put', 'delete'] },
  { resource: 'views-profiles', envVar: 'DYNAMODB_TABLE_VIEWS_PROFILES', pk: 'profile', sk: '', ops: ['get', 'list'] },
  { resource: 'app.actions', envVar: 'DYNAMODB_TABLE_APP_ACTIONS', pk: 'host', sk: '', ops: ['get'] },
  { resource: 'eligibility-cache', envVar: 'DYNAMODB_TABLE_ELIGIBILITY_CACHE', pk: 'aid', sk: '', ops: ['get', 'put', 'list', 'delete'] },
  { resource: 'mantra-count', envVar: 'DYNAMODB_TABLE_MANTRA_COUNT', pk: 'id', sk: '', ops: ['get', 'put', 'list', 'update'] },
  { resource: 'mantra-config', envVar: 'DYNAMODB_TABLE_MANTRA_CONFIG', pk: 'id', sk: '', ops: ['get', 'put', 'list', 'update'] },
  { resource: 'sd-prompts-cache', envVar: 'DYNAMODB_TABLE_PROMPTS_CACHE', pk: 'eventCode', sk: 'promptKey', ops: ['get', 'list', 'query'] },
  { resource: 'refunds', envVar: 'DYNAMODB_TABLE_REFUNDS', pk: 'stripePaymentIntent', sk: '', ops: ['get', 'list', 'put'] },
  { resource: 'versions', envVar: 'DYNAMODB_TABLE_VERSIONS', pk: 'gitSHA', sk: '', ops: ['get', 'list', 'put'] },
  { resource: 'transactions', envVar: 'DYNAMODB_TABLE_TRANSACTIONS', pk: 'transaction', sk: '', ops: ['get', 'update'] },
];

/**
 * @function tableGetConfig
 * @description Looks up a table config by resource name and returns the related config object.
 * @param {string} resource - The resource name to look up (e.g., 'prompts', 'students').
 * @returns {TableConfig & { tableName: string }} The table config object.
 * @throws {Error} If the table config is not found.
 */
export function tableGetConfig(resource: string): TableConfig & { tableName: string } {
  const cfg = tables.find((t: TableConfig) => t.resource === resource);
  if (!cfg) {
    throw new Error(`Can't find ${resource} table config`);
  }

  // check env var is set
  const tableName = process.env[cfg.envVar];
  if (!tableName) {
    throw new Error(`Environment variable ${cfg.envVar} is not set for ${resource} table`);
  }

  return { ...cfg, tableName };
}