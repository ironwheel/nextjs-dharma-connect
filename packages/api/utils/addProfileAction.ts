// @ts-nocheck
/**
 * @file packages/api/utils/addProfileAction.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2026
 * @license MIT
 * @description Adds one operation to app actions profiles, without touching
 * the rest of each profile's list.
 *
 * Profiles are chosen by name, or by an operation they already grant (--like),
 * which is how a new route reaches every app that uses an existing feature: for
 * the version badge, every profile granting GET/table/versions also needs
 * GET/deploy/version.
 *
 * Dry run unless --apply is given. Each write is conditional on the operation
 * still being absent, so running it twice changes nothing.
 *
 * Usage (from packages/api, with .env.local providing AWS_REGION and
 * DYNAMODB_TABLE_ACTIONS_PROFILES):
 *   node utils/addProfileAction.ts GET/deploy/version --like GET/table/versions
 *   node utils/addProfileAction.ts GET/deploy/version --like GET/table/versions --apply
 *   node utils/addProfileAction.ts GET/deploy/version --profile <name> [--profile <name>] --apply
 */
const { DynamoDBClient, ScanCommand, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const args = process.argv.slice(2);
const action = args[0];
const apply = args.includes('--apply');
const like = valueOf('--like');
const named = valuesOf('--profile');

function valueOf(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
function valuesOf(flag) {
    return args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
}

if (!action || action.startsWith('--') || (!like && named.length === 0)) {
    console.error('Usage: node utils/addProfileAction.ts <METHOD/subsystem/resource> (--like <existing operation> | --profile <name>...) [--apply]');
    process.exit(1);
}

const TABLE_NAME = process.env.DYNAMODB_TABLE_ACTIONS_PROFILES;
if (!TABLE_NAME) {
    console.error('DYNAMODB_TABLE_ACTIONS_PROFILES is not set (packages/api/.env.local).');
    process.exit(1);
}
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

/** A profile's actions as plain strings, from either stored form. */
function actionsOf(item) {
    const a = item?.actions;
    if (a?.L) return a.L.map((v) => v.S).filter(Boolean);
    if (a?.SS) return a.SS;
    if (a?.S) {
        try { return JSON.parse(a.S); } catch { return []; }
    }
    return [];
}

async function profiles() {
    if (named.length > 0) {
        const out = [];
        for (const name of named) {
            const { Item } = await client.send(new GetItemCommand({ TableName: TABLE_NAME, Key: { profile: { S: name } } }));
            if (!Item) console.warn(`  ${name}: no such profile, skipped`);
            else out.push(Item);
        }
        return out;
    }
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await client.send(new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey }));
        out.push(...(page.Items ?? []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out.filter((item) => actionsOf(item).includes(like));
}

async function run() {
    const items = await profiles();
    console.log(`${apply ? 'Adding' : 'Would add'} ${action} to ${items.length} profile(s) in ${TABLE_NAME}:`);
    for (const item of items) {
        const name = item.profile?.S;
        const actions = actionsOf(item);
        if (actions.includes(action)) {
            console.log(`  ${name}: already has it`);
            continue;
        }
        if (!item.actions?.L) {
            // Rewriting a string or set form would change how the profile is stored; do it by hand.
            console.log(`  ${name}: actions are not stored as a list, skipped (add it by hand)`);
            continue;
        }
        if (!apply) {
            console.log(`  ${name}: would add`);
            continue;
        }
        try {
            await client.send(new UpdateItemCommand({
                TableName: TABLE_NAME,
                Key: { profile: { S: name } },
                UpdateExpression: 'SET actions = list_append(actions, :new)',
                ConditionExpression: 'NOT contains(actions, :one)',
                ExpressionAttributeValues: { ':new': { L: [{ S: action }] }, ':one': { S: action } },
            }));
            console.log(`  ${name}: added`);
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') console.log(`  ${name}: already has it`);
            else throw err;
        }
    }
    if (!apply) console.log('Dry run: nothing written. Re-run with --apply to write.');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
