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
    // Add other commands like PutCommand, GetCommand, DeleteCommand if needed by your actions
} from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./db-client.js"; // Import from the same package

// --- Action Handlers ---
// Each handler takes the payload and constructs the DynamoDB command params

/**
 * Handles finding a participant by ID.
 * @async
 * @function handleFindParticipant
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The participant ID.
 * @returns {Promise<object>} The participant data.
 * @throws {Error} If ID is missing, participant not found, or DB error.
 */
export async function handleFindParticipant(payload) {
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
 * Handles fetching personal mantra counts.
 * @async
 * @function handleGetPersonalMantra
 * @param {object} payload - The request payload.
 * @param {string} payload.id - The user ID.
 * @returns {Promise<object>} Mantra counts.
 * @throws {Error} If ID is missing, record not found, or DB error.
 */
export async function handleGetPersonalMantra(payload) {
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
export async function handlePutPersonalMantra(payload) {
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
export async function handleGetGlobalMantra(payload) {
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
export async function handleScanTable(payload) {
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
export async function handleUpdateParticipant(payload) {
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
export async function handleUpdateEmailPreferences(payload) {
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
export async function handleWriteProgramError(payload) {
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
export async function handleWriteDashboardClick(payload) {
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
export async function handleInitializeDashboard(payload) {
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
export async function handleWritePrompt(payload) {
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
