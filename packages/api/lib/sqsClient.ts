/**
 * @file packages/api/lib/sqsClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines a client for interacting with SQS.
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromWebToken } from "@aws-sdk/credential-provider-web-identity";

const REGION = process.env.AWS_REGION;
let sqsClientInstances: Record<string, SQSClient> = {};

/**
 * @async
 * @function getSqsClient
 * @description Initializes and returns a singleton SQSClient instance.
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @param {string} oidcToken - Optional OIDC token to use for credentials.
 * @returns {Promise<SQSClient>} The initialized SQS client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
export async function getSqsClient(roleArnOverride?: string, oidcToken?: string): Promise<SQSClient> {
    const cacheKey = roleArnOverride || 'default';
    // Prefer passed OIDC token, fallback to runtime helper env var if needed
    const tokenToUse = oidcToken;

    if (!REGION) {
        console.error("sqsClient: AWS_REGION environment variable is not set.");
        throw new Error("Server configuration error: Missing AWS Region.");
    }

    if (sqsClientInstances[cacheKey]) {
        return sqsClientInstances[cacheKey];
    }

    try {
        let sqsClient: SQSClient;
        let baseCredentials;

        if (tokenToUse) {
            const defaultRoleArn = process.env.DEFAULT_GUEST_ROLE_ARN;
            if (!defaultRoleArn) {
                throw new Error("Server configuration error: Missing DEFAULT_GUEST_ROLE_ARN.");
            }
            console.log("sqsClient: OIDC Token detected. Using fromWebToken.");
            baseCredentials = fromWebToken({
                roleArn: defaultRoleArn,
                webIdentityToken: tokenToUse,
                roleSessionName: "VercelSession"
            });
        }

        if (roleArnOverride) {
            const stsClient = new STSClient({
                region: REGION,
                credentials: baseCredentials // Use OIDC credentials if available, otherwise default chain
            });
            const assumeRoleCommand = new AssumeRoleCommand({
                RoleArn: roleArnOverride,
                RoleSessionName: 'DharmaConnectSQSSession',
            });
            const { Credentials } = await stsClient.send(assumeRoleCommand);

            if (!Credentials || !Credentials.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) {
                throw new Error("Failed to obtain temporary credentials from STS.");
            }

            sqsClient = new SQSClient({
                region: REGION,
                credentials: {
                    accessKeyId: Credentials.AccessKeyId,
                    secretAccessKey: Credentials.SecretAccessKey,
                    sessionToken: Credentials.SessionToken,
                },
            });
        } else {
            // Use default credential provider chain or explicit OIDC
            sqsClient = new SQSClient({
                region: REGION,
                credentials: baseCredentials
            });
        }

        sqsClientInstances[cacheKey] = sqsClient;
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
 * @param {string} roleArnOverride - Optional role ARN to assume.
 * @param {string} oidcToken - Optional OIDC token to use.
 * @returns {Promise<any>} A promise that resolves to the result of the send message command.
 * @throws {Error} If the SQS_QUEUE_URL environment variable is not set or the message fails to send.
 */
export async function sendWorkOrderMessage(
    workOrderId: string,
    stepName: string,
    action: string,
    roleArnOverride?: string,
    oidcToken?: string
) {
    const startTime = Date.now();
    console.log(`[SQS-SEND] Starting SQS message send for work order ${workOrderId}, step ${stepName}, action: ${action}`);
    console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);

    const sqsClient = await getSqsClient(roleArnOverride, oidcToken);
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