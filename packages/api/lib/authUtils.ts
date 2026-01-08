/**
 * @file packages/api/lib/authUtils.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared core logic for authentication, user lookups, email, and permissions.
 */
import jwt from 'jsonwebtoken';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { tableGetConfig } from './tableConfig';
import { listAllFiltered, listAll, getOne, putOne, getOneWithSort, deleteOne, deleteOneWithSort } from './dynamoClient';
import crypto from 'crypto';

// Add this type at the top of the file, after imports
type PermittedHost = string; // Now just a string representing the host

// Verification result enumeration
export enum VerifyResult {
    VERIFY_OK = 'VERIFY_OK',
    VERIFY_ERR_INVALID_SIGNATURE = 'VERIFY_ERR_INVALID_SIGNATURE',
    VERIFY_ERR_EXPIRED = 'VERIFY_ERR_EXPIRED',
    VERIFY_ERR_ISSUER_MISMATCH = 'VERIFY_ERR_ISSUER_MISMATCH',
    VERIFY_ERR_VERSION_MISMATCH = 'VERIFY_ERR_VERSION_MISMATCH',
    VERIFY_ERR_TYPE_MISMATCH = 'VERIFY_ERR_TYPE_MISMATCH',
    VERIFY_ERR_FINGERPRINT_MISMATCH = 'VERIFY_ERR_FINGERPRINT_MISMATCH',
    VERIFY_ERR_PID_MISMATCH = 'VERIFY_ERR_PID_MISMATCH',
    VERIFY_ERR_CONFIG_ERROR = 'VERIFY_ERR_CONFIG_ERROR',
    VERIFY_ERR_OPERATION_NOT_FOUND = 'VERIFY_ERR_OPERATION_NOT_FOUND',
    VERIFY_ERR_UNKNOWN = 'VERIFY_ERR_UNKNOWN'
}

// JWT Configuration (Constants)
export const JWT_ISSUER = process.env.JWT_ISSUER_NAME;
export const JWT_TOKEN_TYPE_ACCESS = 'access';
export const JWT_VERSION = '2';
const ADMIN_BYPASS_PID = process.env.ADMIN_BYPASS_PID;

// Duration Configuration from Environment Variables (Strict)
const ACCESS_TOKEN_DURATION_SECONDS = process.env.ACCESS_TOKEN_DURATION;
const SESSION_DURATION_SECONDS = process.env.SESSION_DURATION;
const VERIFICATION_DURATION_SECONDS = process.env.VERIFICATION_DURATION;

// Validate required duration environment variables
if (!ACCESS_TOKEN_DURATION_SECONDS) {
    throw new Error('ACCESS_TOKEN_DURATION environment variable is required');
}
if (!SESSION_DURATION_SECONDS) {
    throw new Error('SESSION_DURATION environment variable is required');
}
if (!VERIFICATION_DURATION_SECONDS) {
    throw new Error('VERIFICATION_DURATION environment variable is required');
}

/**
 * @function secondsToJwtDuration
 * @description Helper function to convert seconds to JWT duration string (e.g., 900 -> '15m').
 * @param {string} seconds - The number of seconds to convert.
 * @returns {string} The JWT duration string.
 */
function secondsToJwtDuration(seconds: string): string {
    const secondsNum = parseInt(seconds, 10);
    if (isNaN(secondsNum) || secondsNum <= 0) {
        throw new Error(`Invalid duration value: ${seconds}`);
    }

    if (secondsNum < 60) {
        return `${secondsNum}s`;
    } else if (secondsNum < 3600) {
        const minutes = Math.floor(secondsNum / 60);
        return `${minutes}m`;
    } else if (secondsNum < 86400) {
        const hours = Math.floor(secondsNum / 3600);
        return `${hours}h`;
    } else {
        const days = Math.floor(secondsNum / 86400);
        return `${days}d`;
    }
}

/**
 * @function secondsToMilliseconds
 * @description Helper function to convert seconds to milliseconds.
 * @param {string} seconds - The number of seconds to convert.
 * @returns {number} The number of milliseconds.
 */
function secondsToMilliseconds(seconds: string): number {
    const secondsNum = parseInt(seconds, 10);
    if (isNaN(secondsNum) || secondsNum <= 0) {
        throw new Error(`Invalid duration value: ${seconds}`);
    }
    return secondsNum * 1000;
}

// Convert environment variables to appropriate formats
const ACCESS_TOKEN_DURATION_JWT = secondsToJwtDuration(ACCESS_TOKEN_DURATION_SECONDS);
const SESSION_DURATION_MS = secondsToMilliseconds(SESSION_DURATION_SECONDS);
const VERIFICATION_DURATION_MS = secondsToMilliseconds(VERIFICATION_DURATION_SECONDS);

// Custom Error Types/Codes for Token Validation
export const TOKEN_ERROR_CODES = {
    INVALID_SIGNATURE: 'INVALID_SIGNATURE', EXPIRED: 'EXPIRED', ISSUER_MISMATCH: 'ISSUER_MISMATCH',
    VERSION_MISMATCH: 'VERSION_MISMATCH', TYPE_MISMATCH: 'TYPE_MISMATCH',
    FINGERPRINT_MISMATCH: 'FINGERPRINT_MISMATCH', PID_MISMATCH: 'PID_MISMATCH',
    CONFIG_ERROR: 'CONFIG_ERROR', UNKNOWN: 'UNKNOWN_VERIFICATION_ERROR'
};

// Email Configuration from Env Vars (Strict)
const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const EMAIL_FROM = process.env.AUTH_EMAIL_FROM;
const EMAIL_REPLY_TO = process.env.AUTH_EMAIL_REPLY_TO;

// External API Configuration from Env Vars (Strict)
const TELIZE_RAPIDAPI_KEY = process.env.TELIZE_RAPIDAPI_KEY;
const TELIZE_API_HOST = process.env.TELIZE_API_HOST;

// RSA Keys (Read directly, check for existence in functions that use them)
const RSA_PRIVATE_KEY_B64 = process.env.API_RSA_PRIVATE;
const RSA_PUBLIC_KEY_B64 = process.env.API_RSA_PUBLIC;

// --- Load Language Permissions from Environment Variable ---
let LANG_PERMISSIONS_DATA: Record<string, any> = {}; // Renamed to avoid conflict if LANG_PERMISSIONS is also exported
try {
    const permissionsJsonString = process.env.LANG_PERMISSIONS_JSON;
    if (permissionsJsonString) {
        LANG_PERMISSIONS_DATA = JSON.parse(permissionsJsonString);
        console.log("auth-logic: Successfully loaded language permissions from LANG_PERMISSIONS_JSON.");
    } else {
        console.error("auth-logic: Error - LANG_PERMISSIONS_JSON environment variable is not set. Permissions will be unavailable.");
    }
} catch (error) {
    console.error("auth-logic: Error parsing LANG_PERMISSIONS_JSON environment variable:", error);
    LANG_PERMISSIONS_DATA = {};
}

// Define a default permissions object (all false)
export const DEFAULT_NO_PERMISSIONS = {
    "English": false, "Czech": false, "French": false, "Spanish": false,
    "Portuguese": false, "German": false, "Italian": false, "Dutch": false,
    "Russian": false, "Ukranian": false
    // Ensure this list includes all languages your frontend might expect keys for
};

// --- Helper Functions ---

