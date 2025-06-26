/**
 * @file packages/backend-core/src/db-client.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared DynamoDB client initialization and table name retrieval logic.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb/dist-es/index.js";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb/dist-es/index.js";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { DbAction, DbActionParams, DbActionResponse } from './types'

// --- Configuration from Environment Variables ---
// These will be read from the environment of the calling application (e.g., student-dashboard API route)
const REGION = process.env.AWS_REGION; // No default, must be set
const IDENTITY_POOL_ID = process.env.AWS_COGNITO_IDENTITY_POOL_ID; // No default, must be set

// Table Name Mapping from Environment Variables
// The keys here (e.g., 'PARTICIPANTS') will be used by action handlers to get the actual table name.
const TABLE_MAP = {
    PARTICIPANTS: process.env.DYNAMODB_TABLE_PARTICIPANTS,
    MANTRA: process.env.DYNAMODB_TABLE_MANTRA,
    EVENTS: process.env.DYNAMODB_TABLE_EVENTS,
    POOLS: process.env.DYNAMODB_TABLE_POOLS,
    PROMPTS: process.env.DYNAMODB_TABLE_PROMPTS,
    VIEWS: process.env.DYNAMODB_TABLE_VIEWS,
    CONFIG: process.env.DYNAMODB_TABLE_CONFIG,
    AUTH: process.env.DYNAMODB_TABLE_AUTH,
    WORK_ORDERS: process.env.DYNAMODB_TABLE_WORK_ORDERS,
    WORK_ORDER_AUDIT_LOGS: process.env.DYNAMODB_TABLE_WORK_ORDER_AUDIT_LOGS,
    STAGES: process.env.DYNAMODB_TABLE_STAGES,
};

let docClientInstance; // Singleton instance for the DynamoDB Document Client
let sqsClientInstance; // Singleton instance for the SQS Client

/**
 * Initializes and returns a singleton DynamoDBDocumentClient instance.
 * Checks for required environment variables (AWS_REGION, AWS_COGNITO_IDENTITY_POOL_ID).
 * @function getDocClient
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable
 * @returns {DynamoDBDocumentClient} The initialized document client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
export function getDocClient(identityPoolIdOverride) {
    const identityPoolId = identityPoolIdOverride || IDENTITY_POOL_ID;
    if (!REGION) {
        console.error("db-client: AWS_REGION environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Region.");
    }
    if (!identityPoolId) {
        console.error("db-client: AWS_COGNITO_IDENTITY_POOL_ID environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Cognito Identity Pool ID.");
    }

    try {
        const credentials = fromCognitoIdentityPool({
            clientConfig: { region: REGION },
            identityPoolId,
        });
        const ddbBaseClient = new DynamoDBClient({ region: REGION, credentials });
        docClientInstance = DynamoDBDocumentClient.from(ddbBaseClient);
        console.log("db-client: DynamoDBDocumentClient initialized successfully.");
    } catch (error) {
        console.error("db-client: Failed to initialize DynamoDBDocumentClient:", error);
        throw new Error("Server configuration error: Could not initialize AWS client.");
    }
    return docClientInstance;
}

/**
 * Retrieves the actual DynamoDB table name based on a predefined key.
 * Checks if the corresponding environment variable for the table name is set.
 * @function getTableName
 * @param {string} tableNameKey - The key representing the table (e.g., 'PARTICIPANTS', 'MANTRA').
 * Must be one of the keys defined in TABLE_MAP.
 * @returns {string} The actual table name from environment variables.
 * @throws {Error} If the tableNameKey is invalid or the corresponding environment variable is not set.
 */
export function getTableName(tableNameKey) {
    const tableName = TABLE_MAP[tableNameKey];
    if (!tableName) {
        const envVarName = `DYNAMODB_TABLE_${tableNameKey}`; // Construct the expected env var name
        console.error(`db-client: Table name for key '${tableNameKey}' is not configured. Environment variable '${envVarName}' is missing or TABLE_MAP key is incorrect.`);
        throw new Error(`Server configuration error: Table name for '${tableNameKey}' is not configured.`);
    }
    return tableName;
}

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

export async function callDbApi(action, params) {
    try {
        const response = await fetch('/api/db', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action,
                params,
            }),
        })

        if (!response.ok) {
            throw new Error(`API call failed: ${response.statusText}`)
        }

        const data = await response.json()
        return data
    } catch (error) {
        console.error('Error calling DB API:', error)
        throw error
    }
}

