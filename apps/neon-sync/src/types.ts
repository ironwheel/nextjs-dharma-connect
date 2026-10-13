/** A Neon CRM individual account, normalized from a v2 account search row. */
export interface NeonAccount {
  accountId: string;
  firstName: string;
  lastName: string;
  /** Trimmed "Email 1"; empty string when Neon has none. */
  email: string;
  deceased: boolean;
  doNotContact: boolean;
  /** Non-blank custom field values keyed by Neon custom field id. */
  custom: Record<string, string>;
}

export type ProgramState = Record<string, unknown>;

/** The subset of a participant record this service reads. */
export interface Participant {
  id: string;
  neonId?: string;
  first?: string;
  last?: string;
  email?: string;
  unsubscribe?: boolean;
  vajrayana?: string;
  programs?: Record<string, ProgramState>;
  /** Campaign key -> ISO send timestamp (or a boolean on very old records). */
  emails?: Record<string, string | boolean>;
}

/** A complete participant record as written for a newly discovered Neon account. */
export interface NewParticipant {
  id: string;
  neonId: string;
  first: string;
  last: string;
  email: string;
  programs: Record<string, ProgramState>;
  emails: Record<string, never>;
  beta: false;
  translate: false;
  unsubscribe: false;
  language: string;
  vajrayana?: string;
}

export type Change =
  | { kind: 'create'; neonId: string; item: NewParticipant }
  | { kind: 'setVajrayana'; participantId: string; neonId: string; value: string }
  | {
      kind: 'setProgramFlag';
      participantId: string;
      neonId: string;
      program: string;
      flag: string;
      /** Whether programs.<program> already exists, so only the nested flag needs setting. */
      programExists: boolean;
    }
  | {
      kind: 'updateEmail';
      participantId: string;
      neonId: string;
      previousEmail: string;
      email: string;
      /** emails.<key> entries sent recently enough that they should go out again to the new address. */
      clearEmailKeys: string[];
    };
