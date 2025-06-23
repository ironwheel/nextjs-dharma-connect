/**
 * @file packages/backend-core/src/db-actions.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared DynamoDB action handlers for various database operations.
 */
import {
    QueryCommand,
    ScanCommand,
    UpdateCommand,
    PutCommand,
    GetCommand,
    DeleteCommand,
    // Add other commands like PutCommand, GetCommand, DeleteCommand if needed by your actions
} from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName, sendWorkOrderMessage } from "./db-client.js"; // Import from the same package

// --- Action Handlers ---
// Each handler takes the payload and constructs the DynamoDB command params

export {
    handleFindParticipant,
    handleFindConfig,
    handleGetView,
    handleGetPersonalMantra,
    handlePutPersonalMantra,
    handleGetGlobalMantra,
    handleScanTable,
    handleChunkedScanTable,
    handleUpdateParticipant,
    handleUpdateEmailPreferences,
    handleWriteProgramError,
    handleWriteDashboardClick,
    handleInitializeDashboard,
    handleWritePrompt,
    handleWriteAIDField,
    handleWriteParticipantAID,
    handleWriteOWYAALease,
    handleWriteStudentAccessVerifyError,
    handleGetConfig,
    handleTableCount,
    // New work order handlers
    handleCreateWorkOrder,
    handleGetWorkOrders,
    handleGetWorkOrder,
    handleUpdateWorkOrder,
    handleLogWorkOrderAudit,
    handleGetWorkOrderAuditLogs,
    handleDeleteWorkOrder,
    handleUpdateWorkOrderStatus,
    handleUpdateStepStatus,
    handleLockWorkOrder,
    handleUnlockWorkOrder,
    sendWorkOrderMessageAction
};

/**
 * Handles finding a participant by ID.
 * @async
 * @function handleFindParticipant
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @returns {Promise<object>} The participant data.
 * @throws {Error} If ID is missing, participant not found, or DB error.
 */
async function handleFindParticipant(payload) {
    const { id } = payload;
    if (!id) throw new Error("Missing 'id' in payload for findParticipant.");

    const client = getDocClient();
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        KeyConditionExpression: "id = :uid",
        ExpressionAttributeValues: { ":uid": id },
        ExpressionAttributeNames: { "#first_name": "first", "#last_name": "last" },
        ProjectionExpression: "programs, debug, #first_name, #last_name, email, emailPreferences, kmCache, writtenLangPref, country, mid, translator",
    };
    const command = new QueryCommand(params);
    const data = await client.send(command);
    if (!data.Items || data.Items.length === 0) {
        console.warn(`handleFindParticipant: PARTICIPANT_NOT_FOUND for ID: ${id}`);
        throw new Error("PARTICIPANT_NOT_FOUND");
    }
    return data.Items[0];
}

/**
 * Handles finding a config by name.
 * @async
 * @function handleFindConfig
 * @param {object} payload - The request payload.
 * @param {string} payload.key - The config key to look up.
 * @returns {Promise<object>} The config data.
 * @throws {Error} If key is missing, config not found, or DB error.
*/
async function handleFindConfig(payload) {
    const { key } = payload;
    if (!key) throw new Error("Missing 'key' in payload for handleFindConfig.");

    const client = getDocClient();
    const params = {
        TableName: getTableName('CONFIG'),
        KeyConditionExpression: "#key = :key",
        ExpressionAttributeValues: { ":key": key },
        ExpressionAttributeNames: { "#key": "key" },
    };
    const command = new QueryCommand(params);
    const data = await client.send(command);
    if (!data.Items || data.Items.length === 0) {
        console.warn(`handleFindConfig: CONFIG_NOT_FOUND for key: ${key}`);
        throw new Error("CONFIG_NOT_FOUND");
    }
    return data.Items[0];
}

/**
 * Handles finding a view by name.
 * @async
 * @function handleGetView
 * @param {object} payload - The request payload.
 * @param {string} payload.name - The view name.
 * @returns {Promise<object>} The view data.
 * @throws {Error} If ID is missing, participant not found, or DB error.
 */
async function handleGetView(payload) {
    const { name } = payload;
    if (!name) throw new Error("Missing 'name' in payload for handleGetView.");

    const client = getDocClient();
    const params = {
        TableName: getTableName('VIEWS'),
        KeyConditionExpression: "#name = :name",
        ExpressionAttributeValues: { ":name": name },
        ExpressionAttributeNames: { "#name": "name" },
    };
    const command = new QueryCommand(params);
    const data = await client.send(command);
    if (!data.Items || data.Items.length === 0) {
        console.warn(`handleGetView: VIEW_NOT_FOUND for name: ${name}`);
        throw new Error("VIEW_NOT_FOUND");
    }
    return data.Items[0];
}

/**
 * Handles fetching personal mantra counts.
 * @async
 * @function handleGetPersonalMantra
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The user ID.
 * @returns {Promise<object>} Mantra counts.
 * @throws {Error} If ID is missing, record not found, or DB error.
 */
