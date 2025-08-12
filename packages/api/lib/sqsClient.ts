/**
 * @file packages/api/lib/sqsClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines a client for interacting with SQS.
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';

const REGION = process.env.AWS_REGION;
const IDENTITY_POOL_ID = process.env.AWS_COGNITO_IDENTITY_POOL_ID;
let sqsClientInstances: Record<string, SQSClient> = {};

/**
 * @function getSqsClient
 * @description Initializes and returns a singleton SQSClient instance.
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {SQSClient} The initialized SQS client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
export function getSqsClient(identityPoolIdOverride?: string) {
    const identityPoolId = identityPoolIdOverride || IDENTITY_POOL_ID;
    if (!REGION) {
        console.error("sqsClient: AWS_REGION environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Region.");
    }
    if (!identityPoolId) {
        console.error("sqsClient: AWS_COGNITO_IDENTITY_POOL_ID environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Cognito Identity Pool ID.");
    }
    if (sqsClientInstances[identityPoolId]) {
        return sqsClientInstances[identityPoolId];
    }
    try {
        const credentials = fromCognitoIdentityPool({
            clientConfig: { region: REGION },
            identityPoolId,
        });
        const sqsClient = new SQSClient({ region: REGION, credentials });
        sqsClientInstances[identityPoolId] = sqsClient;
        return sqsClient;
    } catch (error) {
        console.error("sqsClient: Failed to initialize SQSClient:", error);
        throw new Error("Server configuration error: Could not initialize SQS client.");
    }
}

/**
 * @async
 * @function sendWorkOrderMessage
 * @description Sends a work order message to the SQS queue.
 * @param {string} workOrderId - The ID of the work order.
 * @param {string} stepName - The name of the step.
 * @param {string} action - The action to perform.
 * @param {string} identityPoolIdOverride - Optional identity pool ID to use instead of the environment variable.
 * @returns {Promise<any>} A promise that resolves to the result of the send message command.
 * @throws {Error} If the SQS_QUEUE_URL environment variable is not set or the message fails to send.
 */
export async function sendWorkOrderMessage(workOrderId: string, stepName: string, action: string, identityPoolIdOverride?: string) {
    const startTime = Date.now();
    console.log(`[SQS-SEND] Starting SQS message send for work order ${workOrderId}, step ${stepName}, action: ${action}`);
    console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);

    const sqsClient = getSqsClient(identityPoolIdOverride);
    const queueUrl = process.env.SQS_QUEUE_URL;

    if (!queueUrl) {
        console.error("[SQS-SEND] ERROR: SQS_QUEUE_URL environment variable is not set.");
        throw new Error("Server configuration error: Missing SQS Queue URL.");
    }

    const messageBody = JSON.stringify({
        workOrderId: workOrderId,
        stepName: stepName,
        action: action
    });

    const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        MessageGroupId: workOrderId, // Required for FIFO queues
        MessageDeduplicationId: `${workOrderId}_${stepName}_${action}_${startTime}` // Required for FIFO queues
    });

    try {
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
    } catch (error: any) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.error(`[SQS-SEND] ERROR: Failed to send work order message!`);
        console.error(`[SQS-SEND] Work order ID: ${workOrderId}`);
        console.error(`[SQS-SEND] Step: ${stepName}`);
        console.error(`[SQS-SEND] Action: ${action}`);
        console.error(`[SQS-SEND] Duration: ${duration}ms`);
        console.error(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);
        console.error(`[SQS-SEND] Error details:`, error);
        throw error;
    }
} 