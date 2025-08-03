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
 * - batchGetTableItems: Retrieve multiple items by their IDs
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