async function handleGetPersonalMantra(payload) {
    const { id } = payload;
    if (!id) throw new Error("Missing 'id' in payload for getPersonalMantra.");

    const client = getDocClient();
    const params = {
        TableName: getTableName('MANTRA'),
        KeyConditionExpression: "id = :uid",
        ExpressionAttributeValues: { ":uid": id },
        ProjectionExpression: "mcount, c1count, c2count, c3count, c4count",
    };
    const command = new QueryCommand(params);
    const data = await client.send(command);
    if (!data.Items || data.Items.length === 0) {
        console.warn(`handleGetPersonalMantra: MANTRA_RECORD_NOT_FOUND for ID: ${id}`);
        throw new Error("MANTRA_RECORD_NOT_FOUND");
    }
    return data.Items[0];
}

/**
 * Handles updating personal mantra counts.
 * @async
 * @function handlePutPersonalMantra
 * @param {object} payload - The request payload.
 * @param {string} payload.id - User ID.
 * @param {number} payload.mcount - Count.
 * @param {number} payload.c1count - Count.
 * @param {number} payload.c2count - Count.
 * @param {number} payload.c3count - Count.
 * @param {number} payload.c4count - Count.
 * @returns {Promise<object>} Success indicator.
 * @throws {Error} If required fields missing or DB error.
 */
async function handlePutPersonalMantra(payload) {
    const { id, mcount, c1count, c2count, c3count, c4count } = payload;
    if (id === undefined || mcount === undefined || c1count === undefined || c2count === undefined || c3count === undefined || c4count === undefined) {
        throw new Error("Missing required fields for putPersonalMantra.");
    }
    const client = getDocClient();
    const params = {
        TableName: getTableName('MANTRA'),
        Key: { id: id },
        UpdateExpression: "set mcount = :av, c1count = :bv, c2count = :cv, c3count = :dv, c4count = :ev, lastUpdatedAt = :fv",
        ExpressionAttributeValues: {
            ":av": mcount, ":bv": c1count, ":cv": c2count, ":dv": c3count, ":ev": c4count, ":fv": new Date().toISOString(),
        },
        ReturnValues: "NONE",
    };
    await client.send(new UpdateCommand(params));
    return { success: true, message: "Mantra counts updated." };
}

/**
 * Handles fetching global mantra counts (requires full scan).
 * @async
 * @function handleGetGlobalMantra
 * @param {object} payload - The request payload (currently unused for this action).
 * @returns {Promise<object>} Aggregated global counts.
 * @throws {Error} If no data found or DB error.
 */
async function handleGetGlobalMantra(payload) {
    const client = getDocClient();
    const params = {
        TableName: getTableName('MANTRA'),
        ProjectionExpression: "mcount, c1count, c2count, c3count, c4count, country",
    };
    let allItems = [];
    let lastEvaluatedKey = undefined;
    do {
        const command = new ScanCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey });
        const data = await client.send(command);
        if (data.Items) allItems.push(...data.Items);
        lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (allItems.length === 0) {
        console.warn("handleGetGlobalMantra: MANTRA_DATA_NOT_FOUND");
        throw new Error("MANTRA_DATA_NOT_FOUND");
    }

    const totals = allItems.reduce((acc, item) => {
        acc.gmcount += item.mcount || 0; acc.gc1count += item.c1count || 0;
        acc.gc2count += item.c2count || 0; acc.gc3count += item.c3count || 0;
        acc.gc4count += item.c4count || 0;
        if (item.country) acc.countries.add(item.country);
        return acc;
    }, { gmcount: 0, gc1count: 0, gc2count: 0, gc3count: 0, gc4count: 0, countries: new Set() });

    return { ...totals, distinctCountries: [...totals.countries].sort(), count: allItems.length };
}

/**
 * Handles scanning a table (e.g., for events, pools, prompts).
 * @async
 * @function handleScanTable
 * @param {object} payload - The request payload.
 * @param {string} payload.tableNameKey - The key for the table to scan (e.g., 'EVENTS', 'POOLS').
 * @param {object} [payload.scanParams] - Optional additional parameters for the ScanCommand (e.g., FilterExpression, ProjectionExpression).
 * @returns {Promise<Array<object>>} Array of items found.
 * @throws {Error} If tableNameKey missing or DB error.
 */
