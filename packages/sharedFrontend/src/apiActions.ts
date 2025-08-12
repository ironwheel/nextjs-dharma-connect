/**
 * @file packages/sharedFrontend/src/apiActions.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines API actions for the application.
 */

import { api } from './httpClient';

// Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

// Types
export interface SQSMessageData {
    workOrderId: string;
    stepName: string;
    action: 'start' | 'stop';
}

export interface ProgressCallback {
    (count: number, chunkNumber: number, totalChunks?: number): void;
}

export interface WebSocketConnectionDetails {
    websocketUrl: string;
    token: string;
}

export interface ApiError {
    message: string;
    status?: number;
    details?: any;
}

export interface RedirectedResponse {
    redirected: true;
}

/**
 * @async
 * @function getTableItem
 * @description Retrieve a single item by id from a table.
 * @param {string} resource - The resource to retrieve the item from.
 * @param {string} id - The ID of the item to retrieve.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any>} A promise that resolves to the item.
 */
export async function getTableItem(
    resource: string,
    id: string,
    pid: string,
    hash: string
): Promise<any> {
    try {
        const response = await api.get(`${API_BASE_URL}/table/${resource}/${id}`, pid, hash);

        if (response && response.redirected) {
            return { redirected: true };
        }

        return response;
    } catch (error: any) {
        console.error(`[API] getTableItem failed for ${resource}/${id}:`, error);
        throw new Error(error.message || 'Failed to get table item');
    }
}

/**
 * @async
 * @function getTableItemOrNull
 * @description Retrieve a single item by id from a table, or null if not found.
 * @param {string} resource - The resource to retrieve the item from.
 * @param {string} id - The ID of the item to retrieve.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any | null>} A promise that resolves to the item or null.
 */
