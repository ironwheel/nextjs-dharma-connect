const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

// Get environment variables
const WORK_ORDERS_TABLE = process.env.WORK_ORDERS_TABLE;
const STUDENTS_TABLE = process.env.STUDENTS_TABLE;
const WORK_ORDER_CONNECTIONS_TABLE = process.env.WORK_ORDER_CONNECTIONS_TABLE;
const STUDENT_CONNECTIONS_TABLE = process.env.STUDENT_CONNECTIONS_TABLE;
const SQS_QUEUE_URL = process.env.WORK_ORDER_QUEUE_URL;
const WEBSOCKET_API_URL = process.env.WEBSOCKET_API_URL;

// Parse the WebSocket URL to get the API endpoint
let MGMT_API_URL = null;
if (WEBSOCKET_API_URL) {
    const url = WEBSOCKET_API_URL.replace('wss://', '').replace('https://', '');
    const parts = url.split('/');
    const domain = parts[0];
    const stage = parts[1] || '';
    MGMT_API_URL = stage ? `https://${domain}/${stage}` : `https://${domain}`;
    console.log(`[DEBUG] Management API URL: ${MGMT_API_URL}`);
} else {
    console.log("[ERROR] WEBSOCKET_API_URL environment variable is not set");
}

// Initialize API Gateway Management API client
const apigwmgmt = MGMT_API_URL ? new AWS.ApiGatewayManagementApi({
    endpoint: MGMT_API_URL
}) : null;

/**
 * Verify JWT token and return decoded payload
 * @param {string} token - The JWT token to verify
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
function verifyToken(token) {
    try {
        // Get RSA public key from environment variable
        const rsaPublicKeyB64 = process.env.API_RSA_PUBLIC;
        if (!rsaPublicKeyB64) {
            console.log("[DEBUG] API_RSA_PUBLIC environment variable not set");
            return null;
        }

        // Decode the base64 public key
        const publicKey = Buffer.from(rsaPublicKeyB64, 'base64').toString('utf-8');

        // Get JWT issuer from environment variable
        const jwtIssuer = process.env.JWT_ISSUER_NAME;
        if (!jwtIssuer) {
            console.log("[DEBUG] JWT_ISSUER_NAME environment variable not set");
            return null;
        }

        console.log("[DEBUG] Attempting to decode token with RS256 algorithm");
        console.log(`[DEBUG] Public key length: ${publicKey.length} characters`);
        console.log(`[DEBUG] JWT issuer: ${jwtIssuer}`);

        // Decode and verify token using RS256
        const decoded = jwt.verify(token, publicKey, {
            algorithms: ['RS256']
        });

        // Manually check issuer claim (handle quoted strings)
        const tokenIssuer = decoded.issuer || '';
        // Strip quotes if present
        const cleanedTokenIssuer = tokenIssuer.startsWith('"') && tokenIssuer.endsWith('"')
            ? tokenIssuer.slice(1, -1)
            : tokenIssuer;

        if (cleanedTokenIssuer !== jwtIssuer) {
            console.log(`[DEBUG] Token issuer mismatch: expected=${jwtIssuer}, got=${decoded.issuer} (cleaned: ${cleanedTokenIssuer})`);
            return null;
        }

        console.log("[DEBUG] Token decoded successfully");

        // Check if token is expired
        if (decoded.exp && decoded.exp < Date.now() / 1000) {
            console.log(`[DEBUG] Token expired: exp=${decoded.exp}, current_time=${Date.now() / 1000}`);
            return null;
        }

        console.log("[DEBUG] Token verification successful");
        return decoded;
    } catch (error) {
        console.log(`[DEBUG] Token verification error: ${error.message}`);
        console.log(`[DEBUG] Error type: ${error.constructor.name}`);
        return null;
    }
}

/**
 * Extract token from WebSocket URL query parameters
 * @param {string} url - The WebSocket URL
 * @returns {string|null} - The token or null if not found
 */
function extractTokenFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('token');
    } catch (error) {
        console.log(`[DEBUG] Error extracting token from URL: ${error.message}`);
        return null;
    }
}

/**
 * Get all active WebSocket connection IDs for a specific table type
 * @param {string} tableType - 'work-orders' or 'students'
 * @returns {Promise<Array>} - Array of connection IDs
 */
async function getConnectionIds(tableType) {
    const connectionsTable = tableType === 'students' ? STUDENT_CONNECTIONS_TABLE : WORK_ORDER_CONNECTIONS_TABLE;

    try {
        const response = await dynamodb.scan({
            TableName: connectionsTable,
            ProjectionExpression: 'connectionId'
        }).promise();

        return response.Items.map(item => item.connectionId);
    } catch (error) {
        console.log(`[DEBUG] Error getting connection IDs for ${tableType}: ${error.message}`);
        return [];
    }
}

/**
 * Main Lambda handler function
 * @param {Object} event - Lambda event object
 * @param {Object} context - Lambda context object
 * @returns {Promise<Object>} - Response object
 */