async function handleScanTable(payload) {
    const { tableNameKey, scanParams = {} } = payload;
    if (!tableNameKey) throw new Error("Missing 'tableNameKey' for scanTable action.");

    const client = getDocClient();
    const baseParams = {
        TableName: getTableName(tableNameKey),
        ...scanParams
    };
    let allItems = [];
    let lastEvaluatedKey = undefined;
    do {
        const command = new ScanCommand({ ...baseParams, ExclusiveStartKey: lastEvaluatedKey });
        const data = await client.send(command);
        if (data.Items) allItems.push(...data.Items);
        lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return allItems; // It's okay for scans to return empty results
}

/**
 * Handles scanning a table with pagination support for large tables.
 * @async
 * @function handleChunkedScanTable
 * @param {object} payload - The request payload.
 * @param {string} payload.tableNameKey - The key for the table to scan (e.g., 'EVENTS', 'POOLS').
 * @param {object} [payload.scanParams] - Optional additional parameters for the ScanCommand.
 * @param {string} [payload.lastEvaluatedKey] - The LastEvaluatedKey from the previous scan.
 * @param {number} [payload.limit] - Maximum number of items to return per chunk.
 * @returns {Promise<object>} Object containing items and LastEvaluatedKey for pagination.
 * @throws {Error} If tableNameKey missing or DB error.
 */
async function handleChunkedScanTable(payload) {
    const { tableNameKey, scanParams = {}, lastEvaluatedKey, limit } = payload;
    if (!tableNameKey) throw new Error("Missing 'tableNameKey' for chunkedScanTable action.");

    const client = getDocClient();
    const baseParams = {
        TableName: getTableName(tableNameKey),
        ...scanParams,
        ...(limit && { Limit: limit })
    };

    const command = new ScanCommand({
        ...baseParams,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    });

    const data = await client.send(command);
    return {
        items: data.Items || [],
        lastEvaluatedKey: data.LastEvaluatedKey,
        Count: data.Count
    };
}

/**
 * Handles generic updates to a participant's record.
 * Consider creating more specific actions for better control and security.
 * @async
 * @function handleUpdateParticipant
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @param {string} payload.updateExpression - The DynamoDB UpdateExpression string.
 * @param {object} [payload.expressionAttributeNames] - Names mapping.
 * @param {object} payload.expressionAttributeValues - Values mapping.
 * @param {string} [payload.conditionExpression] - Optional condition expression.
 * @returns {Promise<object>} Update command result (or success indicator).
 * @throws {Error} If required fields missing or DB error.
 */
async function handleUpdateParticipant(payload) {
    const { id, updateExpression, expressionAttributeNames, expressionAttributeValues, conditionExpression } = payload;
    if (!id || !updateExpression || !expressionAttributeValues) {
        throw new Error("Missing required fields for updateParticipant (id, updateExpression, expressionAttributeValues).");
    }
    const client = getDocClient();
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        Key: { id: id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
        ...(conditionExpression && { ConditionExpression: conditionExpression }),
        ReturnValues: "UPDATED_NEW", // Or "NONE" if you don't need the result
    };
    try {
        const command = new UpdateCommand(params);
        const result = await client.send(command);
        return result.Attributes || { success: true }; // Return updated attributes or a success object
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.warn(`handleUpdateParticipant condition failed for ${id}: ${conditionExpression}`);
            // Depending on the use case, this might not be a "throwable" error,
            // but rather a specific outcome to be handled by the caller.
            // For now, rethrow as a specific error type.
            throw new Error("CONDITIONAL_CHECK_FAILED");
        }
        console.error(`Error updating participant ${id}:`, err);
        throw new Error(`Database error updating participant: ${err.message}`);
    }
}

// --- Specific Update Action Wrappers (Safer than generic handleUpdateParticipant) ---

/**
 * Updates email preferences for a participant.
 * @async
 * @function handleUpdateEmailPreferences
 * @param {object} payload - Payload containing id and emailPreferences.
 * @param {string} payload.id - Participant ID.
 * @param {object} payload.emailPreferences - The email preferences object.
 * @returns {Promise<object>} Success indicator.
 */
async function handleUpdateEmailPreferences(payload) {
    const { id, emailPreferences } = payload;
    if (!id || typeof emailPreferences !== 'object') {
        throw new Error("Missing id or emailPreferences for updateEmailPreferences action.");
    }
    return handleUpdateParticipant({
        id: id,
        updateExpression: "set emailPreferences = :epVal",
        expressionAttributeValues: { ":epVal": emailPreferences }
    });
}

/**
 * Writes a program-related error for a participant.
 * @async
 * @function handleWriteProgramError
 * @param {object} payload - Payload.
 * @param {string} payload.id - Participant ID.
 * @param {string} payload.errorKey - The key for the error field (e.g., 'accessVerifyError').
 * @param {string} payload.errorTimeKey - The key for the error timestamp field.
 * @param {string} payload.errorValue - The error message.
 * @returns {Promise<object>} Success indicator.
 */
async function handleWriteProgramError(payload) {
    const { id, errorKey, errorTimeKey, errorValue } = payload;
    if (!id || !errorKey || !errorTimeKey || typeof errorValue === 'undefined') {
        throw new Error("Missing parameters for writeProgramError action.");
    }
    // Ensure dashboard path exists, or create it.
    // This update will create programs.dashboard if it doesn't exist, due to how DynamoDB handles map updates.
    return handleUpdateParticipant({
        id: id,
        updateExpression: `set programs.dashboard.#errKey = :errVal, programs.dashboard.#timeKey = :timeVal`,
        expressionAttributeNames: { "#errKey": errorKey, "#timeKey": errorTimeKey },
        expressionAttributeValues: { ":errVal": errorValue, ":timeVal": new Date().toISOString() }
    });
}

