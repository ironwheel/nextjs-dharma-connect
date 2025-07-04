/**
 * @file packages/backend-core/src/index.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Barrel file exporting all shared backend logic, utilities, and constants.
 */

// Export from middlewares.js
export {
    corsMiddleware,
    setCsrfTokenCookie,
    csrfMiddleware,
    CSRF_COOKIE_NAME_SECURE,
    CSRF_COOKIE_NAME_INSECURE,
    CSRF_HEADER_NAME
} from './middlewares.js';

// Export from db-client.js
export {
    getDocClient,
    getTableName
} from './db-client.js';

// Export from db-actions.js
export {
    handleFindParticipant,
    handleGetView,
    handleFindConfig,
    handleGetConfig,
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
    handleTableCount,
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
    sendWorkOrderMessageAction,
    handleArchiveWorkOrder,
    handleUnarchiveWorkOrder,
    handleGetArchivedWorkOrders,
    handleGetStage,
    handleGetStages,
    handlePutStage,
    handleFindParentWorkOrder,
} from './db-actions.js';

// Export from auth-logic.js
export {
    JWT_ISSUER,
    JWT_TOKEN_TYPE_CONFIRM,
    JWT_TOKEN_TYPE_ACCESS,
    JWT_VERSION,
    TOKEN_ERROR_CODES,
    DEFAULT_NO_PERMISSIONS,
    verifyToken,
    sendConfirmationEmail,
    getPermissionsLogic,
    handleCheckAccess
} from './auth-logic.js';

// Example of exporting a constant if needed by API routes directly
// export const SOME_IMPORTANT_CONSTANT = 'value';
