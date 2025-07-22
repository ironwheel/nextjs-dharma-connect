// packages/backend/src/tableConfig.ts
export interface TableConfig {
  resource: string;
  envVar: string;
  pk: string;
  sk: string;
  ops: Array<'get' | 'list' | 'delete' | 'put' | 'count'>;
}

export const tables: TableConfig[] = [
  { resource: 'dryrun-recipients', envVar: 'DYNAMODB_TABLE_DRYRUN_RECIPIENTS', pk: 'campaignString', sk: '', ops: ['get', 'list'] },
  { resource: 'send-recipients', envVar: 'DYNAMODB_TABLE_SEND_RECIPIENTS', pk: 'campaignString', sk: '', ops: ['get', 'list'] },
  { resource: 'work-orders', envVar: 'DYNAMODB_TABLE_WORK_ORDERS', pk: 'id', sk: '', ops: ['get', 'list', 'put', 'delete'] },
  { resource: 'work-order-audit-logs', envVar: 'DYNAMODB_TABLE_WORK_ORDER_AUDIT_LOGS', pk: 'workOrderId', sk: 'timestamp', ops: ['get', 'list', 'put'] },
  { resource: 'students', envVar: 'DYNAMODB_TABLE_PARTICIPANTS', pk: 'id', sk: '', ops: ['get', 'list', 'count'] },
  { resource: 'prompts', envVar: 'DYNAMODB_TABLE_PROMPTS', pk: 'prompt', sk: '', ops: ['get', 'list'] },
  { resource: 'events', envVar: 'DYNAMODB_TABLE_EVENTS', pk: 'aid', sk: '', ops: ['get', 'list', 'count'] },
  { resource: 'stages', envVar: 'DYNAMODB_TABLE_STAGES', pk: 'stage', sk: '', ops: ['get', 'list'] },
  { resource: 'config', envVar: 'DYNAMODB_TABLE_CONFIG', pk: 'key', sk: '', ops: ['get', 'list'] },
  { resource: 'auth', envVar: 'DYNAMODB_TABLE_AUTH', pk: 'id', sk: '', ops: ['get'] },
  { resource: 'actions-profile', envVar: 'DYNAMODB_TABLE_ACTIONS_PROFILES', pk: 'profile', sk: '', ops: ['get'] },
  { resource: 'sessions', envVar: 'DYNAMODB_TABLE_SESSIONS', pk: 'id', sk: 'fingerprint', ops: ['get', 'put'] },
  { resource: 'verification-tokens', envVar: 'DYNAMODB_TABLE_VERIFICATION_TOKENS', pk: 'verificationTokenId', sk: '', ops: ['get', 'put'] },
  { resource: 'pools', envVar: 'DYNAMODB_TABLE_POOLS', pk: 'name', sk: '', ops: ['get', 'list', 'count'] },
  { resource: 'views', envVar: 'DYNAMODB_TABLE_VIEWS', pk: 'name', sk: '', ops: ['get', 'list', 'count'] },
  { resource: 'views-profiles', envVar: 'DYNAMODB_TABLE_VIEWS_PROFILES', pk: 'profile', sk: '', ops: ['get'] },
];

/**
 * Looks up a table config by resource name and returns the related config object
 * @param resource - The resource name to look up (e.g., 'prompts', 'students')
 * @returns The table config object
 * @throws Error if the table config is not found
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