/**
 * @file packages/sharedBackend/src/authUtils.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared core logic for authentication, user lookups, email, and permissions.
 */
import jwt from 'jsonwebtoken';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { tableGetConfig } from './tableConfig';
import { listAllFiltered, getOne, putOne, getOneWithSort, deleteOne, deleteOneWithSort } from './dynamoClient';
import crypto from 'crypto';

// Add this type at the top of the file, after imports
type PermittedHost = {
    host: string;
    actionsProfile?: string;
    [key: string]: any;
};

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

// Helper function to convert seconds to JWT duration string (e.g., 900 -> '15m')
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

// Helper function to convert seconds to milliseconds
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

// Helper function to strip quotes from environment variables
function stripQuotes(value: string | undefined): string | undefined {
    if (!value) return value;
    return value.replace(/^["']|["']$/g, '');
}

// Application Domain (Logic based on environment)
const APP_DOMAIN = stripQuotes(process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
    ? process.env.NEXT_PUBLIC_APP_DOMAIN_PROD
    : process.env.APP_DOMAIN_DEV);

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
 * Fetches prompts relevant to a given application ID (aid) from DynamoDB.
 * Used by sendConfirmationEmail.
 * @async
 * @function getPromptsForAid
 * @param {string} aid - The application ID for which to fetch prompts.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of prompt items.
 * @throws {Error} If the database scan fails or table name is not configured.
 */
export async function getPromptsForAid(aid: string): Promise<Array<any>> {
    const tableCfg = tableGetConfig('prompts');
    return await listAllFiltered(tableCfg.tableName, 'aid', aid);
}

/**
 * Finds a participant by ID in DynamoDB.
 * Used by sendConfirmationEmail.
 * @async
 * @function findParticipantForAuth
 * @param {string} id - The participant's ID.
 * @returns {Promise<object>} A promise that resolves to the participant's data (specific fields for auth).
 * @throws {Error} If participant not found or database query fails or table name not configured.
 */
export async function findParticipantForAuth(id: string): Promise<any> {
    const tableCfg = tableGetConfig('students');
    return await getOne(tableCfg.tableName, tableCfg.pk, id);
}

/**
 * Creates a JWT token using provided criteria.
 * @async
 * @function createToken
 * @param {string} pid - The participant ID expected in the token.
 * @param {string} clientFingerprint - The client's browser fingerprint (can be null/undefined).
 * @param {string} actionList - List of allowed operations.
 * @returns {stringn} created token.
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
 * Verifies a JWT token against specified criteria. Returns true or false. 
 * Throws errors on bad configuration.
 * @async
 * @function verifyToken
 * @param {string} pid - The participant ID expected in the token.
 * @param {string} clientFingerprint - The client's browser fingerprint (can be null/undefined).
 * @param {string} operation - Operation this token would like to be used for.
 * @param {string} token - The JWT to verify.
 * @returns {Boolean} true if verified, false if not
 * @throws {Error} Throws errors related to bad configuration
 */
export function verifyToken(token: string, pid: string, clientFingerprint: string, operation: string): boolean {
    if (!RSA_PUBLIC_KEY_B64) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing API_RSA_PUBLIC');
    const publicKey = Buffer.from(RSA_PUBLIC_KEY_B64, 'base64').toString('utf-8');
    if (!publicKey) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Invalid API_RSA_PUBLIC');
    if (!JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing JWT_ISSUER_NAME in environment');

    let decoded: any;
    try {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    } catch (err: any) {
        if (err instanceof jwt.TokenExpiredError) {
            console.log("TOKEN ERR: expired");
            return false;
        } else if (err instanceof jwt.JsonWebTokenError) {
            console.log("TOKEN ERR: invalid signature");
            return false;
        } else {
            console.log("TOKEN ERR: unknown");
            return false;
        }
    }

    // Check claims
    if (decoded.issuer !== JWT_ISSUER) {
        console.log("TOKEN ERR: issuer mismatch");
        return false;
    }
    if (decoded.version !== JWT_VERSION) {
        console.log("TOKEN ERR: version mismatch");
        return false;
    }
    if (decoded.type !== JWT_TOKEN_TYPE_ACCESS) {
        console.log("TOKEN ERR: type mismatch");
        return false;
    }
    if (clientFingerprint && decoded.fingerprint && clientFingerprint !== decoded.fingerprint) {
        console.log("TOKEN ERR: fingerprint mismatch:", clientFingerprint, decoded.fingerprint);
        return false;
    }
    if (pid != decoded.pid && pid !== ADMIN_BYPASS_PID) {
        console.log("TOKEN ERR: pid mismatch");
        return false;
    }

    // Debug: Log the decoded token structure
    //console.log("verifyToken: decoded token:", decoded);
    //console.log("verifyToken: decoded.actions type:", typeof decoded.actions);
    //console.log("verifyToken: decoded.actions value:", decoded.actions);
    //console.log("verifyToken: operation:", operation);

    // Ensure actions is an array before calling includes
    if (!decoded.actions) {
        console.log("TOKEN ERR: actions field missing");
        return false;
    }

    let actionsArray: string[];
    if (Array.isArray(decoded.actions)) {
        actionsArray = decoded.actions;
    } else if (typeof decoded.actions === 'string') {
        try {
            actionsArray = JSON.parse(decoded.actions);
        } catch (e) {
            console.log("TOKEN ERR: actions is string but not valid JSON:", decoded.actions);
            return false;
        }
    } else {
        console.log("TOKEN ERR: actions is not array or string:", typeof decoded.actions, decoded.actions);
        return false;
    }

    if (!actionsArray.includes(operation)) {
        console.log("TOKEN ERR: operation not allowed:", operation, actionsArray);
        return false;
    }
    return true;
}

/**
 * Sends a confirmation email to the participant.
 * @async
 * @function verificationEmailSend
 * @param {string} pid - Participant ID.
 * @param {string} email - Participant's email address.
 * @param {string} clientIp - Client's IP address (can be null/undefined).
 * @param {string} clientFingerprint - Client's browser fingerprint (required).
 * @param {string} verificationToken - The verification token from DynamoDB.
 * @param {string} [showcase] - Optional showcase identifier.
 * @param {string} [host] - Optional app host for hash logic.
 * @returns {Promise<string>} Resolves with the participant's email address on success.
 * @throws {Error} If configuration is missing or sending fails.
 */
export async function verificationEmailSend(pid: string, hash: string, host: string, deviceFingerprint: string, clientIp: string | null): Promise<boolean> {
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
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    // Does this user have access to this HOST?
    const permittedHosts: PermittedHost[] = data['permitted-hosts'] || [];
    const permission = permittedHosts.find(permission => permission.host === host);
    if (!permission) throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');

    // User has access to this HOST - send the verification email   

    // Check necessary configs at the start
    if (!SMTP_USERNAME || !SMTP_PASSWORD) throw new Error("SMTP credentials not configured for email sending.");
    if (!TELIZE_RAPIDAPI_KEY || !TELIZE_API_HOST) throw new Error("Geolocation API Key or Host not configured for email sending.");
    if (!EMAIL_FROM || !EMAIL_REPLY_TO) throw new Error("Sender email addresses not configured for email sending.");
    if (!APP_DOMAIN) throw new Error("Application domain not configured for the current environment (for email sending).");

    // Find participant data internally
    const participantData = await findParticipantForAuth(pid);
    if (!participantData) {
        throw new Error('AUTH_PID_NOT_FOUND');
    }

    const language = participantData.writtenLangPref || 'English';
    const localPrompts = await getPromptsForAid('confirm');
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

    const verificationTokenId = crypto.randomUUID();
    tableCfg = tableGetConfig('verification-tokens');

    try {
        await putOne(tableCfg.tableName, {
            verificationTokenId: verificationTokenId,
            pid: pid,
            hash: hash,
            host: host,
            deviceFingerprint: deviceFingerprint,
            createdAt: Date.now(),
            ttl: Date.now() + VERIFICATION_DURATION_MS // Verification token TTL from VERIFICATION_DURATION env var
        }, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    } catch (e) {
        console.error("verificationEmailSend: Failed to create verification token:", e);
        throw new Error('AUTH_VERIFICATION_TOKEN_CREATION_FAILED');
    }

    let verificationCallbackUrl = `${APP_DOMAIN}/login/callback/?pid=${pid}&hash=${hash}&tokenid=${verificationTokenId}`;
    console.log("verificationEmailSend: APP_DOMAIN:", APP_DOMAIN);
    console.log("verificationEmailSend: verificationTokenId:", verificationTokenId);
    console.log("verificationEmailSend: verificationCallbackUrl:", verificationCallbackUrl);

    let emailBody = getConfirmPrompt('email', language)
        .replace(/\|\|name\|\|/g, `${participantData.first} ${participantData.last}`)
        .replace(/\|\|location\|\|/g, location)
        .replace(/\|\|url\|\|/g, verificationCallbackUrl);

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD
        }
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
 * Sends a confirmation email to the participant.
 * @async
 * @function verificationEmailCallback
 * @param {string} pid - Participant ID.
 * @param {string} email - Participant's email address.
 * @param {string} clientIp - Client's IP address (can be null/undefined).
 * @param {string} clientFingerprint - Client's browser fingerprint (required).
 * @param {string} verificationToken - The verification token from DynamoDB.
 * @param {string} [showcase] - Optional showcase identifier.
 * @param {string} [host] - Optional app host for hash logic.
 * @returns {Promise<string>} Resolves with the participant's email address on success.
 * @throws {Error} If configuration is missing or sending fails.
 */
export async function verificationEmailCallback(pid: string, hash: string, host: string, deviceFingerprint: string, verificationTokenId: string): Promise<any> {

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
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);

    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }

    // Does this user have access to this host?
    const permittedHosts: PermittedHost[] = data['permitted-hosts'] || [];
    const permission = permittedHosts.find(permission => permission.host === host);
    if (!permission) {
        throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');
    }
    const actionsProfile = permission.actionsProfile;

    // User has access to this host, so if we can find the verification record we're good to go
    tableCfg = tableGetConfig('verification-tokens');

    const verificationToken = await getOne(tableCfg.tableName, tableCfg.pk, verificationTokenId, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);

    if (!verificationToken) throw new Error('AUTH_VERIFICATION_TOKEN_NOT_FOUND');

    if (verificationToken.hash !== hash) throw new Error('AUTH_VERIFICATION_TOKEN_HASH_MISMATCH');

    if (verificationToken.host !== host) throw new Error('AUTH_VERIFICATION_TOKEN_HOST_MISMATCH');

    if (verificationToken.deviceFingerprint !== deviceFingerprint) {
        console.log("verificationEmailCallback: deviceFingerprint mismatch:", verificationToken.deviceFingerprint, deviceFingerprint);
        throw new Error('AUTH_VERIFICATION_TOKEN_DEVICE_FINGERPRINT_MISMATCH');
    }

    // Lookup related actions list, throw config error if not found
    tableCfg = tableGetConfig('actions-profile');
    const actionsListData = await getOne(tableCfg.tableName, tableCfg.pk, actionsProfile as string, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    if (!actionsListData) throw new Error('AUTH_ACTIONS_LIST_NOT_FOUND');

    // Ensure actionsList is an array
    let actionsList: string[];
    if (Array.isArray(actionsListData.actions)) {
        actionsList = actionsListData.actions;
    } else if (actionsListData.actions && typeof actionsListData.actions === 'string') {
        // If it's a string, try to parse it as JSON
        try {
            actionsList = JSON.parse(actionsListData.actions);
        } catch (e) {
            console.error("Failed to parse actions as JSON:", actionsListData.actions);
            throw new Error('AUTH_ACTIONS_LIST_INVALID_FORMAT');
        }
    } else {
        console.error("Actions list is not in expected format:", actionsListData);
        throw new Error('AUTH_ACTIONS_LIST_INVALID_FORMAT');
    }

    // console.log("verificationEmailCallback: actionsList:", actionsList);

    // Delete the current verification record
    await deleteOne(tableCfg.tableName, tableCfg.pk, verificationTokenId, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);

    // Verification token is valid, so we can create a session
    tableCfg = tableGetConfig('sessions');

    try {
        await putOne(tableCfg.tableName, {
            id: pid,
            fingerprint: deviceFingerprint,
            createdAt: Date.now(),
            ttl: Date.now() + SESSION_DURATION_MS // Session TTL from SESSION_DURATION env var
        }, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    } catch (e) {
        console.error("verificationEmailCallback: Failed to create session:", e);
        throw new Error('AUTH_SESSION_CREATION_FAILED');
    }

    const newAccessToken = createToken(pid, deviceFingerprint, actionsList);
    return {
        status: 'authenticated',
        accessToken: newAccessToken,
    };
}

/**
 * Retrieves language permissions for a given PID.
 * @function getPermissionsLogic
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

// --- Access Hash and Check Logic ---
/**
 * Generates an HMAC hash of a UUID using a secret key.
 *
 * @param {string} guid - UUID string in standard uuid4 format
 * @param {string} secretKeyHex - 64-character hexadecimal secret key
 * @returns {string} HMAC-SHA256 hash as a hex string
 * 
 * The command line tool to generate the hash is:
 * echo -n "<student id" | openssl dgst -sha256 -mac HMAC -macopt hexkey:<secret> -hex
*/
export function generateAuthHash(guid: string, secretKeyHex: string): string {
    if (!/^[0-9a-f]{64}$/i.test(secretKeyHex)) {
        throw new Error('Secret key must be a 64-character hexadecimal string');
    }
    const secretKeyBuffer = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKeyBuffer);
    hmac.update(guid);
    return hmac.digest('hex');
}

/**
 * Checks access for a participant and host using a hash and a secret from APP_ACCESS_JSON.
 *
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

    // console.log("ACTUAL checkAccess(", pid, hash, host, deviceFingerprint, operation, token);

    // Validate inputs
    if (!pid || !hash || !host || !deviceFingerprint || !operation) {
        throw new Error('checkAccess(): Missing required parameters');
    }

    // console.log("ACTUAL checkAccess() ARG CHECK OK")

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

    //console.log("ACTUAL checkAccess() accessList:", accessList);

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

    let tokenExistsAndVerified = false;
    if (token) {
        // console.log("checkAccess: token:", token);
        tokenExistsAndVerified = verifyToken(token, pid, deviceFingerprint, operation);
    }

    // The verify token function which includes operation permission along with
    // the the pre-check of the hash means we're good to go
    // We don't need to return the token because the client already has it
    if (tokenExistsAndVerified) {
        console.log("checkAccess: tokenExistsAndVerified");
        return {
            status: 'authenticated'
        };
    }

    // We either don't have a token or the token is not verified
    // Attempt to refresh the token
    console.log("checkAccess: don't have a token or the token is not verified");

    // Does this user have access?
    let tableCfg = tableGetConfig('auth');
    let data = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);

    console.log("checkAccess: getOne(auth)data:", data);

    let permittedHosts: PermittedHost[] = [];
    if (!data) {
        data = await getOne(tableCfg.tableName, tableCfg.pk, 'default', process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
        if (!data) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
    }
    permittedHosts = data['permitted-hosts'] || [];

    // Does this user have access to this host?
    console.log("checkAccess: permittedHosts:", permittedHosts);
    const permission = permittedHosts.find(permission => permission.host === host);
    console.log("checkAccess: permission:", permission);
    if (!permission) {
        throw new Error('AUTH_USER_ACCESS_NOT_ALLOWED_HOST_NOT_PERMITTED');
    }

    // Check operation permission, throw config error if not found
    const actionsProfile = permission.actionsProfile;
    if (!actionsProfile) throw new Error('AUTH_ACTIONS_PROFILE_NOT_FOUND');
    console.log("checkAccess: actionsProfile:", actionsProfile);

    // Lookup related actions list, throw config error if not found
    tableCfg = tableGetConfig('actions-profile');
    const actionsListData = await getOne(tableCfg.tableName, tableCfg.pk, actionsProfile as string, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    if (!actionsListData) throw new Error('AUTH_ACTIONS_LIST_NOT_FOUND');

    // Ensure actionsList is an array
    let actionsList: string[];
    if (Array.isArray(actionsListData.actions)) {
        actionsList = actionsListData.actions;
    } else if (actionsListData.actions && typeof actionsListData.actions === 'string') {
        // If it's a string, try to parse it as JSON
        try {
            actionsList = JSON.parse(actionsListData.actions);
        } catch (e) {
            console.error("Failed to parse actions as JSON:", actionsListData.actions);
            throw new Error('AUTH_ACTIONS_LIST_INVALID_FORMAT');
        }
    } else {
        console.error("Actions list is not in expected format:", actionsListData);
        throw new Error('AUTH_ACTIONS_LIST_INVALID_FORMAT');
    }

    // console.log("checkAccess: actionsList:", actionsList);

    // Check if the requested operation is allowed
    if (!actionsList.includes(operation)) {
        console.log("checkAccess: operation not allowed:", operation, "allowed actions:", actionsList);
        throw new Error(`AUTH_OPERATION_NOT_ALLOWED: Operation '${operation}' is not permitted. Actions profile: ${actionsProfile}`);
    }

    // Check for existing session which is only created after email verification
    // and has a TTL of AUTH_SESSION_TTL_SECONDS
    // Sessions records use a primary key of pid-deviceFingerprint
    tableCfg = tableGetConfig('sessions');
    console.log("checkAccess: getOneWithSort(sessions) pid:", pid, "deviceFingerprint:", deviceFingerprint);
    const session = await getOneWithSort(tableCfg.tableName, tableCfg.pk, pid, tableCfg.sk, deviceFingerprint, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    console.log("checkAccess: getOneWithSort(sessions) session:", session);
    // If session found, generate fresh access token if the session isn't expired
    if (session) {
        if (session.ttl <= Date.now()) {
            // Session is expired, delete it and fall through to the verification process
            console.log("checkAccess: session is expired, deleting it");
            await deleteOneWithSort(tableCfg.tableName, tableCfg.pk, session.id, tableCfg.sk, deviceFingerprint, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
            console.log("checkAccess: session deleted");
        } else {
            // Session is valid, generate fresh access token
            return {
                status: 'authenticated',
                accessToken: createToken(pid, deviceFingerprint, actionsList)
            };
        }
    }

    // No existing session - begin verification process
    // For now, provide an access token
    // with a limited set of actions. The login page will begin the
    // verification process if the user consents which will call
    // sendVerificationEmail. The link in the verification email will
    // send the user to the login/callback page where, if the user
    // consents the verification process will conclude and a new
    // session record for the current pid+fingerprint will be created

    // Delete any existing verification tokens for this user
    tableCfg = tableGetConfig('verification-tokens');
    const currentVerificationTokens = await listAllFiltered(tableCfg.tableName, 'pid', pid, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
    for (const token of currentVerificationTokens) {
        await deleteOne(tableCfg.tableName, tableCfg.pk, token.verificationTokenId, process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID);
        console.log("checkAccess: deleted verification token:", token.verificationTokenId);
    }

    const verificationActionList = [
        'POST/auth/verificationEmailSend',
        'POST/auth/verificationEmailCallback',
    ];
    const verificationAccessToken = createToken(pid, deviceFingerprint, verificationActionList);
    return {
        status: 'needs-verification',
        accessToken: verificationAccessToken,
    };
}