/**
 * Writes dashboard click count and time for a participant.
 * @async
 * @function handleWriteDashboardClick
 * @param {object} payload - Payload.
 * @param {string} payload.id - Participant ID.
 * @param {number} payload.clickCount - Click count.
 * @param {string} payload.clickTime - Click timestamp.
 * @returns {Promise<object>} Success indicator.
 */
async function handleWriteDashboardClick(payload) {
    const { id, clickCount, clickTime } = payload;
    if (!id || typeof clickCount !== 'number' || !clickTime) {
        throw new Error("Missing parameters for writeDashboardClick action.");
    }
    // Ensure dashboard path exists, or create it.
    return handleUpdateParticipant({
        id: id,
        updateExpression: "set programs.dashboard.clickCount = :ccVal, programs.dashboard.clickTime = :ctVal",
        expressionAttributeValues: { ":ccVal": clickCount, ":ctVal": clickTime }
    });
}

/**
 * Initializes the dashboard object for a participant if it doesn't exist.
 * @async
 * @function handleInitializeDashboard
 * @param {object} payload - Payload.
 * @param {string} payload.id - Participant ID.
 * @returns {Promise<object>} Success indicator or specific outcome.
 */
async function handleInitializeDashboard(payload) {
    const { id } = payload;
    if (!id) throw new Error("Missing id for initializeDashboard action.");
    try {
        await handleUpdateParticipant({
            id: id,
            updateExpression: "set programs.dashboard = :emptyMap",
            expressionAttributeValues: { ":emptyMap": {} },
            conditionExpression: "attribute_not_exists(programs.dashboard)"
        });
        return { success: true, outcome: "dashboard_initialized" };
    } catch (error) {
        if (error.message === "CONDITIONAL_CHECK_FAILED") {
            return { success: true, outcome: "dashboard_already_existed" };
        }
        throw error; // Re-throw other errors
    }
}

/**
 * Writes a prompt entry to the database.
 * @async
 * @function handleWritePrompt
 * @param {object} payload - Payload.
 * @param {string} payload.promptKey - The prompt key.
 * @param {string} payload.language - The language.
 * @param {string} payload.aid - The application ID.
 * @param {string} payload.text - The prompt text.
 * @param {string} payload.lsb - Last saved by information.
 * @returns {Promise<object>} Success indicator.
 */
async function handleWritePrompt(payload) {
    const { promptKey, language, aid, text, lsb } = payload;
    if (!promptKey || !language || !aid || typeof text !== 'string' || !lsb) {
        throw new Error("Missing parameters for writePrompt action.");
    }
    const client = getDocClient();
    const params = {
        TableName: getTableName('PROMPTS'),
        Key: { prompt: promptKey, language: language },
        UpdateExpression: "set aid = :aid_val, #text_attr = :text_val, lsb = :lsb_val",
        ExpressionAttributeValues: { ":aid_val": aid, ":text_val": text, ":lsb_val": lsb },
        ExpressionAttributeNames: { "#text_attr": "text" }, // 'text' is a reserved word
        ReturnValues: "NONE"
    };
    await client.send(new UpdateCommand(params));
    return { success: true };
}

