import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { log } from './log.ts';
import { NeonClient } from './neon.ts';
import { ParticipantTable } from './participants.ts';
import { CUSTOM_FIELD_IDS } from './programs.ts';
import { planSync, type Plan } from './reconcile.ts';
import type { Change } from './types.ts';

const USAGE = `Usage: neon-sync [options]

Syncs Neon CRM individual accounts into the participant table.

Options:
  --dry-run              Plan and log changes without writing anything
  --only <part>          Run only "accounts" (creates, programs, vajrayana) or "emails"
  --participant <id>     Limit updates to this participant id (repeatable); disables creates
  --force                Apply even if the run exceeds NEON_SYNC_MAX_CREATES / _MAX_EMAIL_UPDATES
  --verbose              Include names and email addresses in change logs
  -h, --help             Show this help

Configuration is read from the environment (and ./.env when run via pnpm); see .env.example.`;

function parseCli() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      only: { type: 'string' },
      participant: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.only !== undefined && values.only !== 'accounts' && values.only !== 'emails') {
    throw new Error(`--only must be "accounts" or "emails", got "${values.only}"`);
  }
  return values;
}

function describe(change: Change, verbose: boolean): string {
  switch (change.kind) {
    case 'create': {
      const { item } = change;
      const extras = [
        ...Object.keys(item.programs).map((p) => `programs.${p}`),
        ...(item.vajrayana ? [`vajrayana=${item.vajrayana}`] : []),
      ];
      const who = verbose ? ` "${item.first} ${item.last}" <${item.email}>` : '';
      return `create participant ${item.id} for neon ${change.neonId}${who}${extras.length ? ` [${extras.join(', ')}]` : ''}`;
    }
    case 'setVajrayana':
      return `set vajrayana=${change.value} on participant ${change.participantId} (neon ${change.neonId})`;
    case 'setProgramFlag':
      return `set programs.${change.program}.${change.flag}=true on participant ${change.participantId} (neon ${change.neonId})`;
    case 'updateEmail': {
      const addresses = verbose ? ` from <${change.previousEmail}> to <${change.email}>` : '';
      const cleared = change.clearEmailKeys.length
        ? `, clearing recent sends: ${change.clearEmailKeys.join(', ')}`
        : '';
      return `update email on participant ${change.participantId} (neon ${change.neonId})${addresses}${cleared}`;
    }
  }
}

function count(plan: Plan, kind: Change['kind']): number {
  return plan.changes.filter((c) => c.kind === kind).length;
}

async function main(): Promise<number> {
  const args = parseCli();
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const config = loadConfig();
  const dryRun = args['dry-run'];
  log.info(`neon-sync starting${dryRun ? ' (dry run)' : ''}${args.only ? `, only ${args.only}` : ''}`);

  const neon = new NeonClient(config.neon);
  const table = new ParticipantTable(config.studentTable, config.awsRegion);
  const [accounts, participants] = await Promise.all([
    neon.individualAccounts(CUSTOM_FIELD_IDS),
    table.scanAll(),
  ]);
  log.info(`Loaded ${accounts.length} Neon individual accounts and ${participants.length} participants`);

  const plan = planSync(participants, accounts, {
    accounts: args.only !== 'emails',
    emails: args.only !== 'accounts',
    participantIds: args.participant?.length ? new Set(args.participant) : undefined,
    excludeFirstNames: config.excludeFirstNames,
    excludeLastNames: config.excludeLastNames,
    resendWindowDays: config.resendWindowDays,
    now: new Date(),
    newId: randomUUID,
  });

  for (const [reason, ids] of Object.entries(plan.skipped)) {
    if (!ids.length) continue;
    // These are routine and large; the rest deserve a look.
    const routine = reason === 'neonDoNotContact' || reason === 'neonDeceased';
    const detail = routine || ids.length > 50 ? '' : `: ${ids.join(', ')}`;
    (routine ? log.info : log.warn)(`Skipped ${ids.length} (${reason})${detail}`);
  }

  const creates = count(plan, 'create');
  const emailUpdates = count(plan, 'updateEmail');
  const overLimit = [
    creates > config.maxCreates && `${creates} creates exceed NEON_SYNC_MAX_CREATES=${config.maxCreates}`,
    emailUpdates > config.maxEmailUpdates &&
      `${emailUpdates} email updates exceed NEON_SYNC_MAX_EMAIL_UPDATES=${config.maxEmailUpdates}`,
  ].filter((s): s is string => Boolean(s));
  if (overLimit.length && !args.force && !dryRun) {
    for (const message of overLimit) log.error(message);
    log.error('Refusing to write. Review with --dry-run, then rerun with --force if the changes are expected.');
    return 2;
  }
  for (const message of overLimit) log.warn(message);

  const results = { applied: 0, conflict: 0, failed: 0 };
  for (const change of plan.changes) {
    const description = describe(change, args.verbose);
    if (dryRun) {
      log.info(`[dry run] ${description}`);
      continue;
    }
    try {
      const result = await table.apply(change);
      results[result]++;
      if (result === 'applied') log.info(description);
      else log.warn(`Skipped (record changed since it was read): ${description}`);
    } catch (err) {
      results.failed++;
      log.error(`Failed: ${description}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = [
    `${creates} creates`,
    `${count(plan, 'setVajrayana')} vajrayana updates`,
    `${count(plan, 'setProgramFlag')} program flag updates`,
    `${emailUpdates} email updates`,
  ].join(', ');
  if (dryRun) {
    log.info(`Dry run planned ${summary}`);
    return 0;
  }
  log.info(`Planned ${summary}; applied ${results.applied}, conflicts ${results.conflict}, failed ${results.failed}`);
  return results.failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  },
);
