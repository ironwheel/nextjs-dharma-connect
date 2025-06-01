/**
 * @file apiUtils.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Provides utility functions for making API calls and handling common operations.
 */

/**
 * Helper to call the generic /api/db endpoint.
 * @async
 * @function callDbApi
 * @param {string} action - The action name for the backend handler.
 * @param {object} payload - The data payload for the action.
 * @param {string} [baseUrl='/api/db'] - The base URL for the API endpoint.
 * @returns {Promise<object>} The 'data' portion of the API response.
 * @throws {Error} If the fetch fails, response is not ok, or data contains an error.
 */
export const callDbApi = async (action, payload, baseUrl = '/api/db') => {
    console.log(`Calling DB API Action: ${action}`);
    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, payload })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            console.error(`DB API Error (${action}): ${response.status} ${errorText}`);
            throw new Error(`API Error (${response.status}) for action ${action}: ${errorText}`);
        }

        const result = await response.json();
        if (result.data?.err) {
            console.error(`DB API Application Error (${action}): ${result.data.err}`);
            throw new Error(`API returned error for action ${action}: ${result.data.err}`);
        }
        return result.data;
    } catch (error) {
        console.error(`Error in callDbApi (${action}):`, error);
        throw error;
    }
};

/**
 * Fetches prompts from the API using /api/db.
 * @async
 * @function getPromptsFromDbApi
 * @param {string} aid - The application ID.
 * @param {string} [baseUrl='/api/db'] - The base URL for the API endpoint.
 * @returns {Promise<Array<object>>} Array of prompt objects.
 * @throws {Error} If the fetch fails or prompts cannot be retrieved.
 */
export const getPromptsFromDbApi = async (aid, baseUrl = '/api/db') => {
    try {
        const prompts = await callDbApi('getPrompts', { aid }, baseUrl);
        return prompts || [];
    } catch (error) {
        console.error("getPromptsFromDbApi error:", error);
        throw error;
    }
};

/**
 * Writes a program error to the participant's record via the /api/db endpoint.
 * @async
 * @function writeProgramError
 * @param {string} participantId - The participant ID.
 * @param {string} errorKey - The key for the error (e.g., 'confirmVerifyError').
 * @param {string} errorTimeKey - The key for the error timestamp.
 * @param {string | object} errorDetail - Details of the error.
 * @param {string} [baseUrl='/api/db'] - The base URL for the API endpoint.
 * @returns {Promise<void>} Resolves when done, logs errors internally.
 */
export const writeProgramError = async (participantId, errorKey, errorTimeKey, errorDetail, baseUrl = '/api/db') => {
    const errorString = typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail);
    try {
        await callDbApi('writeProgramError', {
            id: participantId,
            errorKey,
            errorTimeKey,
            errorValue: errorString
        }, baseUrl);
        console.log(`Logged ${errorKey} for PID ${participantId}`);
    } catch (apiError) {
        console.error(`API Error logging ${errorKey} via /api/db:`, apiError);
    }
}; 