/**
 * Initializes and returns a singleton SQSClient instance.
 * Uses the same credentials as the DynamoDB client.
 * @function getSqsClient
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable
 * @returns {SQSClient} The initialized SQS client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
export function getSqsClient(identityPoolIdOverride) {
    const identityPoolId = identityPoolIdOverride || IDENTITY_POOL_ID;
    if (!REGION) {
        console.error("db-client: AWS_REGION environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Region.");
    }
    if (!identityPoolId) {
        console.error("db-client: AWS_COGNITO_IDENTITY_POOL_ID environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Cognito Identity Pool ID.");
    }

    if (!sqsClientInstance) {
        try {
            const credentials = fromCognitoIdentityPool({
                clientConfig: { region: REGION },
                identityPoolId,
            });
            sqsClientInstance = new SQSClient({ region: REGION, credentials });
            console.log("db-client: SQSClient initialized successfully.");
        } catch (error) {
            console.error("db-client: Failed to initialize SQSClient:", error);
            throw new Error("Server configuration error: Could not initialize SQS client.");
        }
    }
    return sqsClientInstance;
}

/**
 * Sends a message to the work order SQS queue.
 * @function sendWorkOrderMessage
 * @param {string} workOrderId - The work order ID to process
 * @param {string} stepName - The name of the step to process
 * @param {string} action - The action to perform ('start' or 'stop')
 * @param {string} identityPoolIdOverride - Optional identity pool ID override
 * @returns {Promise<object>} The result of the SQS send operation
 */
export async function sendWorkOrderMessage(workOrderId, stepName, action, identityPoolIdOverride) {
    const startTime = Date.now();
    console.log(`[SQS-SEND] Starting SQS message send for work order ${workOrderId}, step ${stepName}, action: ${action}`);
    console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);

    const sqsClient = getSqsClient(identityPoolIdOverride);
    // Hardcode the SQS queue URL for now since we can't create .env.local
    const queueUrl = process.env.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/011754621643/work-order-queue.fifo';

    if (!queueUrl) {
        console.error("[SQS-SEND] ERROR: SQS_QUEUE_URL environment variable is not set.");
        throw new Error("Server configuration error: Missing SQS Queue URL.");
    }

    const messageBody = JSON.stringify({
        workOrderId: workOrderId,
        stepName: stepName,
        action: action
    });

    console.log(`[SQS-SEND] Queue URL: ${queueUrl}`);
    console.log(`[SQS-SEND] Message body: ${messageBody}`);
    console.log(`[SQS-SEND] Message group ID: ${workOrderId}`);
    console.log(`[SQS-SEND] Message deduplication ID: ${workOrderId}_${stepName}_${action}_${startTime}`);

    const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        MessageGroupId: workOrderId, // Required for FIFO queues
        MessageDeduplicationId: `${workOrderId}_${stepName}_${action}_${startTime}` // Required for FIFO queues
    });

    try {
        console.log(`[SQS-SEND] Executing SendMessageCommand...`);
        const result = await sqsClient.send(command);
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`[SQS-SEND] SUCCESS: Work order message sent successfully!`);
        console.log(`[SQS-SEND] Work order ID: ${workOrderId}`);
        console.log(`[SQS-SEND] Step: ${stepName}`);
        console.log(`[SQS-SEND] Action: ${action}`);
        console.log(`[SQS-SEND] Message ID: ${result.MessageId}`);
        console.log(`[SQS-SEND] Duration: ${duration}ms`);
        console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);
        console.log(`[SQS-SEND] SQS Response:`, JSON.stringify(result, null, 2));

        return result;
    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.error(`[SQS-SEND] ERROR: Failed to send work order message!`);
        console.error(`[SQS-SEND] Work order ID: ${workOrderId}`);
        console.error(`[SQS-SEND] Step: ${stepName}`);
        console.error(`[SQS-SEND] Action: ${action}`);
        console.error(`[SQS-SEND] Duration: ${duration}ms`);
        console.error(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);
        console.error(`[SQS-SEND] Error details:`, error);
        console.error(`[SQS-SEND] Error message: ${error.message}`);
        console.error(`[SQS-SEND] Error code: ${error.code}`);
        console.error(`[SQS-SEND] Error name: ${error.name}`);

        throw error;
    }
}