/**
 * Handles writing a field to a participant's AID record.
 * @async
 * @function handleWriteAIDField
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @param {string} payload.aid - The AID to write to.
 * @param {string} payload.field - The field name to write.
 * @param {any} payload.value - The value to write.
 * @returns {Promise<object>} Success indicator.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleWriteAIDField(payload) {
    const { id, aid, field, value } = payload;
    if (!id || !aid || !field) {
        throw new Error("Missing required fields for writeAIDField.");
    }

    const client = getDocClient();
    const hashedField = '#' + field;
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        Key: { id },
        UpdateExpression: `set programs.#aid.${hashedField} = :val, lastUpdatedAt = :now`,
        ExpressionAttributeNames: {
            '#aid': aid,
            [hashedField]: field
        },
        ExpressionAttributeValues: {
            ':val': value,
            ':now': new Date().toISOString()
        },
        ReturnValues: "ALL_NEW"
    };

    try {
        const result = await client.send(new UpdateCommand(params));
        return result.Attributes;
    } catch (error) {
        console.error('Error in handleWriteAIDField:', error);
        throw new Error(`Failed to write AID field: ${error.message}`);
    }
}

/**
 * Handles writing a participant's AID record.
 * @async
 * @function handleWriteParticipantAID
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @param {string} payload.aid - The AID to write.
 * @returns {Promise<object>} The updated participant record.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleWriteParticipantAID(payload) {
    const { id, aid } = payload;
    if (!id || !aid) {
        throw new Error("Missing required fields for writeParticipantAID.");
    }

    const client = getDocClient();
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        Key: { id },
        UpdateExpression: `set programs.#aid = if_not_exists(programs.#aid, :emptyMap), lastUpdatedAt = :now`,
        ExpressionAttributeNames: {
            '#aid': aid
        },
        ExpressionAttributeValues: {
            ':emptyMap': {},
            ':now': new Date().toISOString()
        },
        ReturnValues: "ALL_NEW"
    };

    try {
        const result = await client.send(new UpdateCommand(params));
        return result.Attributes;
    } catch (error) {
        console.error('Error in handleWriteParticipantAID:', error);
        throw new Error(`Failed to write participant AID: ${error.message}`);
    }
}

/**
 * Handles writing a participant's OWYAA lease record.
 * @async
 * @function handleWriteOWYAALease
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @param {string} payload.timestamp - The lease timestamp.
 * @returns {Promise<object>} The updated participant record.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleWriteOWYAALease(payload) {
    const { id, timestamp } = payload;
    if (!id || !timestamp) {
        throw new Error("Missing required fields for writeOWYAALease.");
    }

    const client = getDocClient();
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        Key: { id },
        UpdateExpression: `set owyaaLease = :ts, lastUpdatedAt = :now`,
        ExpressionAttributeValues: {
            ':ts': timestamp,
            ':now': new Date().toISOString()
        },
        ReturnValues: "ALL_NEW"
    };

    try {
        const result = await client.send(new UpdateCommand(params));
        return result.Attributes;
    } catch (error) {
        console.error('Error in handleWriteOWYAALease:', error);
        throw new Error(`Failed to write OWYAA lease: ${error.message}`);
    }
}

/**
 * Handles writing a student's access verification error.
 * @async
 * @function handleWriteStudentAccessVerifyError
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The student ID.
 * @param {string} payload.errorString - The error message.
 * @param {string} payload.errorTime - The error timestamp.
 * @returns {Promise<object>} The updated participant record.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleWriteStudentAccessVerifyError(payload) {
    const { id, errorString, errorTime } = payload;
    if (!id || !errorString || !errorTime) {
        throw new Error("Missing required fields for writeStudentAccessVerifyError.");
    }

    const client = getDocClient();
    const params = {
        TableName: getTableName('PARTICIPANTS'),
        Key: { id },
        UpdateExpression: `set verify.lastErrorString = :errStr, verify.lastErrorTime = :errTime, lastUpdatedAt = :now`,
        ExpressionAttributeValues: {
            ':errStr': errorString,
            ':errTime': errorTime,
            ':now': new Date().toISOString()
        },
        ReturnValues: "ALL_NEW"
    };

    try {
        const result = await client.send(new UpdateCommand(params));
        return result.Attributes;
    } catch (error) {
        console.error('Error in handleWriteStudentAccessVerifyError:', error);
        throw new Error(`Failed to write student access verify error: ${error.message}`);
    }
}

/**
 * Handles getting a config by key.
 * @async
 * @function handleGetConfig
 * @param {object} payload - The request payload.
 * @param {string} payload.key - The config key.
 * @returns {Promise<object>} The config data.
 * @throws {Error} If key is missing, config not found, or DB error.
 */
async function handleGetConfig(payload) {
    const { key } = payload;
    if (!key) throw new Error("Missing 'key' in payload for getConfig.");

    const client = getDocClient();
    const params = {
        TableName: getTableName('CONFIG'),
        KeyConditionExpression: "#key = :key",
        ExpressionAttributeValues: { ":key": key },
        ExpressionAttributeNames: { "#key": "key" },
    };
    const command = new QueryCommand(params);
    const data = await client.send(command);
    if (!data.Items || data.Items.length === 0) {
        console.warn(`handleGetConfig: CONFIG_NOT_FOUND for key: ${key}`);
        throw new Error("CONFIG_NOT_FOUND");
    }
    return data.Items[0];
}

/**
 * Handles counting all items in a table by paginating through all pages.
 * @async
 * @function handleTableCount
 * @param {object} payload - The request payload.
 * @param {string} payload.tableNameKey - The key for the table to count (e.g., 'PARTICIPANTS').
 * @returns {Promise<object>} Object containing the total Count.
 * @throws {Error} If tableNameKey missing or DB error.
 */