/**
 * @async
 * @function getActionsProfileForHost
 * @description Gets the actions profile for a given host from the app.actions table
 * @param {string} host - The host to look up
 * @returns {Promise<string>} The actions profile name for the host
 * @throws {Error} If host not found in app.actions table
 */
async function getActionsProfileForHost(host: string, oidcToken?: string): Promise<string> {
    const tableCfg = tableGetConfig('app.actions');
    const appActionData = await getOne(tableCfg.tableName, tableCfg.pk, host, process.env.AUTH_ROLE_ARN, oidcToken);
    if (!appActionData) {
        throw new Error(`AUTH_APP_ACTIONS_NOT_FOUND: No actions profile found for host '${host}'`);
    }
    return appActionData.actionsProfile;
}

/**
 * @async
 * @function getAllActionsForUser
 * @description Gets all actions for a user based on their permitted hosts
 * @param {string[]} permittedHosts - Array of hosts the user has access to
 * @returns {Promise<string[]>} Array of all actions the user has access to
 * @throws {Error} If any host's actions profile is not found
 */
async function getAllActionsForUser(permittedHosts: string[], oidcToken?: string): Promise<string[]> {
    const allActions: string[] = [];

    for (const host of permittedHosts) {
        try {
            const actionsProfile = await getActionsProfileForHost(host, oidcToken);

            // Lookup the actions list for this profile
            const tableCfg = tableGetConfig('actions-profile');
            const actionsListData = await getOne(tableCfg.tableName, tableCfg.pk, actionsProfile, process.env.AUTH_ROLE_ARN, oidcToken);

            if (!actionsListData) {
                throw new Error(`AUTH_ACTIONS_LIST_NOT_FOUND: No actions list found for profile '${actionsProfile}'`);
            }

            // Ensure actionsList is an array
            let actionsList: string[];
            if (Array.isArray(actionsListData.actions)) {
                actionsList = actionsListData.actions;
            } else if (actionsListData.actions && typeof actionsListData.actions === 'string') {
                try {
                    actionsList = JSON.parse(actionsListData.actions);
                } catch (e) {
                    throw new Error(`AUTH_ACTIONS_LIST_INVALID_FORMAT: Invalid JSON for profile '${actionsProfile}'`);
                }
            } else {
                throw new Error(`AUTH_ACTIONS_LIST_INVALID_FORMAT: Actions list is not in expected format for profile '${actionsProfile}'`);
            }

            // Add actions to the combined list (avoiding duplicates)
            for (const action of actionsList) {
                if (!allActions.includes(action)) {
                    allActions.push(action);
                }
            }
        } catch (error) {
            console.error(`Failed to get actions for host ${host}:`, error);
            throw error;
        }
    }

    return allActions;
}

/**
 * @async
 * @function getPromptsForAid
 * @description Fetches prompts relevant to a given application ID (aid) from DynamoDB.
 * @param {string} aid - The application ID for which to fetch prompts.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of prompt items.
 * @throws {Error} If the database scan fails or table name is not configured.
 */
async function getPromptsForAid(aid: string, oidcToken?: string): Promise<Array<any>> {
    const tableCfg = tableGetConfig('prompts');
    return await listAllFiltered(tableCfg.tableName, 'aid', aid, undefined, oidcToken);
}

/**
 * @async
 * @function findParticipantForAuth
 * @description Finds a participant by ID in DynamoDB.
 * @param {string} id - The participant's ID.
 * @returns {Promise<object>} A promise that resolves to the participant's data (specific fields for auth).
 * @throws {Error} If participant not found or database query fails or table name not configured.
 */
async function findParticipantForAuth(id: string, oidcToken?: string): Promise<any> {
    const tableCfg = tableGetConfig('students');
    return await getOne(tableCfg.tableName, tableCfg.pk, id, undefined, oidcToken);
}

/**
 * @function createToken
 * @description Creates a JWT token using provided criteria.
 * @param {string} pid - The participant ID expected in the token.
 * @param {string} clientFingerprint - The client's browser fingerprint (can be null/undefined).
 * @param {string} actionList - List of allowed operations.
 * @returns {string} created token.
 * @throws {Error} Throws errors related to bad configuration
 */
