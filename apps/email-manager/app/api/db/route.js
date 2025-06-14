import {
    handleGetWorkOrders,
    handleCreateWorkOrder,
    handleUpdateWorkOrder,
    handleDeleteWorkOrder,
    handleUpdateWorkOrderStatus,
    handleUpdateStepStatus,
    handleScanTable,
    handleGetConfig,
    handleGetWorkOrder,
    handleFindParticipant
} from '@dharma/backend-core';

export async function POST(request) {
    let status = 200;
    let responseData = {};

    try {
        const body = await request.json();
        const { action, params, payload } = body;
        // Accept both 'params' and 'payload' for compatibility
        const args = params || payload || {};

        console.log(`[API /api/db] Action: ${action}`);
        console.log(`[API /api/db] Args:`, args);

        switch (action) {
            case 'handleGetWorkOrders':
                responseData = await handleGetWorkOrders(args);
                break;
            case 'handleGetWorkOrder':
                responseData = await handleGetWorkOrder(args);
                break;
            case 'handleFindParticipant':
                responseData = await handleFindParticipant(args);
                break;
            case 'handleCreateWorkOrder':
                responseData = await handleCreateWorkOrder(args);
                break;
            case 'handleUpdateWorkOrder':
                responseData = await handleUpdateWorkOrder(args);
                break;
            case 'handleDeleteWorkOrder':
                responseData = await handleDeleteWorkOrder(args);
                break;
            case 'handleUpdateWorkOrderStatus':
                responseData = await handleUpdateWorkOrderStatus(args);
                break;
            case 'handleUpdateStepStatus':
                responseData = await handleUpdateStepStatus(args);
                break;
            case 'getEvents':
                responseData = await handleScanTable({ tableNameKey: 'EVENTS', ...args });
                break;
            case 'getConfig':
                responseData = await handleGetConfig(args);
                break;
            default:
                status = 400;
                responseData = { err: `Unknown database action: '${action}'` };
        }
    } catch (error) {
        status = 500;
        responseData = { err: error.message || "Internal server error" };
        console.error(`[API /api/db] Error:`, error);
    }

    return new Response(JSON.stringify(responseData), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
} 