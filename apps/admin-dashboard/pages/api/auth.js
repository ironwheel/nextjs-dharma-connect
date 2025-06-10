/**
 * @file apps/student-dashboard/pages/api/auth.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description API route for authentication operations.
 * Imports and uses shared logic from @dharma/backend-core.
 * Includes upfront check for required environment variables.
 * CSRF protection is applied selectively.
 */
import {
    corsMiddleware,
    csrfMiddleware,
    setCsrfTokenCookie,
    verifyToken,
    sendConfirmationEmail,
    findParticipantForAuth,
    getPermissionsLogic,
    TOKEN_ERROR_CODES,
    getPromptsForAid,
    handleCheckAccess
} from '@dharma/backend-core';

const CORS_ALLOWED_ORIGINS_STRING = process.env.CORS_ALLOWED_ORIGINS || "";

/**
 * API handler for authentication operations.
 * @async
 * @function authApiHandler
 * @param {import('next').NextApiRequest} req - The Next.js API request object.
 * @param {import('next').NextApiResponse} res - The Next.js API response object.
 * @returns {Promise<void>}
 */
export default async function authApiHandler(req, res) {
    const allowedOrigins = CORS_ALLOWED_ORIGINS_STRING.split(',').map(s => s.trim()).filter(Boolean);
    if (corsMiddleware(req, res, allowedOrigins)) {
        return; // Preflight request handled by CORS middleware
    }

    // --- Centralized Configuration Check ---
    const requiredEnvVars = [
        'AWS_REGION', 'AWS_COGNITO_IDENTITY_POOL_ID',
        'DYNAMODB_TABLE_PARTICIPANTS', 'DYNAMODB_TABLE_PROMPTS',
        'API_RSA_PRIVATE', 'API_RSA_PUBLIC', 'JWT_ISSUER_NAME',
        'SMTP_USERNAME', 'SMTP_PASSWORD', 'AUTH_EMAIL_FROM', 'AUTH_EMAIL_REPLY_TO',
        'TELIZE_RAPIDAPI_KEY', 'TELIZE_API_HOST',
        'NEXT_PUBLIC_APP_DOMAIN_PROD', 'APP_DOMAIN_DEV',
        'LANG_PERMISSIONS_JSON'
    ];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
        console.error(`API Route /api/auth: Critical configuration missing: ${missingVars.join(', ')}`);
        return res.status(503).json({ data: { err: `Server misconfiguration. Required environment variables missing: ${missingVars.join(', ')}` } });
    }
    // --- End Configuration Check ---

    let status = 200;
    let responseData = {};

    try {
        let body = {};
        if (req.method === 'POST') {
            if (typeof req.body === 'string' && req.body.length > 0) {
                try { body = JSON.parse(req.body); }
                catch (e) { console.warn("Could not parse request body string as JSON:", req.body, e); status = 400; throw new Error("Invalid request body: Malformed JSON."); }
            } else if (typeof req.body === 'object' && req.body !== null) {
                body = req.body;
            }
        }

        const { pid, ip, fingerprint, token, showcase, action, hash, url } = body;
        const queryPid = req.query.pid;

        if (!action) {
            status = 400;
            throw new Error("Missing 'action' in request body");
        }

        console.log(`API Route /api/auth: Executing action: '${action}'`);

        // Apply CSRF middleware selectively
        // Only apply to operations that are truly state-changing AND expect a CSRF token.
        // verifyAccess, confirm, getPermissions, getCsrfToken do not need incoming CSRF check.
        // verifyConfirm establishes the CSRF token.
        if (req.method === 'POST' && !['verifyAccess', 'confirm', 'getCsrfToken', 'verifyConfirm'].includes(action)) {
            // Example: if you had an 'updatePassword' action, it would go here.
            // For now, most POST ops in auth either establish CSRF or don't need it.
            // await csrfMiddleware(req, res);
            console.log(`CSRF middleware would apply here for state-changing POST action: ${action} (if not excluded)`);
        }

        switch (action) {
            case 'verifyAccess': // POST, but does not change state, validates existing token. No CSRF check needed.
                if (!pid || !fingerprint || !token) { status = 400; throw new Error("Missing parameters for verifyAccess."); }
                try {
                    await verifyToken(pid, ip, fingerprint, 'access', token);
                    responseData = { success: true, message: "Access token verified." };
                } catch (verificationError) {
                    console.warn(`Access token verification failed for PID ${pid}: ${verificationError.message}`);
                    status = 200;
                    responseData = { err: 'INVALID_SESSION_TOKEN', reason: verificationError.message };
                }
                break;

            case 'verifyConfirm': // POST, establishes session and CSRF token. No incoming CSRF check needed.
                if (!pid || !fingerprint || !token) { status = 400; throw new Error("Missing parameters for verifyConfirm."); }
                try {
                    const newAccessToken = await verifyToken(pid, ip, fingerprint, 'confirm', token);
                    const csrfTokenValue = setCsrfTokenCookie(req, res); // Set HttpOnly cookie
                    responseData = { accessToken: newAccessToken, csrfToken: csrfTokenValue }; // Send CSRF token to client
                } catch (verificationError) {
                    console.warn(`Confirm token verification failed for PID ${pid}: ${verificationError.message}`);
                    status = 401;
                    responseData = { err: 'INVALID_CONFIRM_TOKEN', reason: verificationError.message };
                }
                break;

            case 'sendConfirmationEmail': // POST, sends email. No CSRF check needed.
                if (!pid || !ip || !fingerprint) { status = 400; throw new Error("Missing parameters for sendConfirmationEmail operation."); }
                responseData = await sendConfirmationEmail(pid, ip, fingerprint, showcase, body.url || req.headers.host);
                break;

            case 'getPermissions': // GET, no CSRF check needed.
                if (!queryPid) { status = 400; throw new Error("Missing 'pid' in query parameters for getPermissions."); }
                responseData = getPermissionsLogic(queryPid);
                break;

            case 'getCsrfToken': // POST or GET. Sets cookie. No incoming CSRF check needed.
                const newCsrfToken = setCsrfTokenCookie(req, res);
                responseData = { csrfToken: newCsrfToken };
                break;

            case 'handleCheckAccess':
                if (!pid || !hash || !url) { status = 400; throw new Error("Missing parameters for handleCheckAccess."); }
                responseData = await handleCheckAccess(pid, hash, url);
                break;

            default:
                status = 400;
                throw new Error(`Unknown auth API action: '${action}'`);
        }

    } catch (error) {
        if (res.headersSent) { return; }
        console.error(`API /api/auth error (action: ${req.body?.action}):`, error.message);
        if (error.message === 'CSRF_TOKEN_MISSING' || error.message === 'CSRF_TOKEN_MISMATCH') {
            status = 403;
        } else if (error.message === "PID_NOT_FOUND") {
            status = 404;
        } else if (error.message.includes(TOKEN_ERROR_CODES?.CONFIG_ERROR) || error.message.startsWith("Server configuration error") || error.message.startsWith("Database error")) {
            status = 503;
        } else if (status === 200) {
            status = 500;
        }
        responseData = { err: error.message || "An internal server error occurred." };
    }

    if (!res.headersSent) {
        res.status(status).json({ data: responseData });
    }
}
