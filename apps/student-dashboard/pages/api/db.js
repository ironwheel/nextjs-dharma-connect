/**
 * @file apps/student-dashboard/pages/api/db.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description API route for generic database operations.
 * Imports and uses shared logic from @dharma/backend-core.
 */
import {
    corsMiddleware,
    csrfMiddleware,
    // Import all necessary action handlers from @dharma/backend-core
    handleFindParticipant,
    handleGetPersonalMantra,
    handlePutPersonalMantra,
    handleGetGlobalMantra,
    handleScanTable,
    // handleUpdateParticipant, // Using specific handlers below is generally safer
    handleUpdateEmailPreferences,
    handleWriteProgramError,
    handleWriteDashboardClick,
    handleInitializeDashboard,
    handleWritePrompt
    // Add any other action handlers you've defined and exported from @dharma/backend-core
} from '@dharma/backend-core';

// Environment variable for CORS (ensure this is set in your .env.local and Vercel)
const CORS_ALLOWED_ORIGINS_STRING = process.env.CORS_ALLOWED_ORIGINS || "";

// Define which actions are read-only and should bypass CSRF
// Ensure these action names exactly match the 'action' strings sent by the client
const READ_ONLY_ACTIONS = [
    'findParticipant',
    'getPersonalMantra',
    'getGlobalMantra',
    'getEvents',
    'getPools',
    'getPrompts',
    'getConfigPrompts'
];

/**
 * Main API handler for database operations.
 * @async
 * @function dbApiHandler
 * @param {import('next').NextApiRequest} req - The Next.js API request object.
 * @param {import('next').NextApiResponse} res - The Next.js API response object.
 * @returns {Promise<void>}
 */
export default async function dbApiHandler(req, res) {
    const allowedOrigins = CORS_ALLOWED_ORIGINS_STRING.split(',').map(s => s.trim()).filter(Boolean);
    if (corsMiddleware(req, res, allowedOrigins)) {
        return; // Preflight request handled by CORS middleware
    }

    // This endpoint should only accept POST requests as it modifies or fetches data based on payload
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ data: { err: `Method ${req.method} Not Allowed` } });
    }

    let status = 200;
    let responseData = {}; // Use this for the final JSON body

    try {
        // Next.js automatically parses JSON bodies if Content-Type is application/json
        // If body is not already parsed, you might need to parse it here.
        let body = req.body;
        if (typeof req.body === 'string' && req.body.length > 0) { // Check if body is a non-empty string
            try {
                body = JSON.parse(req.body);
            } catch (e) {
                console.warn("Could not parse request body string as JSON:", req.body, e);
                status = 400; throw new Error("Invalid request body: Malformed JSON.");
            }
        } else if (typeof req.body !== 'object' || req.body === null) { // Ensure body is an object if not a string
            console.warn("Request body is not a string or a valid object:", req.body);
            status = 400; throw new Error("Invalid request body: Expected JSON object or string.");
        }

        const { action, payload } = body;

        if (!action) {
            status = 400;
            throw new Error("Missing 'action' in request body.");
        }

        // Conditionally apply CSRF middleware
        if (!READ_ONLY_ACTIONS.includes(action)) {
            console.log(`CSRF Check for action: ${action}`);
            await csrfMiddleware(req, res); // Throws on failure, and sends 403 response
        } else {
            console.log(`CSRF Check SKIPPED for read-only action: ${action}`);
        }

        // getDocClient() is called within each handler in @dharma/backend-core

        console.log(`API Route /api/db: Executing action: ${action}`);

        // Route to the appropriate imported action handler
        switch (action) {
            case 'findParticipant':
                responseData = await handleFindParticipant(payload);
                break;
            case 'getPersonalMantra':
                responseData = await handleGetPersonalMantra(payload);
                break;
            case 'putPersonalMantra': // State-changing, CSRF protected
                responseData = await handlePutPersonalMantra(payload);
                break;
            case 'getGlobalMantra':
                responseData = await handleGetGlobalMantra(payload);
                break;
            case 'getEvents':
                responseData = await handleScanTable({ tableNameKey: 'EVENTS', ...payload });
                break;
            case 'getPools':
                responseData = await handleScanTable({ tableNameKey: 'POOLS', ...payload });
                break;
            case 'getPrompts':
                responseData = await handleScanTable({ tableNameKey: 'PROMPTS', ...payload });
                break;
            case 'getConfigPrompts':
                responseData = await handleScanTable({
                    tableNameKey: 'PROMPTS',
                    scanParams: { // Ensure scanParams is structured correctly for handleScanTable
                        FilterExpression: "#lang = :langVal",
                        ExpressionAttributeNames: { "#lang": "language" },
                        ExpressionAttributeValues: { ":langVal": "universal" }
                    },
                    ...payload // Merge any other payload params
                });
                break;
            case 'updateEmailPreferences': // State-changing, CSRF protected
                responseData = await handleUpdateEmailPreferences(payload);
                break;
            case 'writeProgramError': // State-changing, CSRF protected
                responseData = await handleWriteProgramError(payload);
                break;
            case 'writeDashboardClick': // State-changing, CSRF protected
                responseData = await handleWriteDashboardClick(payload);
                break;
            case 'initializeDashboard': // State-changing, CSRF protected
                responseData = await handleInitializeDashboard(payload);
                break;
            case 'writePrompt': // State-changing, CSRF protected
                responseData = await handleWritePrompt(payload);
                break;
            // Add cases for any other specific actions you defined in @dharma/backend-core/db-actions.js
            default:
                status = 400;
                throw new Error(`Unknown database action: '${action}'`);
        }

    } catch (error) {
        // If CSRF middleware already sent a response, don't try to send another.
        if (res.headersSent) {
            return;
        }
        console.error(`API /api/db error (action: ${req.body?.action}):`, error.message);
        // Determine status code based on error type
        if (error.message === 'CSRF_TOKEN_MISSING' || error.message === 'CSRF_TOKEN_MISMATCH') {
            status = 403; // CSRF middleware should have set this, but being explicit
        } else if (error.message.includes("_NOT_FOUND")) {
            status = 404;
        } else if (error.message.startsWith("Server configuration error") || error.message.startsWith("Database error")) {
            status = 503; // Service Unavailable (config or DB issue)
        } else if (status === 200) { // If no specific status set by error type
            status = 500; // Default to internal server error
        }
        responseData = { err: error.message || "An internal server error occurred." };
    }

    // Ensure response is sent only once
    if (!res.headersSent) {
        res.status(status).json({ data: responseData });
    }
}
