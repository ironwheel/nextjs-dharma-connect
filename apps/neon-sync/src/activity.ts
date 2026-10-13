import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Change, Participant } from './types.ts';
import { log } from './log.ts';

export const SOURCE = 'neon-sync';

/** An activity log entry; see docs/ACTIVITY_LOG.md for the shared record format. */
export interface ActivityEntry {
  type: string;
  studentId?: string;
  studentName?: string;
  /** Human-readable; must not contain email addresses. */
  summary: string;
  /** Structured detail. Keys named in EMAIL_DETAIL_KEYS hold email addresses. */
  details?: Record<string, unknown>;
}

/** Detail keys whose values are email addresses: excluded from searchText and masked in the UI. */
export const EMAIL_DETAIL_KEYS = ['email', 'previousEmail'];

export function activityRecord(entry: ActivityEntry, now: Date, retentionDays: number) {
  const ts = now.toISOString();
  const searchable = [
    entry.type,
    SOURCE,
    entry.studentName,
    entry.studentId,
    entry.summary,
    ...Object.entries(entry.details ?? {})
      .filter(([key]) => !EMAIL_DETAIL_KEYS.includes(key))
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string' || typeof value === 'number'),
  ];
  return {
    day: ts.slice(0, 10),
    id: `${ts}#${randomBytes(3).toString('hex')}`,
    ts,
    source: SOURCE,
    ...entry,
    searchText: searchable.filter(Boolean).join(' ').toLowerCase(),
    expiresAt: Math.floor(now.getTime() / 1000) + retentionDays * 86_400,
  };
}

function fullName(first?: string, last?: string): string | undefined {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || undefined;
}

/** Describes an applied change for the activity log. */
export function activityForChange(change: Change, participant?: Participant): ActivityEntry {
  switch (change.kind) {
    case 'create': {
      const { item } = change;
      return {
        type: 'student.created',
        studentId: item.id,
        studentName: fullName(item.first, item.last),
        summary: `New student added from Neon account ${change.neonId}`,
        details: {
          neonId: change.neonId,
          email: item.email,
          programs: Object.keys(item.programs),
          ...(item.vajrayana ? { vajrayana: item.vajrayana } : {}),
        },
      };
    }
    case 'updateEmail':
      return {
        type: 'student.emailChanged',
        studentId: change.participantId,
        studentName: fullName(participant?.first, participant?.last),
        summary: change.clearEmailKeys.length
          ? `Email updated from Neon; ${change.clearEmailKeys.length} recent send(s) cleared for resend`
          : 'Email updated from Neon',
        details: {
          neonId: change.neonId,
          previousEmail: change.previousEmail,
          email: change.email,
          clearedSends: change.clearEmailKeys,
        },
      };
    case 'setVajrayana':
      return {
        type: 'student.updated',
        studentId: change.participantId,
        studentName: fullName(participant?.first, participant?.last),
        summary: `Vajrayana level set to ${change.value} from Neon`,
        details: { neonId: change.neonId, field: 'vajrayana', value: change.value },
      };
    case 'setProgramFlag':
      return {
        type: 'student.updated',
        studentId: change.participantId,
        studentName: fullName(participant?.first, participant?.last),
        summary: `programs.${change.program}.${change.flag} set from Neon`,
        details: { neonId: change.neonId, field: `programs.${change.program}.${change.flag}`, value: true },
      };
  }
}

/**
 * Writes activity entries. Logging is best effort: a failure is reported but
 * never fails the sync itself.
 */
export class ActivityLog {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly retentionDays: number;

  constructor(tableName: string, region: string, retentionDays: number) {
    this.tableName = tableName;
    this.retentionDays = retentionDays;
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async record(entry: ActivityEntry): Promise<void> {
    try {
      await this.db.send(
        new PutCommand({ TableName: this.tableName, Item: activityRecord(entry, new Date(), this.retentionDays) }),
      );
    } catch (err) {
      log.warn(`Activity log write failed (${entry.type}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