export async function getTableItemOrNull(
    resource: string,
    id: string,
    pid: string,
    hash: string
): Promise<any | null> {
    try {
        const response = await api.get(`${API_BASE_URL}/table/${resource}/${id}`, pid, hash);

        if (response && response.redirected) {
            console.log(`[API] getTableItemOrNull redirected for ${resource}/${id} - authentication required`);
            return { redirected: true };
        }

        return response;
    } catch (error: any) {
        // Check if it's a 404 error (item not found)
        if (error.status === 404) {
            console.log(`[API] getTableItemOrNull: ${resource}/${id} not found, returning null`);
            return null;
        }

        console.error(`[API] getTableItemOrNull failed for ${resource}/${id}:`, error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log(`[API] getTableItemOrNull authentication failed for ${resource}/${id} - returning redirected response`);
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to get table item');
    }
}

/**
 * @async
 * @function batchGetTableItems
 * @description Retrieve multiple items by their IDs from a table.
 * @param {string} resource - The resource to retrieve the items from.
 * @param {string[]} ids - The IDs of the items to retrieve.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of items.
 */
export async function batchGetTableItems(
    resource: string,
    ids: string[],
    pid: string,
    hash: string
): Promise<any[] | RedirectedResponse> {
    try {
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        const response = await api.post(`${API_BASE_URL}/table/${resource}/batch`, pid, hash, { ids });

        if (response && response.redirected) {
            console.log(`[API] batchGetTableItems redirected for ${resource} - authentication required`);
            return { redirected: true };
        }

        return response || [];
    } catch (error: any) {
        console.error(`[API] batchGetTableItems failed for ${resource}:`, error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log(`[API] batchGetTableItems authentication failed for ${resource} - returning redirected response`);
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to batch get table items');
    }
}

/**
 * @async
 * @function getAllTableItems
 * @description Retrieve all items from a table (with chunked pagination).
 * @param {string} resource - The resource to retrieve the items from.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @param {ProgressCallback} onProgress - A callback function to report progress.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of items.
 */
export async function getAllTableItems(
    resource: string,
    pid: string,
    hash: string,
    onProgress?: ProgressCallback
): Promise<any[] | RedirectedResponse> {
    try {
        let accumulateItems: any[] = [];
        let lastEvaluatedKey = null;
        let chunkCount = 0;
        let totalChunks = 0;

        do {
            const response = await api.post(`${API_BASE_URL}/table/${resource}/chunked`, pid, hash, {
                limit: 100,
                lastEvaluatedKey: lastEvaluatedKey
            });

            if (response && response.redirected) {
                console.log(`[API] getAllTableItems redirected for ${resource} - authentication required`);
                return { redirected: true };
            }

            if (response && response.items) {
                accumulateItems = [...accumulateItems, ...response.items];
                chunkCount++;

                // Estimate total chunks based on first chunk size
                if (chunkCount === 1 && response.items.length === 100) {
                    // If first chunk is full, estimate there are more chunks
                    totalChunks = Math.ceil(accumulateItems.length / 100) + 1;
                } else if (chunkCount === 1) {
                    // If first chunk is not full, this might be the only chunk
                    totalChunks = 1;
                }

                if (onProgress) {
                    onProgress(accumulateItems.length, chunkCount, totalChunks);
                }
            }

            lastEvaluatedKey = response?.lastEvaluatedKey;
        } while (lastEvaluatedKey);

        return accumulateItems;
    } catch (error: any) {
        console.error(`[API] getAllTableItems failed for ${resource}:`, error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log(`[API] getAllTableItems authentication failed for ${resource} - returning redirected response`);
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to get all table items');
    }
}

/**
 * @async
 * @function getAllTableItemsWithProjectionExpression
 * @description Retrieve all items from a table with a projection expression.
 * @param {string} resource - The resource to retrieve the items from.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @param {string} projectionExpression - The projection expression.
 * @param {Record<string, string>} expressionAttributeNames - The expression attribute names.
 * @param {ProgressCallback} onProgress - A callback function to report progress.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of items.
 */
export async function getAllTableItemsWithProjectionExpression(
    resource: string,
    pid: string,
    hash: string,
    projectionExpression: string,
    expressionAttributeNames?: Record<string, string>,
    onProgress?: ProgressCallback
): Promise<any[] | RedirectedResponse> {
    try {
        let accumulateItems: any[] = [];
        let lastEvaluatedKey = null;
        let chunkCount = 0;
        let totalChunks = 0;

        do {
            const response = await api.post(`${API_BASE_URL}/table/${resource}/chunked`, pid, hash, {
                limit: 100,
                lastEvaluatedKey: lastEvaluatedKey,
                projectionExpression: projectionExpression,
                ...(expressionAttributeNames && { expressionAttributeNames })
            });

            if (response && response.redirected) {
                console.log(`[API] getAllTableItemsWithProjectionExpression redirected for ${resource} - authentication required`);
                return { redirected: true };
            }

            if (response && response.items) {
                accumulateItems = [...accumulateItems, ...response.items];
                chunkCount++;

                // Estimate total chunks based on first chunk size
                if (chunkCount === 1 && response.items.length === 100) {
                    // If first chunk is full, estimate there are more chunks
                    totalChunks = Math.ceil(accumulateItems.length / 100) + 1;
                } else if (chunkCount === 1) {
                    // If first chunk is not full, this might be the only chunk
                    totalChunks = 1;
                }

                if (onProgress) {
                    onProgress(accumulateItems.length, chunkCount, totalChunks);
                }
            }

            lastEvaluatedKey = response?.lastEvaluatedKey;
        } while (lastEvaluatedKey);

        return accumulateItems;
    } catch (error: any) {
        console.error(`[API] getAllTableItemsWithProjectionExpression failed for ${resource}:`, error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log(`[API] getAllTableItemsWithProjectionExpression authentication failed for ${resource} - returning redirected response`);
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to get all table items with projection');
    }
}

/**
 * @async
 * @function sendSQSMessage
 * @description Send a message to an SQS queue.
 * @param {SQSMessageData} messageData - The data for the message.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<{ success: boolean; messageId?: string } | RedirectedResponse>} A promise that resolves to an object indicating success and the message ID.
 */
export async function sendSQSMessage(
    messageData: SQSMessageData,
    pid: string,
    hash: string
): Promise<{ success: boolean; messageId?: string } | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/sqs/send`, pid, hash, messageData);

        if (response && response.redirected) {
            return { redirected: true };
        }

        return { success: true, messageId: response.messageId };
    } catch (error: any) {
        console.error('[API] sendSQSMessage failed:', error);
        throw new Error(error.message || 'Failed to send SQS message');
    }
}

/**
 * @async
 * @function getWebSocketConnection
 * @description Get the details for a WebSocket connection.
 * @param {string} resource - The resource to get the WebSocket connection for.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<WebSocketConnectionDetails | RedirectedResponse>} A promise that resolves to the WebSocket connection details.
 */
export async function getWebSocketConnection(
    resource: string,
    pid: string,
    hash: string
): Promise<WebSocketConnectionDetails | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/websocket/${resource}/connect`, pid, hash, {});

        if (response && response.redirected) {
            return { redirected: true };
        }

        if (!response.websocketUrl || !response.token) {
            throw new Error('Invalid WebSocket connection response');
        }

        return {
            websocketUrl: response.websocketUrl,
            token: response.token
        };
    } catch (error: any) {
        // Log the error for debugging but don't re-throw with additional context
        console.log(`[API] getWebSocketConnection failed for ${resource}:`, error.message);

        // Re-throw the original error to preserve the exact error message from the backend
        throw error;
    }
}

/**
 * @async
 * @function getWebSocketConnectionNoToken
 * @description Get the details for a WebSocket connection without a token.
 * @param {string} resource - The resource to get the WebSocket connection for.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<WebSocketConnectionDetails | RedirectedResponse>} A promise that resolves to the WebSocket connection details.
 */
export async function getWebSocketConnectionNoToken(
    resource: string,
    pid: string,
    hash: string
): Promise<WebSocketConnectionDetails | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/websocket/${resource}/connectnotoken`, pid, hash, {});

        if (response && response.redirected) {
            return { redirected: true };
        }

        if (!response.websocketUrl) {
            throw new Error('Invalid WebSocket connection response');
        }

        return {
            websocketUrl: response.websocketUrl,
            token: response.token || null
        };
    } catch (error: any) {
        // Log the error for debugging but don't re-throw with additional context
        console.log(`[API] getWebSocketConnectionNoToken failed for ${resource}:`, error.message);

        // Re-throw the original error to preserve the exact error message from the backend
        throw error;
    }
}

/**
 * @async
 * @function sendWorkOrderMessage
 * @description Send a work order message to an SQS queue.
 * @param {string} workOrderId - The ID of the work order.
 * @param {string} stepName - The name of the step.
 * @param {'start' | 'stop'} action - The action to perform.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<{ success: boolean; messageId?: string } | RedirectedResponse>} A promise that resolves to an object indicating success and the message ID.
 */
export async function sendWorkOrderMessage(
    workOrderId: string,
    stepName: string,
    action: 'start' | 'stop',
    pid: string,
    hash: string
): Promise<{ success: boolean; messageId?: string } | RedirectedResponse> {
    return sendSQSMessage({ workOrderId, stepName, action }, pid, hash);
}

/**
 * @async
 * @function putTableItem
 * @description Insert or update an item by id in a table.
 * @param {string} resource - The resource to put the item in.
 * @param {string} id - The ID of the item to put.
 * @param {any} item - The item to put.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any>} A promise that resolves to the response.
 */
export async function putTableItem(
    resource: string,
    id: string,
    item: any,
    pid: string,
    hash: string
): Promise<any> {
    try {
        const response = await api.put(`${API_BASE_URL}/table/${resource}/${id}`, pid, hash, item);
        if (response && response.redirected) {
            return { redirected: true };
        }
        return response;
    } catch (error: any) {
        console.error(`[API] putTableItem failed for ${resource}/${id}:`, error);
        throw new Error(error.message || 'Failed to put table item');
    }
}

/**
 * @async
 * @function deleteTableItem
 * @description Delete an item by id from a table.
 * @param {string} resource - The resource to delete the item from.
 * @param {string} id - The ID of the item to delete.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any>} A promise that resolves to the response.
 */
export async function deleteTableItem(
    resource: string,
    id: string,
    pid: string,
    hash: string
): Promise<any> {
    try {
        const response = await api.del(`${API_BASE_URL}/table/${resource}/${id}`, pid, hash);
        if (response && response.redirected) {
            return { redirected: true };
        }
        return response;
    } catch (error: any) {
        console.error(`[API] deleteTableItem failed for ${resource}/${id}:`, error);
        throw new Error(error.message || 'Failed to delete table item');
    }
}

/**
 * @async
 * @function updateTableItem
 * @description Update an item by id in a table.
 * @param {string} resource - The resource to update the item in.
 * @param {string} id - The ID of the item to update.
 * @param {string} fieldName - The name of the field to update.
 * @param {any} fieldValue - The new value of the field.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any>} A promise that resolves to the response.
 */
export async function updateTableItem(
    resource: string,
    id: string,
    fieldName: string,
    fieldValue: any,
    pid: string,
    hash: string
): Promise<any> {
    try {
        const response = await api.post(`${API_BASE_URL}/table/${resource}/${id}/update`, pid, hash, {
            fieldName,
            fieldValue
        });
        if (response && response.redirected) {
            return { redirected: true };
        }
        return response;
    } catch (error: any) {
        console.error(`[API] updateTableItem failed for ${resource}/${id}:`, error);
        throw new Error(error.message || 'Failed to update table item');
    }
}

/**
 * @async
 * @function getAllTableItemsFiltered
 * @description Retrieve all items from a table that match a filter.
 * @param {string} resource - The resource to retrieve the items from.
 * @param {string} filterFieldName - The name of the field to filter on.
 * @param {string | boolean} filterFieldValue - The value of the field to filter on.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @param {ProgressCallback} onProgress - A callback function to report progress.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of items.
 */
export async function getAllTableItemsFiltered(
    resource: string,
    filterFieldName: string,
    filterFieldValue: string | boolean,
    pid: string,
    hash: string,
    onProgress?: ProgressCallback
): Promise<any[] | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/table/${resource}/filtered`, pid, hash, {
            filterFieldName,
            filterFieldValue
        });

        if (response && response.redirected) {
            return { redirected: true };
        }

        return response.items || [];
    } catch (error: any) {
        console.error(`[API] getAllTableItemsFiltered failed for ${resource}:`, error);
        throw new Error(error.message || 'Failed to get filtered table items');
    }
}

