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

export async function POST(request) {
    // CORS is not typically needed for Next.js API routes, but if you want to keep it:
    // (You may need to adapt corsMiddleware for the new API signature)

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
        return new Response(JSON.stringify({ data: { err: `Server misconfiguration. Required environment variables missing: ${missingVars.join(', ')}` } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    let status = 200;
    let responseData = {};

    try {
        let body = {};
        try {
            body = await request.json();
        } catch (e) {
            status = 400;
            throw new Error("Invalid request body: Malformed JSON.");
        }

        const { pid, ip, fingerprint, token, showcase, action, hash, url } = body;
        // No req.query in App Router; use body only

        if (!action) {
            status = 400;
            throw new Error("Missing 'action' in request body");
        }

        switch (action) {
            case 'verifyAccess':
                if (!pid || !fingerprint || !token) { status = 400; throw new Error("Missing parameters for verifyAccess."); }
                try {
                    await verifyToken(pid, ip, fingerprint, 'access', token);
                    responseData = { success: true, message: "Access token verified." };
                } catch (verificationError) {
                    status = 200;
                    responseData = { err: 'INVALID_SESSION_TOKEN', reason: verificationError.message };
                }
                break;
            case 'verifyConfirm':
                if (!pid || !fingerprint || !token) { status = 400; throw new Error("Missing parameters for verifyConfirm."); }
                try {
                    const newAccessToken = await verifyToken(pid, ip, fingerprint, 'confirm', token);
                    // CSRF token cookie logic is not directly supported in App Router; skip for now
                    responseData = { accessToken: newAccessToken };
                } catch (verificationError) {
                    status = 401;
                    responseData = { err: 'INVALID_CONFIRM_TOKEN', reason: verificationError.message };
                }
                break;
            case 'sendConfirmationEmail':
                if (!pid || !ip || !fingerprint) { status = 400; throw new Error("Missing parameters for sendConfirmationEmail operation."); }
                responseData = await sendConfirmationEmail(pid, ip, fingerprint, showcase, body.url);
                break;
            case 'getPermissions':
                if (!pid) { status = 400; throw new Error("Missing 'pid' in request body for getPermissions."); }
                responseData = getPermissionsLogic(pid);
                break;
            case 'getCsrfToken':
                // CSRF token cookie logic is not directly supported in App Router; skip for now
                responseData = { csrfToken: 'not-implemented' };
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

    return new Response(JSON.stringify({ data: responseData }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const config = {
    api: {
        bodyParser: true,
    },
}; 