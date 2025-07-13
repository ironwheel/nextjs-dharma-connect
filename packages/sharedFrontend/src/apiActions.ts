// packages/sharedFrontend/src/apiActions.ts
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
 * Table API helpers for CRUD operations on backend tables.
 *
 * - getTableItem:    Retrieve a single item by id
 * - getAllTableItems: Retrieve all items (with chunked pagination)
 * - putTableItem:    Insert or update an item by id
 * - deleteTableItem: Delete an item by id
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

export async function getTableItemOrNull(
    resource: string,
    id: string,
    pid: string,
    hash: string
): Promise<any | null> {
    try {
        const response = await api.get(`${API_BASE_URL}/table/${resource}/${id}`, pid, hash);

        if (response && response.redirected) {
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
        throw new Error(error.message || 'Failed to get table item');
    }
}

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
                return { redirected: true };
            }

            if (response.items) {
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

            lastEvaluatedKey = response.lastEvaluatedKey;
        } while (lastEvaluatedKey);

        return accumulateItems;
    } catch (error: any) {
        console.error(`[API] getAllTableItems failed for ${resource}:`, error);
        throw new Error(error.message || 'Failed to get all table items');
    }
}

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

export async function sendWorkOrderMessage(
    workOrderId: string,
    stepName: string,
    action: 'start' | 'stop',
    pid: string,
    hash: string
): Promise<{ success: boolean; messageId?: string } | RedirectedResponse> {
    return sendSQSMessage({ workOrderId, stepName, action }, pid, hash);
}

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