export function createToken(pid: string, clientFingerprint: string, actionList: string[]): string {
    if (!RSA_PRIVATE_KEY_B64) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing API_RSA_PRIVATE');
    const privateKey = Buffer.from(RSA_PRIVATE_KEY_B64, 'base64').toString('utf-8');
    if (!privateKey) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Invalid API_RSA_PRIVATE');
    if (!JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing JWT_ISSUER_NAME in environment');

    const accessTokenPayload = { issuer: JWT_ISSUER, type: JWT_TOKEN_TYPE_ACCESS, version: JWT_VERSION, pid: pid, fingerprint: clientFingerprint, actions: actionList };
    const accessToken = jwt.sign(accessTokenPayload, privateKey, { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_DURATION_JWT });
    return accessToken;
}

/**
 * @function verifyToken
 * @description Verifies a JWT token against specified criteria. Returns true or false.
 * @param {string} pid - The participant ID expected in the token.
 * @param {string} clientFingerprint - The client's browser fingerprint (can be null/undefined).
 * @param {string} operation - Operation this token would like to be used for.
 * @param {string} token - The JWT to verify.
 * @returns {VerifyResult} The verification result.
 * @throws {Error} Throws errors related to bad configuration
 */
function verifyToken(token: string, pid: string, clientFingerprint: string, operation: string): VerifyResult {
    if (!RSA_PUBLIC_KEY_B64) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing API_RSA_PUBLIC');
    const publicKey = Buffer.from(RSA_PUBLIC_KEY_B64, 'base64').toString('utf-8');
    if (!publicKey) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Invalid API_RSA_PUBLIC');
    if (!JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing JWT_ISSUER_NAME in environment');

    let decoded: any;
    try {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    } catch (err: any) {
        if (err instanceof jwt.TokenExpiredError) {
            console.log(`TOKEN VERIFICATION [pid=${pid}]: Token expired`);
            console.log(`  - Error: ${err.message}`);
            console.log(`  - Expired at: ${err.expiredAt ? new Date(err.expiredAt).toISOString() : 'unknown'}`);
            console.log(`  - Current time: ${new Date().toISOString()}`);
            console.log(`  - Expected ACCESS_TOKEN_DURATION: ${ACCESS_TOKEN_DURATION_SECONDS || 'unknown'} seconds (${ACCESS_TOKEN_DURATION_SECONDS ? (parseInt(ACCESS_TOKEN_DURATION_SECONDS) / 60).toFixed(2) : 'unknown'} minutes)`);
            return VerifyResult.VERIFY_ERR_EXPIRED;
        } else if (err instanceof jwt.JsonWebTokenError) {
            console.log(`TOKEN VERIFICATION [pid=${pid}]: Invalid signature - ${err.message}`);
            return VerifyResult.VERIFY_ERR_INVALID_SIGNATURE;
        } else {
            console.log(`TOKEN VERIFICATION [pid=${pid}]: Unknown error - ${err.message || err}`);
            return VerifyResult.VERIFY_ERR_UNKNOWN;
        }
    }

    // Check claims
    if (decoded.issuer !== JWT_ISSUER) {
        console.log("TOKEN ERR: issuer mismatch");
        return VerifyResult.VERIFY_ERR_ISSUER_MISMATCH;
    }
    if (decoded.version !== JWT_VERSION) {
        console.log("TOKEN ERR: version mismatch");
        return VerifyResult.VERIFY_ERR_VERSION_MISMATCH;
    }
    if (decoded.type !== JWT_TOKEN_TYPE_ACCESS) {
        console.log("TOKEN ERR: type mismatch");
        return VerifyResult.VERIFY_ERR_TYPE_MISMATCH;
    }
    if (clientFingerprint && decoded.fingerprint && clientFingerprint !== decoded.fingerprint) {
        console.log("TOKEN ERR: fingerprint mismatch:", clientFingerprint, decoded.fingerprint);
        return VerifyResult.VERIFY_ERR_FINGERPRINT_MISMATCH;
    }
    if (pid != decoded.pid && pid !== ADMIN_BYPASS_PID) {
        console.log("TOKEN ERR: pid mismatch");
        return VerifyResult.VERIFY_ERR_PID_MISMATCH;
    }

    // Ensure actions is an array before calling includes
    if (!decoded.actions) {
        console.log("TOKEN ERR: actions field missing");
        return VerifyResult.VERIFY_ERR_OPERATION_NOT_FOUND;
    }

    let actionsArray: string[];
    if (Array.isArray(decoded.actions)) {
        actionsArray = decoded.actions;
    } else if (typeof decoded.actions === 'string') {
        try {
            actionsArray = JSON.parse(decoded.actions);
        } catch (e) {
            console.log("TOKEN ERR: actions is string but not valid JSON:", decoded.actions);
            return VerifyResult.VERIFY_ERR_CONFIG_ERROR;
        }
    } else {
        console.log("TOKEN ERR: actions is not array or string:", typeof decoded.actions, decoded.actions);
        return VerifyResult.VERIFY_ERR_CONFIG_ERROR;
    }

    if (!actionsArray.includes(operation)) {
        // if the token is ok so far, but the operation is not allowed and is
        // one of the verification ops, redirect to login 
        console.log("TOKEN ERR: operation not allowed:", operation, actionsArray);
        return VerifyResult.VERIFY_ERR_OPERATION_NOT_FOUND;
    }
    return VerifyResult.VERIFY_OK;
}

/**
 * @function generateAuthHash
 * @description Generates an HMAC hash of a UUID using a secret key.
 * @param {string} guid - UUID string in standard uuid4 format
 * @param {string} secretKeyHex - 64-character hexadecimal secret key
 * @returns {string} HMAC-SHA256 hash as a hex string
 */
function generateAuthHash(guid: string, secretKeyHex: string): string {
    if (!/^[0-9a-f]{64}$/i.test(secretKeyHex)) {
        throw new Error('Secret key must be a 64-character hexadecimal string');
    }
    const secretKeyBuffer = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKeyBuffer);
    hmac.update(guid);
    return hmac.digest('hex');
}

/**
 * @async
    * @function authGetLink
 * @description Generates an access link for a student to a specific domain.
 * @param { string } domainName - The domain name for the app.
 * @param { string } studentId - The student ID.
 * @returns { Promise<string> } The access link in format: https://${domainName}/?pid=${studentId}&hash=${appSpecificHash}
 * @throws { Error } If the student doesn't have access to the domain or configuration is missing.
    */
async function authGetLink(studentId: string, linkHost: string, oidcToken?: string): Promise<string> {
    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) {
        throw new Error('APP_ACCESS_JSON environment variable not set');
    }

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    // Find domain configuration
    const entry = accessList.find((e: any) => e.host === linkHost);
    if (!entry) {
        throw new Error(`Link host '${linkHost}' not found in APP_ACCESS_JSON`);
    }

    // Check if student has access to this domain
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, studentId, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!data) {
            throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
        }
    }

    // Check if student has access to this domain
    const permittedHosts: string[] = data['permitted-hosts'] || [];
    const hasPermission = permittedHosts.includes(linkHost);
    if (!hasPermission) {
        throw new Error(`Student ${studentId} does not have access to link host '${linkHost}'`);
    }

    // Generate the app-specific hash
    const appSpecificHash = generateAuthHash(studentId, entry.secret);

    // Return the access link
    return `https://${linkHost}/?pid=${studentId}&hash=${appSpecificHash}`;
}

// Auth Exports for the API

/**
 * @async
 * @function linkEmailSend
 * @description Sends an email with an app-specific link to the participant.
 * @param {string} pid - Participant ID of the current user (for authentication).
 * @param {string} hash - The hash value to verify.
 * @param {string} host - The host of the calling app.
 * @param {string} linkHost - The host of the link to send.
 * @param {string} targetUserPid - The participant ID of the user to send the email to.
 * @returns {Promise<boolean>} Resolves with true on success.
 * @throws {Error} If configuration is missing or sending fails.
 */
export async function linkEmailSend(pid: string, hash: string, host: string, linkHost: string, targetUserPid: string, oidcToken?: string): Promise<boolean> {
    // Validate inputs
    if (!pid || !hash || !host || !linkHost || !targetUserPid) {
        throw new Error('linkEmailSend(): Missing required parameters');
    }

    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) throw new Error('APP_ACCESS_JSON environment variable not set');

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    // Find host configuration
    const entry = accessList.find((e: any) => e.host === host);
    if (!entry) throw new Error('UNKNOWN_HOST');

    // If secret found, verify hash
    if (entry.secret !== 'none') {
        const expectedHash = generateAuthHash(pid, entry.secret);
        // Bad hash here means the host requires an app-specific hash
        // and the user either doesn't have or has the wrong hash
        if (expectedHash !== hash) throw new Error('AUTHUSER_ACCESS_NOT_ALLOWED_BAD_HASH');
    }

    // Does the originating user have access to the originating host
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    let permittedHosts: string[] = data['permitted-hosts'] || [];
    let hasPermission = permittedHosts.includes(host);
    if (!hasPermission) throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');

    // Does the target user have access to the link host?
    data = await getOne(tableCfg.tableName, tableCfg.pk, targetUserPid, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    permittedHosts = data['permitted-hosts'] || [];
    hasPermission = permittedHosts.includes(linkHost);
    if (!hasPermission) throw new Error('AUTH_TARGETUSER_ACCESS_NOT_ALLOWED_LINK_HOST_NOT_PERMITTED');

    // Check necessary configs at the start
    if (!SMTP_USERNAME || !SMTP_PASSWORD) throw new Error("SMTP credentials not configured for email sending.");
    if (!EMAIL_FROM || !EMAIL_REPLY_TO) throw new Error("Sender email addresses not configured for email sending.");

    // Find participant data internally for the target user
    const participantData = await findParticipantForAuth(targetUserPid, oidcToken);
    if (!participantData) {
        throw new Error('AUTH_PID_NOT_FOUND');
    }

    const language = participantData.writtenLangPref || 'English';
    const localPrompts = await getPromptsForAid('link', oidcToken);
    const getLinkPrompt = (promptId: string, lang: string): string => {
        const found = localPrompts.find((p: any) => p.prompt === `link-${promptId}` && p.language === lang);
        if (found) return found.text;
        const englishFallback = localPrompts.find((p: any) => p.prompt === `link-${promptId}` && p.language === 'English');
        return englishFallback ? englishFallback.text : `link-${promptId}-${lang}-unknown`;
    };

    const link = await authGetLink(targetUserPid, linkHost, oidcToken);

    let emailBody = getLinkPrompt('email', language)
        .replace(/\|\|name\|\|/g, `${participantData.first} ${participantData.last}`)
        .replace(/\|\|linkDescription\|\|/g, getLinkPrompt('subject-' + linkHost, language))
        .replace(/\|\|link\|\|/g, link);

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD
        },
        // Ensure proper encoding to avoid quoted-printable encoding issues
        encoding: 'utf8'
    });

    const mailOptions = {
        from: EMAIL_FROM,
        replyTo: EMAIL_REPLY_TO,
        to: participantData.email,
        subject: getLinkPrompt('subject-' + linkHost, language),
        html: emailBody
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`auth-logic: Link email sent successfully to: ${participantData.email}, Info: ${info.messageId}`);
        return true;
    } catch (emailError: any) {
        console.error("auth-logic: Failed to send confirmation email:", emailError);
        throw new Error('AUTH_LINK_EMAIL_SEND_FAILED');
    }
}