/**
 * @async
 * @function queryGetTableItems
 * @description Retrieve items from a table using a query.
 * @param {string} resource - The resource to retrieve the items from.
 * @param {string} primaryKeyValue - The value of the primary key.
 * @param {string} sortKeyValue - The value of the sort key.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @param {ProgressCallback} onProgress - A callback function to report progress.
 * @returns {Promise<any[] | Record<string, any[]> | RedirectedResponse>} A promise that resolves to an array of items or a record of items.
 */
export async function queryGetTableItems(
    resource: string,
    primaryKeyValue: string,
    sortKeyValue: string,
    pid: string,
    hash: string,
    onProgress?: ProgressCallback
): Promise<any[] | Record<string, any[]> | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/table/${resource}/query`, pid, hash, {
            primaryKeyValue,
            sortKeyValue
        });

        if (response && response.redirected) {
            return { redirected: true };
        }

        // Check if we have results (multiple keys) or items (single key)
        if (response.results) {
            return response.results;
        } else {
            return response.items || [];
        }
    } catch (error: any) {
        console.error(`[API] queryGetTableItems failed for ${resource}:`, error);
        throw new Error(error.message || 'Failed to query table items');
    }
}

/**
 * @async
 * @function getTableCount
 * @description Get the number of items in a table.
 * @param {string} resource - The resource to get the count from.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<{ count: number } | RedirectedResponse>} A promise that resolves to an object containing the count.
 */
export async function getTableCount(
    resource: string,
    pid: string,
    hash: string
): Promise<{ count: number } | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/table/${resource}/count`, pid, hash, {});

        if (response && response.redirected) {
            console.log(`[API] getTableCount redirected for ${resource} - authentication required`);
            return { redirected: true };
        }

        return { count: response?.count || 0 };
    } catch (error: any) {
        console.error(`[API] getTableCount failed for ${resource}:`, error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log(`[API] getTableCount authentication failed for ${resource} - returning redirected response`);
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to get table count');
    }
}

