/**
 * @file packages/api/utils/verifyAudioEntitlement.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Exercises the audio entitlement decision against live DynamoDB records.
 *
 * Audio authorization is the one place in this codebase where a wrong answer hands a
 * student media they are not entitled to, so the rules are checked against the real
 * events, pools and student records rather than fixtures that can drift from them.
 *
 * Read-only. Uses your cached AWS credentials:
 *
 *     AWS_PROFILE=slsupport npx tsx packages/api/utils/verifyAudioEntitlement.ts
 *
 * Optional overrides: AUDIO_VERIFY_AID (default vy2026),
 *                     AUDIO_VERIFY_SUBEVENT (default the first complete sub-event).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
    checkAudioStructuralGate,
    studentMayReachEvent,
    validateAudioRequest,
} from '../lib/audio';

const REGION = process.env.AWS_REGION || 'us-east-1';
const EVENTS_TABLE = process.env.DYNAMODB_TABLE_EVENTS || 'events';
const POOLS_TABLE = process.env.DYNAMODB_TABLE_POOLS || 'pools';
const STUDENTS_TABLE = process.env.DYNAMODB_TABLE_PARTICIPANTS || 'foundations.participants';
const AID = process.env.AUDIO_VERIFY_AID || 'vy2026';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) {
        console.log(`        expected ${JSON.stringify(expected)}`);
        console.log(`        actual   ${JSON.stringify(actual)}`);
    }
}

async function scanAll(tableName: string, projection?: string): Promise<any[]> {
    const items: any[] = [];
    let ExclusiveStartKey: any;
    do {
        const response: any = await client.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey,
            ProjectionExpression: projection,
        }));
        items.push(...(response.Items || []));
        ExclusiveStartKey = response.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

/**
 * Find one student the event's pool admits and one it does not, so the eligibility checks
 * run against records that actually exist rather than hand-built ones.
 */