exports.handler = async (event, context) => {
    console.log(`[DEBUG] Received event: ${JSON.stringify(event)}`);

    // Handle WebSocket events
    const routeKey = event.requestContext?.routeKey;

    if (routeKey === '$connect') {
        return await handleConnect(event);
    } else if (routeKey === '$disconnect') {
        return await handleDisconnect(event);
    } else if (routeKey === '$default') {
        return await handleDefault(event);
    }

    // Handle DynamoDB stream events
    return await handleDynamoDBStream(event);
};

/**
 * Handle WebSocket connection
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} - Response object
 */
async function handleConnect(event) {
    const connectionId = event.requestContext.connectionId;
    console.log(`[DEBUG] New WebSocket connection: ${connectionId}`);

    // Extract token from query parameters
    const queryParams = event.queryStringParameters || {};
    const token = queryParams.token;
    console.log(`[DEBUG] Extracted token: ${token ? token.substring(0, 50) + '...' : 'None'}`);

    if (!token) {
        console.log(`[DEBUG] No token provided for connection ${connectionId}`);
        return { statusCode: 401, body: 'No token provided' };
    }

    // Verify token
    const decodedToken = verifyToken(token);
    if (!decodedToken) {
        console.log(`[DEBUG] Invalid token for connection ${connectionId}`);
        return { statusCode: 401, body: 'Invalid or expired token' };
    }

    // Extract table type from query parameters
    const tableType = queryParams.tableType || 'work-orders';
    const connectionsTable = tableType === 'students' ? STUDENT_CONNECTIONS_TABLE : WORK_ORDER_CONNECTIONS_TABLE;

    // Store connection with user info
    try {
        await dynamodb.put({
            TableName: connectionsTable,
            Item: {
                connectionId: connectionId,
                tableType: tableType,
                pid: decodedToken.pid,
                hash: decodedToken.hash,
                host: decodedToken.host,
                deviceFingerprint: decodedToken.deviceFingerprint,
                connectedAt: Math.floor(Date.now() / 1000)
            }
        }).promise();

        console.log(`[DEBUG] Connection ${connectionId} authenticated for user ${decodedToken.pid}`);
        return { statusCode: 200 };
    } catch (error) {
        console.log(`[DEBUG] Error storing connection: ${error.message}`);
        return { statusCode: 500, body: 'Error storing connection' };
    }
}

/**
 * Handle WebSocket disconnection
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} - Response object
 */
async function handleDisconnect(event) {
    const connectionId = event.requestContext.connectionId;
    console.log(`[DEBUG] WebSocket disconnection: ${connectionId}`);

    try {
        // Try to remove from both tables (connection might be in either)
        await Promise.all([
            dynamodb.delete({
                TableName: WORK_ORDER_CONNECTIONS_TABLE,
                Key: { connectionId: connectionId }
            }).promise(),
            dynamodb.delete({
                TableName: STUDENT_CONNECTIONS_TABLE,
                Key: { connectionId: connectionId }
            }).promise()
        ]);
        return { statusCode: 200 };
    } catch (error) {
        console.log(`[DEBUG] Error removing connection: ${error.message}`);
        return { statusCode: 500, body: 'Error removing connection' };
    }
}

/**
 * Handle default WebSocket messages
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} - Response object
 */