/**
 * @async
 * @function authGetViews
 * @description Get the views for a participant.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of views.
 */
export async function authGetViews(
    pid: string,
    hash: string
): Promise<any[] | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/getViews/${pid}`, pid, hash, {});

        if (response && response.redirected) {
            console.log('[API] authGetViews redirected - authentication required');
            return { redirected: true };
        }

        return response?.views || [];
    } catch (error: any) {
        console.error('[API] authGetViews failed:', error);

        // Check if this is an authentication error and return redirected response
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViews authentication failed - returning redirected response');
            return { redirected: true };
        }

        throw new Error(error.message || 'Failed to get views');
    }
}

/**
 * @async
 * @function authGetViewsWritePermission
 * @description Get the write permission for the views of a participant.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<boolean | RedirectedResponse>} A promise that resolves to a boolean indicating the write permission.
 */
export async function authGetViewsWritePermission(
    pid: string,
    hash: string
): Promise<boolean | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/viewsWritePermission/${pid}`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetViewsWritePermission redirected - authentication required');
            return { redirected: true };
        }
        return !!response?.viewsWritePermission;
    } catch (error: any) {
        console.error('[API] authGetViewsWritePermission failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViewsWritePermission authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get views write permission');
    }
}

/**
 * @async
 * @function authGetViewsExportCSV
 * @description Get the export CSV permission for the views of a participant.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<boolean | RedirectedResponse>} A promise that resolves to a boolean indicating the export CSV permission.
 */
