import {
    handleGetWorkOrders,
    handleCreateWorkOrder,
    handleUpdateWorkOrder,
    handleDeleteWorkOrder,
    handleUpdateWorkOrderStatus,
    handleUpdateStepStatus,
    handleLockWorkOrder,
    handleUnlockWorkOrder,
    handleScanTable,
    handleGetConfig,
    handleGetWorkOrder,
    handleFindParticipant,
    sendWorkOrderMessageAction
} from '@dharma/backend-core';

export async function POST(request) {
    let status = 200;
    let responseData = {};
    let action = 'unknown'; // Declare action outside try block

    try {
        const body = await request.json();
        const { action: actionFromBody, params, payload } = body;
        action = actionFromBody; // Assign the action from body
        // Accept both 'params' and 'payload' for compatibility
        const args = params || payload || {};

        console.log(`[API /api/db] Action: ${action}`);
        console.log(`[API /api/db] Args:`, args);

        switch (action) {
            case 'getWorkOrders':
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
            case 'handleLockWorkOrder':
                responseData = await handleLockWorkOrder(args);
                break;
            case 'handleUnlockWorkOrder':
                responseData = await handleUnlockWorkOrder(args);
                break;
            case 'sendWorkOrderMessage':
                responseData = await sendWorkOrderMessageAction(args);
                break;
            case 'getEvents':
                responseData = await handleScanTable({ tableNameKey: 'EVENTS', ...args });
                break;
            case 'getConfig':
                responseData = await handleGetConfig(args);
                break;
            default:
                status = 400;
                responseData = { error: `Unknown action: ${action}` };
        }

        return new Response(JSON.stringify({ data: responseData }), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error(`[API /api/db] Error in action ${action}:`, error);
        return new Response(JSON.stringify({
            data: { err: error.message || 'Internal server error' }
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
} 