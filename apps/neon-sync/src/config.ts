export interface Config {
  awsRegion: string;
  studentTable: string;
  neon: {
    baseUrl: string;
    orgId: string;
    apiKey: string;
  };
  /** Case-insensitive substrings; matching Neon accounts are never created as participants. */
  excludeFirstNames: string[];
  excludeLastNames: string[];
  resendWindowDays: number;
  maxCreates: number;
  maxEmailUpdates: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string, missing: string[]): string {
  const value = env[name]?.trim();
  if (!value) missing.push(name);
  return value ?? '';
}

function list(env: Env, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function nonNegativeInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const config: Config = {
    awsRegion: env.AWS_REGION?.trim() || 'us-east-1',
    studentTable: required(env, 'STUDENT_TABLE', missing),
    neon: {
      baseUrl: (env.NEON_API_BASE_URL?.trim() || 'https://api.neoncrm.com/v2').replace(/\/+$/, ''),
      orgId: required(env, 'NEON_ORG_ID', missing),
      apiKey: required(env, 'NEON_API_KEY', missing),
    },
    excludeFirstNames: list(env, 'NEON_SYNC_EXCLUDE_FIRST_NAMES'),
    excludeLastNames: list(env, 'NEON_SYNC_EXCLUDE_LAST_NAMES'),
    resendWindowDays: nonNegativeInt(env, 'NEON_SYNC_RESEND_WINDOW_DAYS', 7),
    maxCreates: nonNegativeInt(env, 'NEON_SYNC_MAX_CREATES', 25),
    maxEmailUpdates: nonNegativeInt(env, 'NEON_SYNC_MAX_EMAIL_UPDATES', 25),
  };
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return config;
}