async function handleDefault(event) {
    const connectionId = event.requestContext.connectionId;
    console.log(`[DEBUG] Received message from connection ${connectionId}`);

    // Parse the message body first to check if it's a ping
    let body;
    try {
        body = JSON.parse(event.body || '{}');
        console.log(`[DEBUG] Message body: ${JSON.stringify(body)}`);
    } catch (error) {
        console.log(`[ERROR] Error parsing message body: ${error.message}`);
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    // Handle ping messages immediately (no token validation required)
    if (body.type === 'ping') {
        console.log(`[DEBUG] Received ping from ${connectionId}`);
        if (!apigwmgmt) {
            console.log("[ERROR] apigwmgmt client is not initialized");
            return { statusCode: 500, body: 'WebSocket API URL not configured' };
        }

        const responseData = {
            type: 'connectionId',
            connectionId: connectionId
        };
        console.log(`[DEBUG] Sending response: ${JSON.stringify(responseData)}`);

        try {
            await apigwmgmt.postToConnection({
                Data: JSON.stringify(responseData),
                ConnectionId: connectionId
            }).promise();
            console.log(`[DEBUG] Successfully sent connection ID ${connectionId} to client`);
            return { statusCode: 200 };
        } catch (error) {
            console.log(`[ERROR] Failed to send connection ID: ${error.message}`);
            return { statusCode: 500, body: error.message };
        }
    }

    // For non-ping messages, continue with token validation
    console.log(`[DEBUG] Processing non-ping message: ${body.type}`);

    // Extract table type from query parameters
    const queryParams = event.queryStringParameters || {};
    const tableType = queryParams.tableType || 'work-orders';
    const connectionsTable = tableType === 'students' ? STUDENT_CONNECTIONS_TABLE : WORK_ORDER_CONNECTIONS_TABLE;

    // Get connection info from database
    try {
        const connectionResponse = await dynamodb.get({
            TableName: connectionsTable,
            Key: { connectionId: connectionId }
        }).promise();

        if (!connectionResponse.Item) {
            console.log(`[DEBUG] Connection ${connectionId} not found in database`);
            return { statusCode: 401, body: 'Connection not found' };
        }

        const connectionInfo = connectionResponse.Item;
        console.log(`[DEBUG] Connection info: ${JSON.stringify(connectionInfo)}`);

        // Extract token from query parameters for validation
        const token = queryParams.token;
        if (!token) {
            console.log(`[DEBUG] No token provided for message from connection ${connectionId}`);
            return { statusCode: 401, body: 'No token provided' };
        }

        // Verify token on every message
        const decodedToken = verifyToken(token);
        if (!decodedToken) {
            console.log(`[DEBUG] Invalid token for message from connection ${connectionId}, closing connection`);

            // Close the connection by sending an error message
            if (apigwmgmt) {
                try {
                    await apigwmgmt.postToConnection({
                        Data: JSON.stringify({ type: 'error', message: 'Token expired or invalid' }),
                        ConnectionId: connectionId
                    }).promise();
                } catch (error) {
                    console.log(`[DEBUG] Error sending close message: ${error.message}`);
                }
            }

            // Remove connection from database
            await dynamodb.delete({
                TableName: connectionsTable,
                Key: { connectionId: connectionId }
            }).promise();

            return { statusCode: 401, body: 'Invalid or expired token' };
        }

        // Verify token matches stored connection info
        if (decodedToken.pid !== connectionInfo.pid || decodedToken.hash !== connectionInfo.hash) {
            console.log(`[DEBUG] Token mismatch for connection ${connectionId}`);
            return { statusCode: 401, body: 'Token mismatch' };
        }

    } catch (error) {
        console.log(`[DEBUG] Error validating connection: ${error.message}`);
        return { statusCode: 500, body: 'Connection validation error' };
    }



    return { statusCode: 200 };
}

/**
 * Handle DynamoDB stream events
 * @param {Object} event - Lambda event object
 * @returns {Promise<Object>} - Response object
 */
async function handleDynamoDBStream(event) {
    try {
        console.log(`[DEBUG] Processing DynamoDB stream event with ${event.Records?.length || 0} records`);

        for (const record of event.Records || []) {
            const eventSourceARN = record.eventSourceARN;
            // Extract table name between '/table/' and '/stream/'
            let tableName = undefined;
            const tableMatch = eventSourceARN.match(/table\/(.+?)\/stream\//);
            if (tableMatch && tableMatch[1]) {
                tableName = tableMatch[1];
            }
            console.log(`[DEBUG] Processing record: eventName=${record.eventName}, tableName=${tableName}`);

            // Only process records with 'NewImage'
            if (!record.dynamodb.NewImage) {
                console.log(`[DEBUG] Skipping record without NewImage`);
                continue;
            }

            // Determine table type and routing
            let tableType, itemId, messageType;
            if (tableName.includes('WorkOrders')) {
                tableType = 'work-orders';
                itemId = record.dynamodb.Keys.id.S;
                messageType = 'workOrderUpdate';
                console.log(`[DEBUG] Processing work order: ${itemId}`);
            } else if (tableName.includes('Students')) {
                tableType = 'students';
                itemId = record.dynamodb.Keys.id.S;
                messageType = 'studentUpdate';
                console.log(`[DEBUG] Processing student: ${itemId}`);
            } else {
                console.log(`[DEBUG] Unknown table: ${tableName}`);
                continue;
            }

            // Create message for WebSocket
            const wsMessage = {
                type: messageType,
                id: itemId,
                eventName: record.eventName,
                newImage: record.dynamodb.NewImage
            };

            console.log(`[DEBUG] Sending WebSocket message: ${JSON.stringify(wsMessage)}`);

            // Send to WebSocket connections for this specific table type
            const connectionIds = await getConnectionIds(tableType);
            console.log(`[DEBUG] Sending to ${connectionIds.length} WebSocket connections for ${tableType}`);

            for (const connectionId of connectionIds) {
                try {
                    await apigwmgmt.postToConnection({
                        Data: JSON.stringify(wsMessage),
                        ConnectionId: connectionId
                    }).promise();
                    console.log(`[DEBUG] Successfully sent to connection ${connectionId}`);
                } catch (error) {
                    if (error.code === 'GoneException') {
                        // Connection is gone, remove it from the appropriate table
                        console.log(`Connection ${connectionId} is gone, removing from ${tableType} table`);
                        const connectionsTable = tableType === 'students' ? STUDENT_CONNECTIONS_TABLE : WORK_ORDER_CONNECTIONS_TABLE;
                        await dynamodb.delete({
                            TableName: connectionsTable,
                            Key: { connectionId: connectionId }
                        }).promise();
                    } else {
                        console.log(`Error sending to WebSocket: ${error.message}`);
                    }
                }
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify('Success')
        };

    } catch (error) {
        console.log(`[ERROR] Error processing event: ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify('Error processing event')
        };
    }
} 