export async function authGetViewsExportCSV(
    pid: string,
    hash: string
): Promise<boolean | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/viewsExportCSV/${pid}`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetViewsExportCSV redirected - authentication required');
            return { redirected: true };
        }
        return !!response?.exportCSV;
    } catch (error: any) {
        console.error('[API] authGetViewsExportCSV failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViewsExportCSV authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get export CSV permission');
    }
}

/**
 * @async
 * @function authGetViewsHistoryPermission
 * @description Get the history permission for the views of a participant.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<boolean | RedirectedResponse>} A promise that resolves to a boolean indicating the history permission.
 */
export async function authGetViewsHistoryPermission(
    pid: string,
    hash: string
): Promise<boolean | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/viewsHistoryPermission/${pid}`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetViewsHistoryPermission redirected - authentication required');
            return { redirected: true };
        }
        return !!response?.studentHistory;
    } catch (error: any) {
        console.error('[API] authGetViewsHistoryPermission failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViewsHistoryPermission authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get views history permission');
    }
}

/**
 * @async
 * @function authGetViewsEmailDisplayPermission
 * @description Get the email display permission for the views of a participant.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<boolean | RedirectedResponse>} A promise that resolves to a boolean indicating the email display permission.
 */
export async function authGetViewsEmailDisplayPermission(
    pid: string,
    hash: string
): Promise<boolean | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/viewsEmailDisplayPermission/${pid}`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetViewsEmailDisplayPermission redirected - authentication required');
            return { redirected: true };
        }
        return !!response?.emailDisplay;
    } catch (error: any) {
        console.error('[API] authGetViewsEmailDisplayPermission failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViewsEmailDisplayPermission authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get views email display permission');
    }
}

/**
 * @async
 * @function authGetLink
 * @description Get an access link for a student.
 * @param {string} domainName - The domain name to get the link for.
 * @param {string} studentId - The ID of the student.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<string | RedirectedResponse>} A promise that resolves to the access link.
 */
export async function authGetLink(
    domainName: string,
    studentId: string,
    pid: string,
    hash: string
): Promise<string | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/getLink`, pid, hash, {
            domainName,
            studentId
        });
        if (response && response.redirected) {
            console.log('[API] authGetLink redirected - authentication required');
            return { redirected: true };
        }
        return response?.accessLink || '';
    } catch (error: any) {
        console.error('[API] authGetLink failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetLink authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get access link');
    }
}

/**
 * @async
 * @function authGetActionsProfiles
 * @description Get the actions profiles.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<string[] | RedirectedResponse>} A promise that resolves to an array of actions profiles.
 */
export async function authGetActionsProfiles(
    pid: string,
    hash: string
): Promise<string[] | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/getActionsProfiles`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetActionsProfiles redirected - authentication required');
            return { redirected: true };
        }
        return response?.profileNames || [];
    } catch (error: any) {
        console.error('[API] authGetActionsProfiles failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetActionsProfiles authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get actions profiles');
    }
}

/**
 * @async
 * @function authGetAuthList
 * @description Get the list of authentications.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any[] | RedirectedResponse>} A promise that resolves to an array of authentications.
 */
export async function authGetAuthList(
    pid: string,
    hash: string
): Promise<any[] | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/getAuthList`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetAuthList redirected - authentication required');
            return { redirected: true };
        }
        return response?.authRecords || [];
    } catch (error: any) {
        console.error('[API] authGetAuthList failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetAuthList authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get auth list');
    }
}

/**
 * @async
 * @function authGetViewsProfiles
 * @description Get the views profiles.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<string[] | RedirectedResponse>} A promise that resolves to an array of views profiles.
 */
export async function authGetViewsProfiles(
    pid: string,
    hash: string
): Promise<string[] | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/getViewsProfiles`, pid, hash, {});
        if (response && response.redirected) {
            console.log('[API] authGetViewsProfiles redirected - authentication required');
            return { redirected: true };
        }
        return response?.viewsProfileNames || [];
    } catch (error: any) {
        console.error('[API] authGetViewsProfiles failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authGetViewsProfiles authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to get views profiles');
    }
}

/**
 * @async
 * @function authPutAuthItem
 * @description Put an authentication item.
 * @param {any} authRecord - The authentication record to put.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @returns {Promise<any | RedirectedResponse>} A promise that resolves to the response.
 */
export async function authPutAuthItem(
    authRecord: any,
    pid: string,
    hash: string
): Promise<any | RedirectedResponse> {
    try {
        const response = await api.post(`${API_BASE_URL}/auth/putAuthItem`, pid, hash, { authRecord });
        if (response && response.redirected) {
            console.log('[API] authPutAuthItem redirected - authentication required');
            return { redirected: true };
        }
        return response;
    } catch (error: any) {
        console.error('[API] authPutAuthItem failed:', error);
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('authentication'))) {
            console.log('[API] authPutAuthItem authentication failed - returning redirected response');
            return { redirected: true };
        }
        throw new Error(error.message || 'Failed to put auth item');
    }
} 