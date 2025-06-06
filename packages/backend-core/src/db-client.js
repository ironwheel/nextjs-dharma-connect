/**
 * @file packages/backend-core/src/db-client.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared DynamoDB client initialization and table name retrieval logic.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";

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
};

let docClientInstance; // Singleton instance for the DynamoDB Document Client

/**
 * Initializes and returns a singleton DynamoDBDocumentClient instance.
 * Checks for required environment variables (AWS_REGION, AWS_COGNITO_IDENTITY_POOL_ID).
 * @function getDocClient
 * @returns {DynamoDBDocumentClient} The initialized document client.
 * @throws {Error} If essential AWS configuration environment variables are not set or client fails to initialize.
 */
export function getDocClient() {
    if (!docClientInstance) {
        if (!REGION) {
            console.error("db-client: AWS_REGION environment variable is not set.");
            throw new Error("Server configuration error: Missing AWS Region.");
        }
        if (!IDENTITY_POOL_ID) {
            console.error("db-client: AWS_COGNITO_IDENTITY_POOL_ID environment variable is not set.");
            throw new Error("Server configuration error: Missing AWS Cognito Identity Pool ID.");
        }

        try {
            const credentials = fromCognitoIdentityPool({
                clientConfig: { region: REGION },
                identityPoolId: IDENTITY_POOL_ID,
            });
            const ddbBaseClient = new DynamoDBClient({ region: REGION, credentials });
            docClientInstance = DynamoDBDocumentClient.from(ddbBaseClient);
            console.log("db-client: DynamoDBDocumentClient initialized successfully.");
        } catch (error) {
            console.error("db-client: Failed to initialize DynamoDBDocumentClient:", error);
            throw new Error("Server configuration error: Could not initialize AWS client.");
        }
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