async function handleTableCount({ tableNameKey }) {
    if (!tableNameKey) throw new Error("Missing 'tableNameKey' for count action.");
    const client = getDocClient();
    let total = 0;
    let lastEvaluatedKey = undefined;
    do {
        const command = new ScanCommand({
            TableName: getTableName(tableNameKey),
            Select: 'COUNT',
            ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
        });
        const data = await client.send(command);
        total += data.Count || 0;
        lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return { Count: total };
}

/**
 * Handles creating a new work order.
 * @async
 * @function handleCreateWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.eventCode - The event code.
 * @param {string} payload.subEvent - The sub-event code.
 * @param {string} payload.stage - The stage code.
 * @param {string} payload.languages - The languages for the work order.
 * @param {object} payload.subjects - The subjects for the work order.
 * @param {string} payload.account - The account code.
 * @param {string} payload.createdBy - The user PID who created the work order.
 * @param {string} payload.zoomId - The zoom ID for the work order.
 * @returns {Promise<object>} The created work order.
 * @throws {Error} If required fields are missing or DB error.
 */
async function handleCreateWorkOrder(payload) {
    const { eventCode, subEvent, stage, languages, subjects, account, createdBy, zoomId } = payload;
    if (!eventCode || !subEvent || !stage || !languages || !subjects || !account || !createdBy) {
        throw new Error(`Missing required fields for createWorkOrder: ${JSON.stringify(payload)}`);
    }

    const id = `wo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const workOrder = {
        id,
        eventCode,
        subEvent,
        stage,
        languages,
        subjects,
        account,
        createdBy,
        zoomId: zoomId || null,
        locked: false,
        lockedBy: "",
        steps: [
            { name: 'Prepare', status: 'ready', message: '', isActive: true },
            { name: 'Test', status: 'ready', message: '', isActive: false },
            { name: 'Send', status: 'ready', message: '', isActive: false }
        ],
        createdAt: now,
        updatedAt: now
    };

    const client = getDocClient();
    await client.send(new PutCommand({ TableName: getTableName('WORK_ORDERS'), Item: workOrder }));
    return workOrder;
}

/**
 * Handles fetching work orders with optional filtering.
 * @async
 * @function handleGetWorkOrders
 * @param {object} payload - The request payload.
 * @param {string} [payload.status] - Optional status filter.
 * @returns {Promise<Array>} Array of work orders.
 * @throws {Error} If DB error occurs.
 */
async function handleGetWorkOrders(payload) {
    const { status } = payload;
    const client = getDocClient();
    const tableName = getTableName('WORK_ORDERS');

    console.log('[DEBUG] handleGetWorkOrders called with payload:', payload);
    console.log('[DEBUG] Using table name:', tableName);

    let params;
    if (status) {
        // Use GSI if status filter is provided
        params = {
            TableName: tableName,
            IndexName: 'StatusCreatedAtIndex',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ScanIndexForward: false, // Most recent first
        };
    } else {
        // Full scan if no status filter
        params = {
            TableName: tableName,
            ScanIndexForward: false,
        };
    }

    console.log('[DEBUG] DynamoDB params:', params);
    const command = status ? new QueryCommand(params) : new ScanCommand(params);
    const data = await client.send(command);
    console.log('[DEBUG] DynamoDB response:', data);
    console.log('[DEBUG] Found work orders:', data.Items?.length || 0);
    return { workOrders: data.Items || [] };
}

/**
 * Handles fetching a single work order by ID.
 * @async
 * @function handleGetWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @returns {Promise<object>} The work order data.
 * @throws {Error} If work order not found or DB error.
 */
async function handleGetWorkOrder(payload) {
    const { id } = payload;
    if (!id) {
        throw new Error("Missing id in payload for getWorkOrder.");
    }

    const client = getDocClient();
    const params = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id },
    };

    const data = await client.send(new GetCommand(params));
    if (!data.Item) {
        throw new Error("WORK_ORDER_NOT_FOUND");
    }
    return data.Item;
}

/**
 * Handles updating a work order.
 * @async
 * @function handleUpdateWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @param {string} payload.userPid - The user PID making the update.
 * @param {object} payload.updates - The fields to update.
 * @returns {Promise<object>} The updated work order.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleUpdateWorkOrder(payload) {
    const { id, userPid, updates } = payload;
    if (!id || !userPid || !updates) {
        throw new Error("Missing required fields for updateWorkOrder.");
    }

    const client = getDocClient();
    const now = new Date().toISOString();

    // Build update expression and attribute values
    const updateExpressions = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    Object.entries(updates).forEach(([key, value]) => {
        if (key !== 'id') { // Don't allow updating the ID
            updateExpressions.push(`#${key} = :${key}`);
            expressionAttributeValues[`:${key}`] = value;
            expressionAttributeNames[`#${key}`] = key;
        }
    });

    // Always update the updatedAt timestamp
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = now;
    expressionAttributeNames['#updatedAt'] = 'updatedAt';

    const params = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ReturnValues: 'ALL_NEW',
    };

    const data = await client.send(new UpdateCommand(params));

    // Log the update
    await handleLogWorkOrderAudit({
        workOrderId: id,
        action: 'updated',
        userPid,
        details: updates,
        previousStatus: updates.status ? data.Attributes.status : undefined,
        newStatus: updates.status,
    });

    return data.Attributes;
}

/**
 * Handles logging work order audit events.
 * @async
 * @function handleLogWorkOrderAudit
 * @param {object} payload - The request payload.
 * @param {string} payload.workOrderId - The work order ID.
 * @param {string} payload.action - The action performed.
 * @param {string} payload.userPid - The user PID who performed the action.
 * @param {object} [payload.details] - Additional details about the action.
 * @param {string} [payload.previousStatus] - Previous status (if status changed).
 * @param {string} [payload.newStatus] - New status (if status changed).
 * @returns {Promise<object>} The audit log entry.
 * @throws {Error} If required fields missing or DB error.
 */
async function handleLogWorkOrderAudit(payload) {
    const { workOrderId, action, userPid, details, previousStatus, newStatus } = payload;
    if (!workOrderId || !action || !userPid) {
        throw new Error("Missing required fields for logWorkOrderAudit.");
    }

    const client = getDocClient();
    const timestamp = new Date().toISOString();

    const auditLog = {
        workOrderId,
        timestamp,
        action,
        userPid,
        details: details || {},
        previousStatus,
        newStatus,
    };

    const params = {
        TableName: getTableName('WORK_ORDER_AUDIT_LOGS'),
        Item: auditLog,
    };

    await client.send(new PutCommand(params));
    return auditLog;
}