async function findRepresentativeStudents(event: any, pools: any[]) {
    let admitted: any = null;
    let refused: any = null;
    let ExclusiveStartKey: any;
    do {
        const response: any = await client.send(new ScanCommand({
            TableName: STUDENTS_TABLE,
            ExclusiveStartKey,
            ProjectionExpression: 'id, programs, practice',
        }));
        for (const student of response.Items || []) {
            const reaches = studentMayReachEvent(event, 'any', student, pools, null);
            if (reaches && !admitted) admitted = student;
            if (!reaches && !refused) refused = student;
        }
        if (admitted && refused) break;
        ExclusiveStartKey = response.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { admitted, refused };
}

async function main(): Promise<void> {
    console.log(`Verifying audio entitlement against ${AID} in ${REGION}\n`);

    const [eventResponse, pools] = await Promise.all([
        client.send(new GetCommand({ TableName: EVENTS_TABLE, Key: { aid: AID } })),
        scanAll(POOLS_TABLE),
    ]);
    const event: any = (eventResponse as any).Item;
    if (!event) throw new Error(`No event record for aid '${AID}'`);
    console.log(`event '${AID}' pool: ${event.config?.pool}, ${pools.length} pools loaded`);

    const subEventNames = Object.keys(event.subEvents || {});
    const released = process.env.AUDIO_VERIFY_SUBEVENT
        || subEventNames.find((n) => event.subEvents[n].eventOnDeck && event.subEvents[n].eventComplete);
    const unreleased = subEventNames.find((n) => !event.subEvents[n].eventComplete);
    if (!released) throw new Error(`No released sub-event in '${AID}'`);
    console.log(`released sub-event: ${released}, unreleased: ${unreleased ?? '(none)'}\n`);

    console.log('--- request validation: identifiers reach S3 keys and map paths ---');
    check('well-formed request', validateAudioRequest(AID, released, 0, 'English'), true);
    check('path traversal in aid', validateAudioRequest('../../etc', released, 0, 'English'), false);
    check('slash in subEvent', validateAudioRequest(AID, 'a/b', 0, 'English'), false);
    check('non-alphabetic language', validateAudioRequest(AID, released, 0, 'Engl1sh'), false);
    check('empty language', validateAudioRequest(AID, released, 0, ''), false);
    check('negative index', validateAudioRequest(AID, released, -1, 'English'), false);
    check('non-integer index', validateAudioRequest(AID, released, 1.5, 'English'), false);
    check('NaN index', validateAudioRequest(AID, released, NaN, 'English'), false);
    check('absurd index', validateAudioRequest(AID, released, 100000, 'English'), false);

    console.log('\n--- structural gate against the live event record ---');
    check('unknown sub-event', checkAudioStructuralGate(event, 'no-such-subevent', 0, 'English'),
        { ok: false, reason: 'NO_SUCH_SUBEVENT' });
    if (unreleased) {
        check('unreleased sub-event', checkAudioStructuralGate(event, unreleased, 0, 'English'),
            { ok: false, reason: 'SUBEVENT_NOT_RELEASED' });
    }

    // A copy carrying audio, shaped as utils/upload_event_audio.py writes it.
    const staged = JSON.parse(JSON.stringify(event));
    staged.subEvents[released].embeddedAudioList = [{
        English: { key: `a/${AID}/${released}/0/English.m4a`, durationSec: 8412, bytes: 101234567 },
        Spanish: { key: `a/${AID}/${released}/0/Spanish.m4a`, durationSec: 8390, bytes: 100111222 },
    }];
    if (unreleased) {
        staged.subEvents[unreleased].embeddedAudioList = [{
            English: { key: `a/${AID}/${unreleased}/0/English.m4a`, durationSec: 100, bytes: 1000 },
        }];
    }

    check('audio present', checkAudioStructuralGate(staged, released, 0, 'English'),
        { ok: true, asset: { key: `a/${AID}/${released}/0/English.m4a`, durationSec: 8412, bytes: 101234567, uploadedAt: undefined } });
    check('language not uploaded', checkAudioStructuralGate(staged, released, 0, 'French'),
        { ok: false, reason: 'NO_SUCH_AUDIO' });
    check('index beyond the list', checkAudioStructuralGate(staged, released, 1, 'English'),
        { ok: false, reason: 'NO_SUCH_AUDIO' });
    if (unreleased) {
        check('audio staged on an unreleased sub-event stays blocked',
            checkAudioStructuralGate(staged, unreleased, 0, 'English'),
            { ok: false, reason: 'SUBEVENT_NOT_RELEASED' });
    }

    console.log('\n--- eligibility against real student records ---');
    const { admitted, refused } = await findRepresentativeStudents(event, pools);
    if (!admitted || !refused) {
        console.log('SKIP  no admitted/refused student pair found in the students table');
    } else {
        console.log(`        admitted student ${String(admitted.id).slice(0, 8)}…, refused ${String(refused.id).slice(0, 8)}…`);
        check('admitted student reaches the event',
            studentMayReachEvent(event, released, admitted, pools, null), true);
        check('refused student does not',
            studentMayReachEvent(event, released, refused, pools, null), false);
        check('refused student still blocked when every event is considered',
            studentMayReachEvent(event, released, refused, pools, [event]), false);

        // The showcase path: an event the refused student does pass, pointing here.
        if (pools.some((p) => p.name === 'all')) {
            const showcaseHost = {
                aid: '__showcase_probe',
                config: { pool: 'all' },
                showcaseVideoList: [{ aid: AID, subevent: released }],
            };
            check('showcase reference grants reach to the referenced sub-event',
                studentMayReachEvent(event, released, refused, pools, [event, showcaseHost]), true);
            const other = subEventNames.find((n) => n !== released);
            if (other) {
                check('showcase reference does not leak to other sub-events',
                    studentMayReachEvent(event, other, refused, pools, [event, showcaseHost]), false);
            }
        }
    }

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
