// @ts-nocheck
const {
    IAMClient,
    CreateRoleCommand,
    PutRolePolicyCommand,
    GetRoleCommand,
    UpdateAssumeRolePolicyCommand
} = require("@aws-sdk/client-iam");
const {
    DynamoDBClient,
    GetItemCommand,
    UpdateItemCommand
} = require("@aws-sdk/client-dynamodb");
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = "011754621643";
const PROXY_ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/DharmaConnectOIDCProxy`;

// Helper to construct SQS ARN from URL
function getQueueArn(queueUrl) {
    if (!queueUrl) return null;
    // URL format: https://sqs.REGION.amazonaws.com/ACCOUNT/QUEUE_NAME
    try {
        const parts = queueUrl.split('/');
        const queueName = parts[parts.length - 1];
        return `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${queueName}`;
    } catch (e) {
        console.warn("Failed to parse queue URL:", queueUrl);
        return null;
    }
}

// Initialize Clients
const iamClient = new IAMClient({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });

const APP_NAME = process.argv[2];

if (!APP_NAME) {
    console.error("Usage: npx ts-node utils/createAppRole.ts <app-name>");
    process.exit(1);
}

// Table Config Copy (from packages/api/lib/tableConfig.ts)
const tables = [
    { resource: 'dryrun-recipients', envVar: 'DYNAMODB_TABLE_DRYRUN_RECIPIENTS' },
    { resource: 'send-recipients', envVar: 'DYNAMODB_TABLE_SEND_RECIPIENTS' },
    { resource: 'work-orders', envVar: 'DYNAMODB_TABLE_WORK_ORDERS' },
    { resource: 'work-order-audit-logs', envVar: 'DYNAMODB_TABLE_WORK_ORDER_AUDIT_LOGS' },
    { resource: 'students', envVar: 'DYNAMODB_TABLE_PARTICIPANTS' },
    { resource: 'prompts', envVar: 'DYNAMODB_TABLE_PROMPTS' },
    { resource: 'events', envVar: 'DYNAMODB_TABLE_EVENTS' },
    { resource: 'stages', envVar: 'DYNAMODB_TABLE_STAGES' },
    { resource: 'config', envVar: 'DYNAMODB_TABLE_CONFIG' },
    { resource: 'auth', envVar: 'DYNAMODB_TABLE_AUTH' },
    { resource: 'actions-profile', envVar: 'DYNAMODB_TABLE_ACTIONS_PROFILES' },
    { resource: 'sessions', envVar: 'DYNAMODB_TABLE_SESSIONS' },
    { resource: 'verification-tokens', envVar: 'DYNAMODB_TABLE_VERIFICATION_TOKENS' },
    { resource: 'pools', envVar: 'DYNAMODB_TABLE_POOLS' },
    { resource: 'scripts', envVar: 'DYNAMODB_TABLE_SCRIPTS' },
    { resource: 'offering-config', envVar: 'DYNAMODB_TABLE_OFFERING_CONFIG' },
    { resource: 'views', envVar: 'DYNAMODB_TABLE_VIEWS' },
    { resource: 'views-profiles', envVar: 'DYNAMODB_TABLE_VIEWS_PROFILES' },
    { resource: 'app.actions', envVar: 'DYNAMODB_TABLE_APP_ACTIONS' },
    { resource: 'eligibility-cache', envVar: 'DYNAMODB_TABLE_ELIGIBILITY_CACHE' },
    { resource: 'mantra-count', envVar: 'DYNAMODB_TABLE_MANTRA_COUNT' },
    { resource: 'mantra-config', envVar: 'DYNAMODB_TABLE_MANTRA_CONFIG' },
    { resource: 'sd-prompts-cache', envVar: 'DYNAMODB_TABLE_PROMPTS_CACHE' },
    { resource: 'refunds', envVar: 'DYNAMODB_TABLE_REFUNDS' },
    { resource: 'versions', envVar: 'DYNAMODB_TABLE_VERSIONS' },
    { resource: 'transactions', envVar: 'DYNAMODB_TABLE_TRANSACTIONS' },
    { resource: 'transactions-cache', envVar: 'DYNAMODB_TABLE_TRANSACTIONS_CACHE' },
    { resource: 'auditors', envVar: 'DYNAMODB_TABLE_AUDITORS' },
    { resource: 'signers', envVar: 'DYNAMODB_TABLE_SIGNERS' },
];

function getTableArn(resource) {
    const tableCfg = tables.find(t => t.resource === resource);
    if (!tableCfg) {
        throw new Error(`Unknown resource slug: ${resource}`);
    }
    const tableName = process.env[tableCfg.envVar];
    if (!tableName) {
        throw new Error(`Environment variable ${tableCfg.envVar} not set for resource ${resource}`);
    }
    return `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}`;
}

function mapAppActionsToPermissions(appActions) {
    const policyStatements = [];

    // Group by AWS Action to consolidate resources
    const readTables = new Set();
    const writeTables = new Set();
    const scanTables = new Set();
    const queryTables = new Set();
    const sqsQueues = new Set();

    appActions.forEach(action => {
        // Generic Table Access: GET/table/XYZ, POST/table/XYZ, PUT/table/XYZ
        const tableMatch = action.match(/^(GET|POST|PUT)\/table\/(.+)$/);
        if (tableMatch) {
            const verb = tableMatch[1];
            const resourceSlug = tableMatch[2];

            try {
                const tableArn = getTableArn(resourceSlug);

                if (verb === 'GET') {
                    readTables.add(tableArn);
                    queryTables.add(tableArn);
                    queryTables.add(`${tableArn}/index/*`);
                    scanTables.add(tableArn);
                } else if (verb === 'POST' || verb === 'PUT') {
                    writeTables.add(tableArn);
                }
            } catch (e) {
                console.warn(`Warning: Could not map action '${action}' to a table ARN: ${e.message}`);
            }
        }

        // Specific Endpoint Mapping
        switch (action) {
            case 'GET/refunds/list':
                try {
                    const arn = getTableArn('refunds');
                    scanTables.add(arn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/refunds/request':
                try {
                    const refundsArn = getTableArn('refunds');
                    const studentsArn = getTableArn('students');
                    const eventsArn = getTableArn('events');

                    writeTables.add(refundsArn); // PutItem
                    scanTables.add(refundsArn);  // Scan (for guard rail)

                    readTables.add(studentsArn); // GetItem (approvers)
                    readTables.add(eventsArn);   // GetItem (email)
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/refunds/check':
                try {
                    const refundsArn = getTableArn('refunds');
                    const studentsArn = getTableArn('students');

                    readTables.add(refundsArn); // BatchGet
                    readTables.add(studentsArn); // BatchGet (approvers lookup)
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/refunds/process':
                try {
                    const refundsArn = getTableArn('refunds');
                    const txArn = getTableArn('transactions');
                    const studentsArn = getTableArn('students');

                    writeTables.add(refundsArn);
                    readTables.add(refundsArn);

                    writeTables.add(txArn);
                    readTables.add(txArn);

                    writeTables.add(studentsArn);
                    readTables.add(studentsArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'GET/stripe/retrieve':
                // No AWS perms needed
                break;
            case 'POST/stripe/refund':
                // No AWS perms needed (handled by process but good to note)
                break;

            // Student Manager / Auth Actions
            case 'POST/auth/getActionsProfiles':
                try {
                    const tableArn = getTableArn('actions-profile');
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/auth/getAuthList':
                try {
                    const tableArn = getTableArn('auth');
                    readTables.add(tableArn); // Scan usually needed for listAll, but listAll uses Scan.
                    scanTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/auth/putAuthItem':
                try {
                    const tableArn = getTableArn('auth');
                    writeTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/auth/linkEmailSend':
                try {
                    // logic in authUtils.ts linkEmailSend
                    // reads auth table (user perms), students (target), auditors, prompts
                    const authArn = getTableArn('auth');
                    const studentsArn = getTableArn('students');
                    const auditorsArn = getTableArn('auditors');
                    const promptsArn = getTableArn('prompts');

                    readTables.add(authArn);
                    readTables.add(studentsArn);
                    readTables.add(auditorsArn);

                    // getPromptsForAid uses listAllFiltered -> Scan
                    readTables.add(promptsArn);
                    scanTables.add(promptsArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/auth/getConfigValue':
                try {
                    const tableArn = getTableArn('auth');
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/auth/getRegistrationLink':
                try {
                    const authArn = getTableArn('auth');
                    readTables.add(authArn);
                } catch (e) { console.warn(e.message); }
                break;

            // Pools Table - POST can be used for chunked listing (Scan)
            case 'POST/table/pools':
                try {
                    const tableArn = getTableArn('pools');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;

            // Stages Table - POST can be used for chunked listing (Scan)
            case 'POST/table/stages':
                try {
                    const tableArn = getTableArn('stages');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;

            // Fix for chunked scanning (POST)
            case 'POST/table/offering-config':
                try {
                    const tableArn = getTableArn('offering-config');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/scripts':
                try {
                    const tableArn = getTableArn('scripts');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/prompts':
                try {
                    const tableArn = getTableArn('prompts');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/views':
                try {
                    const tableArn = getTableArn('views');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/events':
                try {
                    const tableArn = getTableArn('events');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/transactions-cache':
                try {
                    const tableArn = getTableArn('transactions-cache');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/transactions':
                try {
                    const tableArn = getTableArn('transactions');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;
            case 'POST/table/views-profiles':
                try {
                    const tableArn = getTableArn('views-profiles');
                    scanTables.add(tableArn);
                    readTables.add(tableArn);
                } catch (e) { console.warn(e.message); }
                break;

            // Email Manager SQS
            case 'POST/sqs/send':
                const queueUrl = process.env.SQS_QUEUE_URL;
                if (queueUrl) {
                    const queueArn = getQueueArn(queueUrl);
                    if (queueArn) sqsQueues.add(queueArn);
                } else {
                    console.warn("Warning: SQS_QUEUE_URL not set in environment.");
                }
                break;
            case 'POST/websocket/workorders':
            case 'POST/websocket/work-orders':
                // No specific Dynamo permission needed
                break;
        }
    });

    // Construct Statements
    if (readTables.size > 0) {
        policyStatements.push({
            Sid: "DynamoRead",
            Effect: "Allow",
            Action: [
                "dynamodb:GetItem",
                "dynamodb:BatchGetItem"
            ],
            Resource: Array.from(readTables)
        });
    }

    if (queryTables.size > 0) {
        policyStatements.push({
            Sid: "DynamoQuery",
            Effect: "Allow",
            Action: ["dynamodb:Query"],
            Resource: Array.from(queryTables)
        });
    }

    if (scanTables.size > 0) {
        policyStatements.push({
            Sid: "DynamoScan",
            Effect: "Allow",
            Action: ["dynamodb:Scan"],
            Resource: Array.from(scanTables)
        });
    }

    if (writeTables.size > 0) {
        policyStatements.push({
            Sid: "DynamoWrite",
            Effect: "Allow",
            Action: [
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem"
            ],
            Resource: Array.from(writeTables)
        });
    }

    if (sqsQueues.size > 0) {
        policyStatements.push({
            Sid: "SQSWrite",
            Effect: "Allow",
            Action: [
                "sqs:SendMessage",
                "sqs:GetQueueUrl",
                "sqs:GetQueueAttributes"
            ],
            Resource: Array.from(sqsQueues)
        });
    }

    return {
        Version: "2012-10-17",
        Statement: policyStatements
    };
}

async function main() {
    console.log(`Processing role creation for app: ${APP_NAME}`);

    // 1. Fetch App Actions
    const tableCmd = new GetItemCommand({
        TableName: "actions.profiles",
        Key: { "profile": { S: APP_NAME } }
    });
    const tableRes = await dynamoClient.send(tableCmd);

    if (!tableRes.Item) {
        console.error(`App profile '${APP_NAME}' not found in actions.profiles table.`);
        process.exit(1);
    }

    const appActions = (tableRes.Item.actions && tableRes.Item.actions.L)
        ? tableRes.Item.actions.L.map(item => item.S).filter(Boolean)
        : [];

    // Manual Overrides
    if (APP_NAME === 'email-manager') {
        if (!appActions.includes('POST/table/students')) {
            appActions.push('POST/table/students');
        }
    }

    console.log(`Found ${appActions.length} actions for ${APP_NAME}`);

    console.log(`Found ${appActions.length} actions for ${APP_NAME}`);
    console.log(appActions);

    if (appActions.length === 0) {
        console.error("No actions found.");
        process.exit(1);
    }

    // 2. Map to Policy
    const policyDoc = mapAppActionsToPermissions(appActions);
    console.log("Generated Policy Document:");
    console.log(JSON.stringify(policyDoc, null, 2));

    if (policyDoc.Statement.length === 0) {
        console.warn("Warning: Policy has no statements. No permissions will be attached.");
    }

    // 3. Create or Update Role
    const roleName = `DharmaConnect-${APP_NAME}`;
    const trustPolicy = {
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: {
                    AWS: PROXY_ROLE_ARN
                },
                Action: "sts:AssumeRole"
            }
        ]
    };

    try {
        await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
        console.log(`Role ${roleName} already exists. Updating trust policy...`);
        await iamClient.send(new UpdateAssumeRolePolicyCommand({
            RoleName: roleName,
            PolicyDocument: JSON.stringify(trustPolicy)
        }));
    } catch (e) {
        if (e.name === 'NoSuchEntity' || e.name === 'NoSuchEntityException') {
            console.log(`Creating role ${roleName}...`);
            await iamClient.send(new CreateRoleCommand({
                RoleName: roleName,
                AssumeRolePolicyDocument: JSON.stringify(trustPolicy)
            }));
        } else {
            throw e;
        }
    }

    // 4. Attach/Update Permissions Policy
    console.log(`Attaching permissions policy to ${roleName}...`);
    await iamClient.send(new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: "AppPermissions",
        PolicyDocument: JSON.stringify(policyDoc)
    }));

    // 5. Update DynamoDB Record
    const roleArn = `arn:aws:iam::${ACCOUNT_ID}:role/${roleName}`;
    console.log(`Updating actions.profiles table with role ARN: ${roleArn}`);

    await dynamoClient.send(new UpdateItemCommand({
        TableName: "actions.profiles",
        Key: { "profile": { S: APP_NAME } },
        UpdateExpression: "SET #role = :r",
        ExpressionAttributeNames: { "#role": "role" },
        ExpressionAttributeValues: { ":r": { S: roleArn } }
    }));

    console.log("Success!");
}

main().catch(console.error);
