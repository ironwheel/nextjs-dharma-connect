import type { Config } from './config.ts';
import type { NeonAccount } from './types.ts';
import { log } from './log.ts';

const PAGE_SIZE = 200; // Neon's maximum
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

const STANDARD_OUTPUT_FIELDS = [
  'Account ID',
  'First Name',
  'Last Name',
  'Email 1',
  'Deceased',
  'Do Not Contact',
] as const;

type SearchRow = Record<string, string | null>;

interface SearchResponse {
  pagination: { currentPage: number; totalPages: number; totalResults: number };
  searchResults: SearchRow[];
}

interface CustomField {
  id: string | number;
  name: string;
}

/** Minimal Neon CRM API v2 client (https://developer.neoncrm.com/api-v2/). */
export class NeonClient {
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(config: Config['neon']) {
    this.baseUrl = config.baseUrl;
    this.authorization = `Basic ${Buffer.from(`${config.orgId}:${config.apiKey}`).toString('base64')}`;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let retryable: string;
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: this.authorization,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return (await response.json()) as T;
        const detail = (await response.text()).slice(0, 300);
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`Neon ${method} ${path} failed: ${response.status} ${detail}`);
        }
        retryable = `${response.status} ${detail}`;
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof DOMException)) throw err;
        retryable = err.message; // network error or timeout
      }
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`Neon ${method} ${path} failed after ${attempt} attempts: ${retryable}`);
      }
      const delayMs = 1000 * 2 ** (attempt - 1);
      log.warn(`Neon ${method} ${path} attempt ${attempt} failed (${retryable}); retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /** Resolves custom field ids to the display names Neon uses as keys in search results. */
  async customFieldNames(fieldIds: readonly string[]): Promise<Map<string, string>> {
    const fields = await this.request<CustomField[]>('GET', '/customFields?category=Account');
    const byId = new Map(fields.map((field) => [String(field.id), field.name]));
    const missing = fieldIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new Error(`Neon account custom fields not found: ${missing.join(', ')}`);
    }
    return new Map(fieldIds.map((id) => [id, byId.get(id)!]));
  }

  /** Fetches every individual account with the standard fields plus the given custom fields. */
  async individualAccounts(customFieldIds: readonly string[]): Promise<NeonAccount[]> {
    const fieldNames = await this.customFieldNames(customFieldIds);
    const accounts = new Map<string, NeonAccount>();
    let totalResults = 0;

    for (let page = 0, totalPages = 1; page < totalPages; page++) {
      const result = await this.request<SearchResponse>('POST', '/accounts/search', {
        searchFields: [{ field: 'Account Type', operator: 'EQUAL', value: 'INDIVIDUAL' }],
        outputFields: [...STANDARD_OUTPUT_FIELDS, ...customFieldIds.map(Number)],
        pagination: { currentPage: page, pageSize: PAGE_SIZE },
      });
      totalPages = result.pagination.totalPages;
      totalResults = result.pagination.totalResults;
      for (const row of result.searchResults) {
        const account = toAccount(row, fieldNames);
        if (account) accounts.set(account.accountId, account);
      }
    }

    // Unsorted paging over a live dataset can shift rows between pages.
    if (accounts.size < totalResults) {
      log.warn(`Neon reported ${totalResults} individual accounts but ${accounts.size} were retrieved`);
    }
    return [...accounts.values()];
  }
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function toAccount(row: SearchRow, fieldNames: Map<string, string>): NeonAccount | null {
  const accountId = text(row['Account ID']);
  if (!accountId) return null;
  const custom: Record<string, string> = {};
  for (const [id, name] of fieldNames) {
    const value = text(row[name]);
    if (value) custom[id] = value;
  }
  return {
    accountId,
    firstName: text(row['First Name']),
    lastName: text(row['Last Name']),
    email: text(row['Email 1']),
    deceased: text(row['Deceased']) === 'Yes',
    doNotContact: text(row['Do Not Contact']) === 'Yes',
    custom,
  };
}