/**
 * Handles fetching audit logs for a work order.
 * @async
 * @function handleGetWorkOrderAuditLogs
 * @param {object} payload - The request payload.
 * @param {string} payload.workOrderId - The work order ID.
 * @returns {Promise<Array>} Array of audit log entries.
 * @throws {Error} If workOrderId missing or DB error.
 */
async function handleGetWorkOrderAuditLogs(payload) {
    const { workOrderId } = payload;
    if (!workOrderId) {
        throw new Error("Missing workOrderId in payload for getWorkOrderAuditLogs.");
    }

    const client = getDocClient();
    const params = {
        TableName: getTableName('WORK_ORDER_AUDIT_LOGS'),
        KeyConditionExpression: 'workOrderId = :workOrderId',
        ExpressionAttributeValues: { ':workOrderId': workOrderId },
        ScanIndexForward: false, // Most recent first
    };

    const data = await client.send(new QueryCommand(params));
    return data.Items || [];
}

/**
 * Deletes a work order by ID.
 * @async
 * @function handleDeleteWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @returns {Promise<object>} Success indicator.
 */
async function handleDeleteWorkOrder(payload) {
    const { id } = payload;
    if (!id) throw new Error("Missing 'id' in payload for handleDeleteWorkOrder.");
    const client = getDocClient();
    const params = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id }
    };
    await client.send(new DeleteCommand(params));
    return { success: true };
}

/**
 * Updates the status of a work order.
 * @async
 * @function handleUpdateWorkOrderStatus
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @param {string} payload.status - The new status.
 * @returns {Promise<object>} Success indicator.
 */
async function handleUpdateWorkOrderStatus(payload) {
    const { id, status } = payload;
    if (!id || !status) throw new Error("Missing 'id' or 'status' in payload for handleUpdateWorkOrderStatus.");
    const client = getDocClient();
    const params = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id },
        UpdateExpression: "set #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": status, ":updatedAt": new Date().toISOString() }
    };
    await client.send(new UpdateCommand(params));
    return { success: true };
}

/**
 * Updates the status of a step in a work order.
 * @async
 * @function handleUpdateStepStatus
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @param {string} payload.stepName - The name of the step to update.
 * @param {string} payload.status - The new status.
 * @param {string} [payload.message] - Optional message.
 * @returns {Promise<object>} Success indicator.
 */
async function handleUpdateStepStatus(payload) {
    const { id, stepName, status, message } = payload;
    console.log(`[STEP-UPDATE] Starting step status update for work order ${id}`);
    console.log(`[STEP-UPDATE] Step name: ${stepName}`);
    console.log(`[STEP-UPDATE] New status: ${status}`);
    console.log(`[STEP-UPDATE] Message: ${message || 'none'}`);
    console.log(`[STEP-UPDATE] Timestamp: ${new Date().toISOString()}`);

    if (!id || !stepName || !status) {
        console.error(`[STEP-UPDATE] ERROR: Missing required parameters`);
        console.error(`[STEP-UPDATE] id: ${id}, stepName: ${stepName}, status: ${status}`);
        throw new Error("Missing 'id', 'stepName', or 'status' in payload for handleUpdateStepStatus.");
    }

    const client = getDocClient();
    const now = new Date().toISOString();

    // First get the current work order to check step order
    console.log(`[STEP-UPDATE] Fetching current work order from DynamoDB...`);
    const getParams = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id }
    };
    const workOrder = await client.send(new GetCommand(getParams));

    if (!workOrder.Item) {
        console.error(`[STEP-UPDATE] ERROR: Work order ${id} not found in DynamoDB`);
        throw new Error("Work order not found");
    }

    const steps = workOrder.Item.steps;
    console.log(`[STEP-UPDATE] Current work order found with ${steps.length} steps`);
    console.log(`[STEP-UPDATE] Looking for step: ${stepName}`);
    console.log(`[STEP-UPDATE] Steps structure:`, JSON.stringify(steps, null, 2));

    // Check if steps are in DynamoDB format
    const stepIndex = steps.findIndex(s => {
        const stepNameValue = s.name?.S || s.name;
        console.log(`[STEP-UPDATE] Comparing step name: ${stepNameValue} with: ${stepName}`);
        return stepNameValue === stepName;
    });

    if (stepIndex === -1) {
        console.error(`[STEP-UPDATE] ERROR: Step ${stepName} not found in work order`);
        console.error(`[STEP-UPDATE] Available step names:`, steps.map(s => s.name?.S || s.name));
        throw new Error(`Step ${stepName} not found in work order`);
    }

    console.log(`[STEP-UPDATE] Found step at index: ${stepIndex}`);
    console.log(`[STEP-UPDATE] Current step data:`, JSON.stringify(steps[stepIndex], null, 2));

    // Update the current step
    steps[stepIndex] = {
        ...steps[stepIndex],
        status,
        message,
        isActive: status === 'working'
    };

    console.log(`[STEP-UPDATE] Updated step data:`, JSON.stringify(steps[stepIndex], null, 2));

    // Update the work order in the database
    console.log(`[STEP-UPDATE] Updating work order in DynamoDB...`);
    const updateParams = {
        TableName: getTableName('WORK_ORDERS'),
        Key: { id },
        UpdateExpression: 'SET steps = :steps, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
            ':steps': steps,
            ':updatedAt': now
        },
        ReturnValues: 'ALL_NEW',
    };
    await client.send(new UpdateCommand(updateParams));

    console.log(`[STEP-UPDATE] Step status update completed successfully`);
    console.log(`[STEP-UPDATE] Final step data:`, JSON.stringify(steps[stepIndex], null, 2));

    return { success: true };
}