/**
 * @async
 * @function verificationEmailSend
 * @description Sends a confirmation email to the participant.
 * @param {string} pid - Participant ID.
 * @param {string} hash - The hash value to verify.
 * @param {string} host - The host of the calling app.
 * @param {string} deviceFingerprint - The client's browser fingerprint.
 * @param {string | null} clientIp - The client's IP address.
 * @returns {Promise<boolean>} Resolves with true on success.
 * @throws {Error} If configuration is missing or sending fails.
 */
export async function verificationEmailSend(pid: string, hash: string, host: string, deviceFingerprint: string, clientIp: string | null, oidcToken?: string): Promise<boolean> {
    // Validate inputs
    if (!pid || !hash || !host || !deviceFingerprint) {
        throw new Error('verificationEmailSend(): Missing required parameters');
    }

    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) throw new Error('APP_ACCESS_JSON environment variable not set');

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    // Find host configuration
    const entry = accessList.find((e: any) => e.host === host);
    if (!entry) throw new Error('UNKNOWN_HOST');

    // If secret found, verify hash
    // TODO: do all apps need a hash?
    if (entry.secret !== 'none') {
        const expectedHash = generateAuthHash(pid, entry.secret);
        // Bad hash here means the host requires an app-specific hash
        // and the user either doesn't have or has the wrong hash
        if (expectedHash !== hash) throw new Error('AUTHUSER_ACCESS_NOT_ALLOWED_BAD_HASH');
    }

    // Does this user have access?
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    // Does this user have access to this HOST?
    const permittedHosts: string[] = data['permitted-hosts'] || [];
    const hasPermission = permittedHosts.includes(host);
    if (!hasPermission) throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');

    // Check for rate limiting - look for recent verification emails sent
    tableCfg = tableGetConfig('verification-tokens');
    const recentEmails = await listAllFiltered(tableCfg.tableName, 'pid', pid, process.env.AUTH_ROLE_ARN, oidcToken);
    const recentVerificationEmails = recentEmails.filter((token: any) =>
        token.pid === pid &&
        token.deviceFingerprint === deviceFingerprint &&
        !token.failedAttempt &&
        token.createdAt > Date.now() - (2 * 60 * 1000) // Last 2 minutes
    );

    if (recentVerificationEmails.length >= 3) {
        throw new Error('AUTH_RATE_LIMIT_EXCEEDED');
    }

    // User has access to this HOST - send the verification email   

    // Check necessary configs at the start
    if (!SMTP_USERNAME || !SMTP_PASSWORD) throw new Error("SMTP credentials not configured for email sending.");
    if (!TELIZE_RAPIDAPI_KEY || !TELIZE_API_HOST) throw new Error("Geolocation API Key or Host not configured for email sending.");
    if (!EMAIL_FROM || !EMAIL_REPLY_TO) throw new Error("Sender email addresses not configured for email sending.");

    // Find participant data internally
    const participantData = await findParticipantForAuth(pid, oidcToken);
    if (!participantData) {
        throw new Error('AUTH_PID_NOT_FOUND');
    }

    const language = participantData.writtenLangPref || 'English';
    const localPrompts = await getPromptsForAid('confirm', oidcToken);
    const getConfirmPrompt = (promptId: string, lang: string): string => {
        const found = localPrompts.find((p: any) => p.prompt === `confirm-${promptId}` && p.language === lang);
        if (found) return found.text;
        const englishFallback = localPrompts.find((p: any) => p.prompt === `confirm-${promptId}` && p.language === 'English');
        return englishFallback ? englishFallback.text : `confirm-${promptId}-${lang}-unknown`;
    };

    let location = 'an unknown location';
    if (clientIp) {
        try {
            const geoOptions = {
                method: 'GET',
                url: `https://${TELIZE_API_HOST}/location/${clientIp}`,
                headers: {
                    'X-RapidAPI-Key': TELIZE_RAPIDAPI_KEY,
                    'X-RapidAPI-Host': TELIZE_API_HOST
                }
            };
            const geoResponse = await axios.request(geoOptions);
            if (geoResponse.data) {
                location = `${geoResponse.data.city || ''}, ${geoResponse.data.region || ''} (${geoResponse.data.country || 'N/A'})`.replace(/^, |, $/g, '');
            }
        } catch (geoError: any) {
            console.warn(`auth-logic: Could not fetch geolocation for IP ${clientIp}:`, geoError.message);
        }
    }

    const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
    const verificationTokenId = generateOTP();
    tableCfg = tableGetConfig('verification-tokens');

    try {
        await putOne(tableCfg.tableName, {
            verificationTokenId: verificationTokenId,
            pid: pid,
            hash: hash,
            host: host,
            deviceFingerprint: deviceFingerprint,
            createdAt: Date.now(),
            ttl: Math.floor((Date.now() + VERIFICATION_DURATION_MS) / 1000) // TTL in seconds for DynamoDB
        }, process.env.AUTH_ROLE_ARN, oidcToken);
    } catch (e) {
        console.error("verificationEmailSend: Failed to create verification token:", e);
        throw new Error('AUTH_VERIFICATION_TOKEN_CREATION_FAILED');
    }

    let emailBody = getConfirmPrompt('codeEmail', language)
        .replace(/\|\|name\|\|/g, `${participantData.first} ${participantData.last}`)
        .replace(/\|\|location\|\|/g, location)
        .replace(/\|\|code\|\|/g, verificationTokenId);

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD
        },
        // Ensure proper encoding to avoid quoted-printable encoding issues
        encoding: 'utf8'
    });

    const mailOptions = {
        from: EMAIL_FROM,
        replyTo: EMAIL_REPLY_TO,
        to: participantData.email,
        subject: getConfirmPrompt('subject', language),
        html: emailBody
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`auth-logic: Confirmation email sent successfully to: ${participantData.email}, Info: ${info.messageId}`);
        return true;
    } catch (emailError: any) {
        console.error("auth-logic: Failed to send confirmation email:", emailError);
        throw new Error('AUTH_VERIFICATION_EMAIL_SEND_FAILED');
    }
}

/**
 * @async
 * @function verificationEmailCallback
 * @description Handles the callback for the verification email.
 * @param {string} pid - Participant ID.
 * @param {string} hash - The hash value to verify.
 * @param {string} host - The host of the calling app.
 * @param {string} deviceFingerprint - The client's browser fingerprint.
 * @param {string} verificationTokenId - The verification token from the email.
 * @returns {Promise<any>} Resolves with the authentication status and access token on success.
 * @throws {Error} If configuration is missing or verification fails.
 */
export async function verificationEmailCallback(pid: string, hash: string, host: string, deviceFingerprint: string, verificationTokenId: string, oidcToken?: string): Promise<any> {

    // Validate inputs
    if (!pid || !hash || !host || !deviceFingerprint) {
        throw new Error('verificationEmailCallback(): Missing required parameters');
    }

    // Validate verification token format (should be 6 digits)
    if (!verificationTokenId || !/^\d{6}$/.test(verificationTokenId)) {
        throw new Error('AUTH_VERIFICATION_TOKEN_INVALID_FORMAT');
    }

    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) throw new Error('APP_ACCESS_JSON environment variable not set');

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    // Find host configuration
    const entry = accessList.find((e: any) => e.host === host);
    if (!entry) throw new Error('UNKNOWN_HOST');

    // If secret found, verify hash
    // TODO: do all apps need a hash?
    if (entry.secret !== 'none') {
        const expectedHash = generateAuthHash(pid, entry.secret);
        // Bad hash here means the host requires an app-specific hash
        // and the user either doesn't have or has the wrong hash
        if (expectedHash !== hash) throw new Error('AUTHUSER_ACCESS_NOT_ALLOWED_BAD_HASH');
    }

    // Does this user have access?
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    // Does this user have access to this host?
    const permittedHosts: string[] = data['permitted-hosts'] || [];
    const hasPermission = permittedHosts.includes(host);
    if (!hasPermission) {
        throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');
    }
    const actionsProfile = await getActionsProfileForHost(host, oidcToken);

    // Check for rate limiting - look for recent failed attempts
    tableCfg = tableGetConfig('verification-tokens');
    const recentFailedAttempts = await listAllFiltered(tableCfg.tableName, 'pid', pid, process.env.AUTH_ROLE_ARN, oidcToken);
    const failedAttempts = recentFailedAttempts.filter((token: any) =>
        token.pid === pid &&
        token.deviceFingerprint === deviceFingerprint &&
        token.failedAttempt &&
        token.createdAt > Date.now() - (5 * 60 * 1000) // Last 5 minutes
    );

    if (failedAttempts.length >= 5) {
        throw new Error('AUTH_RATE_LIMIT_EXCEEDED');
    }

    // User has access to this host, so if we can find the verification record we're good to go
    const verificationToken = await getOne(tableCfg.tableName, tableCfg.pk, verificationTokenId, process.env.AUTH_ROLE_ARN, oidcToken);

    if (!verificationToken) {
        // Record failed attempt
        try {
            await putOne(tableCfg.tableName, {
                verificationTokenId: `failed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                pid: pid,
                hash: hash,
                host: host,
                deviceFingerprint: deviceFingerprint,
                failedAttempt: true,
                createdAt: Date.now(),
                ttl: Math.floor((Date.now() + (10 * 60 * 1000)) / 1000) // 10 minutes TTL in seconds for DynamoDB
            }, process.env.AUTH_ROLE_ARN, oidcToken);
        } catch (e) {
            console.error("verificationEmailCallback: Failed to record failed attempt:", e);
        }
        throw new Error('AUTH_VERIFICATION_TOKEN_NOT_FOUND');
    }

    if (verificationToken.hash !== hash) {
        // Record failed attempt
        try {
            await putOne(tableCfg.tableName, {
                verificationTokenId: `failed_${Date.now()}_${Math.random()}_${Math.random().toString(36).substr(2, 9)}`,
                pid: pid,
                hash: hash,
                host: host,
                deviceFingerprint: deviceFingerprint,
                failedAttempt: true,
                createdAt: Date.now(),
                ttl: Math.floor((Date.now() + (10 * 60 * 1000)) / 1000) // 10 minutes TTL in seconds for DynamoDB
            }, process.env.AUTH_ROLE_ARN, oidcToken);
        } catch (e) {
            console.error("verificationEmailCallback: Failed to record failed attempt:", e);
        }
        throw new Error('AUTH_VERIFICATION_TOKEN_HASH_MISMATCH');
    }

    if (verificationToken.host !== host) {
        // Record failed attempt
        try {
            await putOne(tableCfg.tableName, {
                verificationTokenId: `failed_${Date.now()}_${Math.random()}_${Math.random().toString(36).substr(2, 9)}`,
                pid: pid,
                hash: hash,
                host: host,
                deviceFingerprint: deviceFingerprint,
                failedAttempt: true,
                createdAt: Date.now(),
                ttl: Math.floor((Date.now() + (10 * 60 * 1000)) / 1000) // 10 minutes TTL in seconds for DynamoDB
            }, process.env.AUTH_ROLE_ARN);
        } catch (e) {
            console.error("verificationEmailCallback: Failed to record failed attempt:", e);
        }
        throw new Error('AUTH_VERIFICATION_TOKEN_HOST_MISMATCH');
    }

    if (verificationToken.deviceFingerprint !== deviceFingerprint) {
        console.log("verificationEmailCallback: deviceFingerprint mismatch:", verificationToken.deviceFingerprint, deviceFingerprint);
        // Record failed attempt
        try {
            await putOne(tableCfg.tableName, {
                verificationTokenId: `failed_${Date.now()}_${Math.random()}_${Math.random().toString(36).substr(2, 9)}`,
                pid: pid,
                hash: hash,
                host: host,
                deviceFingerprint: deviceFingerprint,
                failedAttempt: true,
                createdAt: Date.now(),
                ttl: Math.floor((Date.now() + (10 * 60 * 1000)) / 1000) // 10 minutes TTL in seconds for DynamoDB
            }, process.env.AUTH_ROLE_ARN);
        } catch (e) {
            console.error("verificationEmailCallback: Failed to record failed attempt:", e);
        }
        throw new Error('AUTH_VERIFICATION_TOKEN_DEVICE_FINGERPRINT_MISMATCH');
    }

    // Get all actions for all apps the user has access to (design improvement)
    console.log("verificationEmailCallback: getting all actions for user across all permitted hosts");
    const allActionsList = await getAllActionsForUser(permittedHosts);
    console.log("verificationEmailCallback: allActionsList:", allActionsList);

    // Delete the current verification record
    await deleteOne(tableCfg.tableName, tableCfg.pk, verificationTokenId, process.env.AUTH_ROLE_ARN);

    // Verification token is valid, so we can create a session
    tableCfg = tableGetConfig('sessions');

    const sessionCreatedAt = Date.now();
    const sessionTTL = Math.floor((sessionCreatedAt + SESSION_DURATION_MS) / 1000);
    const sessionDurationSeconds = Math.floor(SESSION_DURATION_MS / 1000);

    console.log(`SESSION CREATION [pid=${pid}]:`);
    console.log(`  - Creating new session after email verification`);
    console.log(`  - Created at: ${new Date(sessionCreatedAt).toISOString()} (${sessionCreatedAt})`);
    console.log(`  - TTL set to: ${sessionTTL} (expires: ${new Date(sessionTTL * 1000).toISOString()})`);
    console.log(`  - SESSION_DURATION_MS: ${SESSION_DURATION_MS} ms`);
    console.log(`  - Session duration: ${sessionDurationSeconds} seconds (${(sessionDurationSeconds / 3600).toFixed(2)} hours)`);
    console.log(`  - Device fingerprint: ${deviceFingerprint}`);

    try {
        await putOne(tableCfg.tableName, {
            id: pid,
            fingerprint: deviceFingerprint,
            createdAt: sessionCreatedAt,
            ttl: sessionTTL // TTL in seconds for DynamoDB
        }, process.env.AUTH_ROLE_ARN, oidcToken);
        console.log(`SESSION CREATION [pid=${pid}]: Successfully created session in DynamoDB`);
    } catch (e) {
        console.error("verificationEmailCallback: Failed to create session:", e);
        throw new Error('AUTH_SESSION_CREATION_FAILED');
    }

    const newAccessToken = createToken(pid, deviceFingerprint, allActionsList);
    return {
        status: 'authenticated',
        accessToken: newAccessToken,
    };
}

/**
 * @async
 * @function verificationCheck
 * @description Checks if a device has an active session (used for preflight verification flows)
 * @param {string} pid - Participant ID
 * @param {string} hash - Verification hash
 * @param {string} host - Host of the calling app
 * @param {string} deviceFingerprint - Device fingerprint (from headers)
 */
export async function verificationCheck(pid: string, hash: string, host: string, deviceFingerprint: string): Promise<any> {
    const determineVerificationStatusResponse = async (): Promise<{ status: 'pending-verification' | 'needs-verification' }> => {
        const verificationTokensCfg = tableGetConfig('verification-tokens');
        const verificationTokens = await listAllFiltered(
            verificationTokensCfg.tableName,
            'pid',
            pid,
            process.env.AUTH_ROLE_ARN
        );

        const currentTimeSeconds = Math.floor(Date.now() / 1000);
        const activeToken = verificationTokens.find((token: any) => {
            const tokenTtl = typeof token.ttl === 'number' ? token.ttl : Number(token.ttl);
            return (
                token.pid === pid &&
                token.deviceFingerprint === deviceFingerprint &&
                !token.failedAttempt &&
                Number.isFinite(tokenTtl) &&
                tokenTtl > currentTimeSeconds
            );
        });

        if (activeToken) {
            console.log(`VERIFICATION CHECK [pid=${pid}]: Active verification token found, pending verification`);
            return {
                status: 'pending-verification'
            };
        }

        console.log(`VERIFICATION CHECK [pid=${pid}]: No active verification token found, needs verification`);
        return {
            status: 'needs-verification'
        };
    };

    if (!pid || !hash || !host || !deviceFingerprint) {
        throw new Error('verificationCheck(): Missing required parameters');
    }

    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) {
        throw new Error('APP_ACCESS_JSON environment variable not set');
    }

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    const entry = accessList.find((e: any) => e.host === host);
    if (!entry) {
        throw new Error('UNKNOWN_HOST');
    }

    if (entry.secret !== 'none') {
        const expectedHash = generateAuthHash(pid, entry.secret);
        if (expectedHash !== hash) {
            throw new Error('AUTHUSER_ACCESS_NOT_ALLOWED_BAD_HASH');
        }
    }

    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN);
        if (!data) {
            throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
        }
    }

    const permittedHosts: string[] = data['permitted-hosts'] || [];
    if (!permittedHosts.includes(host)) {
        throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');
    }

    tableCfg = tableGetConfig('sessions');
    const session = await getOneWithSort(
        tableCfg.tableName,
        tableCfg.pk,
        pid,
        tableCfg.sk,
        deviceFingerprint,
        process.env.AUTH_ROLE_ARN
    );

    if (session) {
        const currentTimeSeconds = Math.floor(Date.now() / 1000);
        const sessionTTL = session.ttl;

        if (sessionTTL <= currentTimeSeconds) {
            console.log(`VERIFICATION CHECK [pid=${pid}]: Session expired, deleting and returning pending state`);
            await deleteOneWithSort(
                tableCfg.tableName,
                tableCfg.pk,
                pid,
                tableCfg.sk,
                deviceFingerprint,
                process.env.AUTH_ROLE_ARN
            );
            return await determineVerificationStatusResponse();
        }

        console.log(`VERIFICATION CHECK [pid=${pid}]: Active session found, returning authenticated state`);
        const allActionsList = await getAllActionsForUser(permittedHosts);
        const accessToken = createToken(pid, deviceFingerprint, allActionsList);
        return {
            status: 'authenticated',
            accessToken
        };
    }

    console.log(`VERIFICATION CHECK [pid=${pid}]: No session found, pending verification`);
    return await determineVerificationStatusResponse();
}

/**
 * @function getPermissionsLogic
 * @description Retrieves language permissions for a given PID.
 * @param {string} pid - The participant ID.
 * @returns {object} The permissions object for the PID, or a default "no permissions" object if not found.
 */
export function getPermissionsLogic(pid: string): any {
    if (!pid) {
        console.warn("auth-logic: getPermissionsLogic called without PID. Returning default no permissions.");
        return { ...DEFAULT_NO_PERMISSIONS }; // Return a copy
    }
    if (LANG_PERMISSIONS_DATA[pid]) {
        return LANG_PERMISSIONS_DATA[pid];
    } else {
        console.warn(`auth-logic: Permissions not found for PID: ${pid}. Returning default (all false).`);
        return { ...DEFAULT_NO_PERMISSIONS }; // Return a copy
    }
}

/**
 * @async
 * @function checkAccess
 * @description Checks access for a participant and host using a hash and a secret from APP_ACCESS_JSON.
 * @param {string} pid - Participant ID
 * @param {string} hash - Hash value to check
 * @param {string} host - host of the calling app
 * @param {string} deviceFingerprint - Device fingerprint of the calling app
 * @param {string} operation - Operation to check against the actions list
 * @param {string} token - Optional token to check against the actions list
 * @returns {Promise<object>} Empty object if authorized
 * @throws {Error} Various errors as described
 */
export async function checkAccess(pid: string, hash: string, host: string, deviceFingerprint: string, operation: string, token?: string): Promise<any> {

    // Verification action list
    const verificationActionList = [
        'POST/auth/verificationEmailSend',
        'POST/auth/verificationEmailCallback',
        'POST/auth/verificationCheck',
    ];

    // Validate inputs
    if (!pid || !hash || !host || !deviceFingerprint || !operation) {
        throw new Error('checkAccess(): Missing required parameters');
    }

    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) {
        console.log("ACTUAL checkAccess() APP_ACCESS_JSON environment variable not set");
        throw new Error('APP_ACCESS_JSON environment variable not set');
    }

    let accessList: any[];
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        console.log("ACTUAL checkAccess() APP_ACCESS_JSON is not valid JSON");
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }

    // Find HOST configuration
    const entry = accessList.find((e: any) => e.host === host);
    if (!entry) throw new Error('UNKNOWN_HOST');

    // If secret found, verify hash
    // TODO: do all apps need a hash?
    if (entry.secret !== 'none') {
        const expectedHash = generateAuthHash(pid, entry.secret);
        // Bad hash here means the HOST requires an app-specific hash
        // and the user either doesn't have or has the wrong hash
        if (expectedHash !== hash) throw new Error('AUTHUSER_ACCESS_NOT_ALLOWED_BAD_HASH');
    }

    let tokenVerificationResult = VerifyResult.VERIFY_ERR_UNKNOWN;
    if (token) {
        console.log(`TOKEN CHECK [pid=${pid}]: Access token provided, attempting verification for operation: ${operation}`);
        tokenVerificationResult = verifyToken(token, pid, deviceFingerprint, operation);
        console.log(`TOKEN CHECK [pid=${pid}]: Verification result: ${tokenVerificationResult}`);
    } else {
        console.log(`TOKEN CHECK [pid=${pid}]: No access token provided in request`);
    }

    // The verify token function which includes operation permission along with
    // the the pre-check of the hash means we're good to go
    // We don't need to return the token because the client already has it
    if (tokenVerificationResult === VerifyResult.VERIFY_OK) {
        console.log(`TOKEN CHECK [pid=${pid}]: Token valid and operation permitted, user authenticated`);
        return {
            status: 'authenticated'
        };
    }

    // Token verification failed, will check for valid session to refresh token
    if (token) {
        console.log(`TOKEN CHECK [pid=${pid}]: Token verification failed (${tokenVerificationResult}), checking session for token refresh`);
    }

    // Check if token is valid but operation not found, and if it's a verification operation
    if (tokenVerificationResult === VerifyResult.VERIFY_ERR_OPERATION_NOT_FOUND && verificationActionList.includes(operation)) {
        // Token is valid but operation not found, and this is a verification operation
        // This means the user is already authenticated and trying to perform verification
        return {
            status: 'already-authenticated'
        };
    }

    // We either don't have a token or the token is not verified
    // Attempt to refresh the token

    // Does this user have access?
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN);

    let permittedHosts: PermittedHost[] = [];
    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }
    permittedHosts = data['permitted-hosts'] || [];

    // Does this user have access to this host?
    const hasPermission = permittedHosts.includes(host);
    if (!hasPermission) {
        throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');
    }

    // Get all actions for all apps the user has access to (design improvement)
    const allActionsList = await getAllActionsForUser(permittedHosts);

    // Add verification actions to the allowed actions list
    const allActionsWithVerification = [...allActionsList, ...verificationActionList];

    // Check if the requested operation is allowed
    if (!allActionsWithVerification.includes(operation)) {
        console.log("checkAccess: operation not allowed:", operation, "allowed actions:", allActionsWithVerification);
        throw new Error(`AUTH_OPERATION_NOT_ALLOWED: Operation '${operation}' is not permitted for user across all apps`);
    }

    // SECURITY FIX: Distinguish between NO TOKEN (new login) and EXPIRED TOKEN (refresh attempt)
    // If NO token was provided, this is a new login attempt and should ALWAYS require verification,
    // regardless of whether a valid session exists. This prevents session reuse without proper authentication.
    tableCfg = tableGetConfig('sessions');
    if (!token) {
        console.log(`SECURITY CHECK [pid=${pid}]: NO TOKEN PROVIDED - treating as new login attempt`);

        // Look for any existing session for this user/device
        const existingSession = await getOneWithSort(tableCfg.tableName, tableCfg.pk, pid, tableCfg.sk, deviceFingerprint, process.env.AUTH_ROLE_ARN);

        if (existingSession) {
            // Delete the existing session even if it's not expired
            // This forces the user through verification flow for new login attempts
            console.log(`SECURITY CHECK [pid=${pid}]: Deleting existing session - no token provided requires new verification`);
            console.log(`  - Session was created: ${new Date(existingSession.createdAt || 0).toISOString()}`);
            console.log(`  - Session TTL: ${existingSession.ttl} (expires: ${new Date((existingSession.ttl || 0) * 1000).toISOString()})`);

            await deleteOneWithSort(tableCfg.tableName, tableCfg.pk, pid, tableCfg.sk, deviceFingerprint, process.env.AUTH_ROLE_ARN);
        } else {
            console.log(`SECURITY CHECK [pid=${pid}]: No existing session found - proceeding to verification flow`);
        }

        // Force user into verification flow - do not allow session-based refresh
        console.log(`SECURITY CHECK [pid=${pid}]: Forcing verification flow for no-token request`);
        const verificationAccessToken = createToken(pid, deviceFingerprint, verificationActionList);
        return {
            status: verificationActionList.includes(operation) ? 'expired-auth-flow' : 'needs-verification',
            accessToken: verificationAccessToken,
        };
    }

    // If we reach here, a token WAS provided but verification failed (expired/invalid)
    // This is a legitimate token refresh scenario - check for existing session
    console.log(`TOKEN REFRESH CHECK [pid=${pid}]: Token was provided but invalid/expired - checking for valid session to refresh`);

    // Check for existing session which is only created after email verification
    // Sessions records use a primary key of pid-deviceFingerprint
    const session = await getOneWithSort(tableCfg.tableName, tableCfg.pk, pid, tableCfg.sk, deviceFingerprint, process.env.AUTH_ROLE_ARN);

    // If session found, generate fresh access token if the session isn't expired
    if (session) {
        const currentTimeSeconds = Math.floor(Date.now() / 1000);
        const sessionTTL = session.ttl;
        const sessionCreatedAt = session.createdAt || 0;
        const sessionAgeSeconds = currentTimeSeconds - Math.floor(sessionCreatedAt / 1000);
        const timeUntilExpirySeconds = sessionTTL - currentTimeSeconds;

        console.log(`SESSION CHECK [pid=${pid}]:`);
        console.log(`  - Session found: YES`);
        console.log(`  - Session created: ${new Date(sessionCreatedAt).toISOString()} (${sessionCreatedAt})`);
        console.log(`  - Session age: ${sessionAgeSeconds} seconds (${(sessionAgeSeconds / 3600).toFixed(2)} hours)`);
        console.log(`  - Session TTL: ${sessionTTL} (expires: ${new Date(sessionTTL * 1000).toISOString()})`);
        console.log(`  - Current time: ${currentTimeSeconds} (${new Date(currentTimeSeconds * 1000).toISOString()})`);
        console.log(`  - Time until expiry: ${timeUntilExpirySeconds} seconds (${(timeUntilExpirySeconds / 3600).toFixed(2)} hours)`);
        console.log(`  - Expected SESSION_DURATION: ${SESSION_DURATION_SECONDS || 'unknown'} seconds (${SESSION_DURATION_SECONDS ? (parseInt(SESSION_DURATION_SECONDS) / 3600).toFixed(2) : 'unknown'} hours)`);
        console.log(`  - Is expired: ${sessionTTL <= currentTimeSeconds}`);

        if (sessionTTL <= currentTimeSeconds) {
            // Session is expired, delete it and fall through to the verification process
            console.log(`SESSION EXPIRED [pid=${pid}]: Deleting session and requiring re-verification`);
            console.log(`  - Reason: TTL (${sessionTTL}) <= current time (${currentTimeSeconds})`);
            console.log(`  - Session was valid for: ${sessionAgeSeconds} seconds instead of expected ${SESSION_DURATION_SECONDS || 'unknown'} seconds`);
            await deleteOneWithSort(tableCfg.tableName, tableCfg.pk, session.id, tableCfg.sk, deviceFingerprint, process.env.AUTH_ROLE_ARN);
        } else {
            // Session is valid, generate fresh access token with all actions
            console.log(`SESSION VALID [pid=${pid}]: Refreshing access token`);
            console.log(`  - ${timeUntilExpirySeconds} seconds remaining on session`);
            const allActionsList = await getAllActionsForUser(permittedHosts);
            return {
                status: 'authenticated',
                accessToken: createToken(pid, deviceFingerprint, allActionsList)
            };
        }
    } else {
        console.log(`SESSION CHECK [pid=${pid}]:`);
        console.log(`  - Session found: NO`);
        console.log(`  - Reason: No session record exists for pid=${pid} with fingerprint=${deviceFingerprint}`);
        console.log(`  - User will need to complete email verification to create a new session`);
    }

    // No existing session - begin verification process
    // Verification operates with a token that supports a limited set of actions.
    // The login page will begin the verification process. If the user consents, the login will call
    // verificationEmailSend() which will send a verification email containing a code to the user. 
    // The user will copy the code and paste it into the login page. If the login code is confirmed,
    // verificationEmailCallback() will create a new session record for the current pid+fingerprint.

    // Note: Verification tokens are managed via DynamoDB TTL to prevent race conditions
    // between multiple open apps. Tokens expire automatically after VERIFICATION_DURATION.

    const verificationAccessToken = createToken(pid, deviceFingerprint, verificationActionList);
    return {
        status: verificationActionList.includes(operation) ? 'expired-auth-flow' : 'needs-verification',
        accessToken: verificationAccessToken,
    };
}

/**
 * @async
 * @function getConfigValue
 * @description Get a config value for a specific participant and app/host
 * @param {string} pid - Participant ID.
 * @param {string} hash - The hash value to verify.
 * @param {string} host - The host of the calling app.
 * @param {string} key - The config key to retrieve.
 * @returns {Promise<any>} Resolves with the config value
 * @throws {Error} If configuration is missing or host is not permitted
 */
export async function getConfigValue(pid: string, host: string, key: string, oidcToken?: string): Promise<any> {
    console.log("getConfigValue: pid:", pid, "host:", host, "key:", key);

    // Does this user have access to the host they're trying to get the config value for?
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN, oidcToken);
    let usingDefaultData = false;

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        usingDefaultData = true;
        if (!data) {
            throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
        }
    }

    // Check if user has access to this host
    const permittedHosts: string[] = data['permitted-hosts'] || [];
    const hasPermission = permittedHosts.includes(host);
    if (!hasPermission) {
        throw new Error('AUTH_UNPERMITTED_HOST');
    }

    // Look for the config value in the user's record first
    if (data.config && data.config[host] && data.config[host][key] !== undefined) {
        return data.config[host][key];
    }

    // Key not found in user's record and possibly in default record
    if (!usingDefaultData) {
        const defaultData = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AUTH_ROLE_ARN, oidcToken);
        if (!defaultData) {
            throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
        }

        if (defaultData.config && defaultData.config[host] && defaultData.config[host][key] !== undefined) {
            return defaultData.config[host][key];
        }
    }

    // If still not found, return false instead of throwing error
    return false;
}

/**
 * @async
 * @function getActionsProfiles
 * @description Retrieves all action profile names from the actions-profiles table.
 * @returns {Promise<string[]>} Resolves with a list of profile names from the 'profile' field
 * @throws {Error} If the database scan fails or table name is not configured.
 */
export async function getActionsProfiles(oidcToken?: string): Promise<string[]> {
    const tableCfg = tableGetConfig('actions-profile');
    const allProfiles = await listAllFiltered(tableCfg.tableName, 'profile', 'profile', process.env.AUTH_ROLE_ARN, oidcToken);

    // Extract just the profile names from the results
    const profileNames = allProfiles.map((item: any) => item.profile).filter(Boolean);

    return profileNames;
}

/**
 * @async
 * @function getAuthList
 * @description Retrieves all auth records from the auth table.
 * @returns {Promise<any[]>} Resolves with a list of all auth records
 * @throws {Error} If the database scan fails or table name is not configured.
 */
export async function getAuthList(oidcToken?: string): Promise<any[]> {
    const tableCfg = tableGetConfig('auth');
    const allAuthRecords = await listAll(tableCfg.tableName, process.env.AUTH_ROLE_ARN, oidcToken);

    return allAuthRecords;
}

/**
 * @async
 * @function putAuthItem
 * @description Updates or creates an auth record in the auth table.
 * @param {string} id - The auth record ID (student ID or 'default')
 * @param {any} authRecord - The auth record data to save
 * @returns {Promise<void>} Resolves when the record is saved
 * @throws {Error} If the database operation fails or table name is not configured.
 */
export async function putAuthItem(id: string, authRecord: any, oidcToken?: string): Promise<void> {
    const tableCfg = tableGetConfig('auth');
    await putOne(tableCfg.tableName, authRecord, process.env.AUTH_ROLE_ARN, oidcToken);
}

/**
 * @async
 * @function getViews
 * @description Get views for a specified participant
 * @param {string} pid - Participant ID.
 * @param {string} host - The host of the calling app.
 * @returns {Promise<string[]>} Resolves with a list of views the participant has access to
 * @throws {Error} If configuration is missing
 */
export async function getViews(pid: string, host: string, oidcToken?: string): Promise<string[]> {

    // Get the views profile name from the config
    const viewsProfile = await getConfigValue(pid, host, 'viewsProfile', oidcToken);
    if (!viewsProfile) {
        throw new Error('AUTH_VIEWS_NO_PROFILE');
    }

    // Lookup related views profile, throw config error if not found
    const tableCfg = tableGetConfig('views-profiles');
    console.log('getViews(): Got views-profiles table config:', tableCfg);

    const viewsListData = await getOne(tableCfg.tableName, tableCfg.pk, viewsProfile as string, process.env.AUTH_ROLE_ARN, oidcToken);
    console.log('getViews(): Retrieved views list data for profile:', viewsProfile, 'data:', viewsListData);

    if (!viewsListData) {
        console.log('getViews(): ERROR - No views list data found for profile:', viewsProfile);
        throw new Error('AUTH_VIEWS_LIST_NOT_FOUND');
    }

    console.log('getViews(): Returning views:', viewsListData.views);
    return viewsListData.views;
}

/**
 * @async
 * @function getViewsProfiles
 * @description Retrieves all views profile names from the views-profiles table.
 * @returns {Promise<string[]>} Resolves with a list of profile names from the 'profile' field
 * @throws {Error} If the database scan fails or table name is not configured.
 */
export async function getViewsProfiles(oidcToken?: string): Promise<string[]> {
    const tableCfg = tableGetConfig('views-profiles');
    console.log('getViewsProfiles: tableCfg:', tableCfg);

    try {
        // Try listAll first to see what's in the table
        const allProfiles = await listAll(tableCfg.tableName, process.env.AUTH_ROLE_ARN, oidcToken);
        console.log('getViewsProfiles: allProfiles from listAll:', allProfiles);

        // Extract just the profile names from the results
        const profileNames = allProfiles.map((item: any) => item.profile).filter(Boolean);
        console.log('getViewsProfiles: extracted profileNames:', profileNames);

        return profileNames;
    } catch (error) {
        console.error('getViewsProfiles: Error with listAll:', error);

        // Fallback to listAllFiltered if listAll fails
        try {
            const filteredProfiles = await listAllFiltered(tableCfg.tableName, 'profile', 'profile', process.env.AUTH_ROLE_ARN, oidcToken);
            console.log('getViewsProfiles: filteredProfiles from listAllFiltered:', filteredProfiles);

            const filteredProfileNames = filteredProfiles.map((item: any) => item.profile).filter(Boolean);
            console.log('getViewsProfiles: extracted profileNames from filtered:', filteredProfileNames);

            return filteredProfileNames;
        } catch (filteredError) {
            console.error('getViewsProfiles: Error with listAllFiltered:', filteredError);
            return [];
        }
    }
}