/**
 * Locks a work order for editing by a specific user.
 * @async
 * @function handleLockWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @param {string} payload.userPid - The user PID attempting to lock.
 * @returns {Promise<object>} Success indicator with lock status.
 */
async function handleLockWorkOrder(payload) {
    const { id, userPid } = payload;
    if (!id || !userPid) {
        throw new Error("Missing 'id' or 'userPid' in payload for handleLockWorkOrder.");
    }

    const client = getDocClient();
    const now = new Date().toISOString();

    try {
        // Try to lock the work order - will fail if already locked
        const params = {
            TableName: getTableName('WORK_ORDERS'),
            Key: { id },
            UpdateExpression: "SET #locked = :locked, #lockedBy = :lockedBy, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#locked": "locked",
                "#lockedBy": "lockedBy"
            },
            ExpressionAttributeValues: {
                ":locked": true,
                ":lockedBy": userPid,
                ":updatedAt": now,
                ":false": false
            },
            ConditionExpression: "attribute_exists(id) AND (attribute_not_exists(#locked) OR #locked = :false)",
            ReturnValues: 'ALL_NEW'
        };

        const result = await client.send(new UpdateCommand(params));

        // Log the lock action (handle gracefully if audit table doesn't exist)
        try {
            await handleLogWorkOrderAudit({
                workOrderId: id,
                action: 'locked',
                userPid,
                details: { lockedBy: userPid }
            });
        } catch (auditError) {
            console.warn('Failed to log lock audit:', auditError);
            // Don't fail the lock operation if audit logging fails
        }

        return {
            success: true,
            locked: true,
            lockedBy: userPid,
            workOrder: result.Attributes
        };
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            // Work order is already locked
            return {
                success: false,
                locked: true,
                error: 'Work order is already locked by another user'
            };
        }
        throw error;
    }
}

/**
 * Unlocks a work order.
 * @async
 * @function handleUnlockWorkOrder
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The work order ID.
 * @param {string} payload.userPid - The user PID attempting to unlock.
 * @returns {Promise<object>} Success indicator.
 */
async function handleUnlockWorkOrder(payload) {
    const { id, userPid } = payload;
    if (!id || !userPid) {
        throw new Error("Missing 'id' or 'userPid' in payload for handleUnlockWorkOrder.");
    }

    const client = getDocClient();
    const now = new Date().toISOString();

    try {
        // Unlock the work order
        const params = {
            TableName: getTableName('WORK_ORDERS'),
            Key: { id },
            UpdateExpression: "SET #locked = :locked, #lockedBy = :lockedBy, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#locked": "locked",
                "#lockedBy": "lockedBy"
            },
            ExpressionAttributeValues: {
                ":locked": false,
                ":lockedBy": null,
                ":updatedAt": now
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await client.send(new UpdateCommand(params));

        // Log the unlock action (handle gracefully if audit table doesn't exist)
        try {
            await handleLogWorkOrderAudit({
                workOrderId: id,
                action: 'unlocked',
                userPid,
                details: { unlockedBy: userPid }
            });
        } catch (auditError) {
            console.warn('Failed to log unlock audit:', auditError);
            // Don't fail the unlock operation if audit logging fails
        }

        return {
            success: true,
            locked: false,
            workOrder: result.Attributes
        };
    } catch (error) {
        throw error;
    }
}

async function sendWorkOrderMessageAction(payload) {
    const { workOrderId, stepName, action } = payload;

    console.log(`[SQS-SEND] Sending work order message:`, { workOrderId, stepName, action });
    console.log(`[SQS-SEND] Timestamp: ${new Date().toISOString()}`);

    if (!workOrderId || !stepName || !action) {
        throw new Error('Missing required parameters: workOrderId, stepName, action');
    }

    if (!['start', 'stop'].includes(action)) {
        throw new Error('Invalid action. Must be "start" or "stop"');
    }

    try {
        // Send SQS message to email-agent
        const result = await sendWorkOrderMessage(workOrderId, stepName, action);
        console.log(`[SQS-SEND] SUCCESS: Sent ${action} message for work order ${workOrderId}, step ${stepName}`);
        return { success: true, messageId: result.MessageId };
    } catch (error) {
        console.error(`[SQS-SEND] ERROR: Failed to send ${action} message for work order ${workOrderId}, step ${stepName}:`, error);
        throw error;
    }
}
