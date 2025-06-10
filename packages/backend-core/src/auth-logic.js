/**
 * @file packages/backend-core/src/auth-logic.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared core logic for authentication, user lookups, email, and permissions.
 */
import jwt from 'jsonwebtoken';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./db-client.js"; // For DB interactions
import crypto from 'crypto';

// --- Configuration from Environment Variables (Strict - No Defaults where applicable) ---
// Note: DDB_PARTICIPANTS_TABLE and DDB_PROMPTS_TABLE are used by getTableName via db-client.js

// JWT Configuration (Constants)
export const JWT_ISSUER = process.env.JWT_ISSUER_NAME;
export const JWT_TOKEN_TYPE_CONFIRM = 'confirm';
export const JWT_TOKEN_TYPE_ACCESS = 'access';
export const JWT_VERSION = '2';
const ADMIN_BYPASS_PID = process.env.ADMIN_BYPASS_PID;

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

// Application Domain (Logic based on environment)
const APP_DOMAIN = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
    ? process.env.NEXT_PUBLIC_APP_DOMAIN_PROD
    : process.env.APP_DOMAIN_DEV;

// RSA Keys (Read directly, check for existence in functions that use them)
const RSA_PRIVATE_KEY_B64 = process.env.API_RSA_PRIVATE;
const RSA_PUBLIC_KEY_B64 = process.env.API_RSA_PUBLIC;

// --- Load Language Permissions from Environment Variable ---
let LANG_PERMISSIONS_DATA = {}; // Renamed to avoid conflict if LANG_PERMISSIONS is also exported
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
export async function getPromptsForAid(aid) {
    const client = getDocClient(); // From db-client.js
    const tableName = getTableName('PROMPTS'); // From db-client.js

    const params = { TableName: tableName, FilterExpression: "aid = :aid_val", ExpressionAttributeValues: { ":aid_val": aid } };
    let prompts = []; let items; let lastEvaluatedKey = undefined;
    try {
        do {
            const command = new ScanCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey });
            items = await client.send(command);
            if (items.Items) prompts.push(...items.Items);
            lastEvaluatedKey = items.LastEvaluatedKey;
        } while (lastEvaluatedKey);
    } catch (error) {
        console.error(`auth-logic: Error fetching prompts for AID ${aid}:`, error);
        throw new Error(`Database error fetching prompts: ${error.message}`);
    }
    return prompts;
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
export async function findParticipantForAuth(id) {
    const client = getDocClient(); // From db-client.js
    const tableName = getTableName('PARTICIPANTS'); // From db-client.js

    const params = {
        TableName: tableName,
        KeyConditionExpression: "id = :uid",
        ExpressionAttributeValues: { ":uid": id },
        ExpressionAttributeNames: { "#first": "first", "#last": "last" }, // Alias if needed
        ProjectionExpression: "#first, #last, email, writtenLangPref", // Fields needed for email
    };
    try {
        const command = new QueryCommand(params);
        const data = await client.send(command);
        if (!data.Items || data.Items.length === 0) {
            console.warn(`auth-logic: PID_NOT_FOUND for ID: ${id}`);
            throw new Error("PID_NOT_FOUND");
        }
        return data.Items[0];
    } catch (error) {
        console.error(`auth-logic: Error finding participant ${id}:`, error);
        if (error.message === "PID_NOT_FOUND") throw error;
        throw new Error(`Database error finding participant: ${error.message}`);
    }
}

/**
 * Verifies a JWT token against specified criteria. Throws specific errors on failure.
 * @async
 * @function verifyToken
 * @param {string} pid - The participant ID expected in the token.
 * @param {string} clientIp - The client's IP address (can be null/undefined).
 * @param {string} clientFingerprint - The client's browser fingerprint (can be null/undefined).
 * @param {string} expectedTokenType - The expected token type (e.g., 'access', 'confirm').
 * @param {string} token - The JWT to verify.
 * @returns {Promise<string | number>} Resolves with an access token if verifying a confirm token, or 0 for access token.
 * @throws {Error} Throws specific errors (using TOKEN_ERROR_CODES values in message) on validation failure.
 */
export async function verifyToken(pid, clientIp, clientFingerprint, expectedTokenType, token) {
    if (!RSA_PUBLIC_KEY_B64) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing API_RSA_PUBLIC');
    const publicKey = Buffer.from(RSA_PUBLIC_KEY_B64, 'base64').toString('utf-8');
    if (!publicKey) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Invalid API_RSA_PUBLIC');
    if (!JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing JWT_ISSUER_NAME in environment');


    let decoded;
    try {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) throw new Error(TOKEN_ERROR_CODES.EXPIRED);
        else if (err instanceof jwt.JsonWebTokenError) throw new Error(TOKEN_ERROR_CODES.INVALID_SIGNATURE + `: ${err.message}`);
        else throw new Error(TOKEN_ERROR_CODES.UNKNOWN + `: ${err.message}`);
    }

    // Check claims
    if (decoded.issuer !== JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.ISSUER_MISMATCH);
    if (decoded.version !== JWT_VERSION) throw new Error(TOKEN_ERROR_CODES.VERSION_MISMATCH);
    if (decoded.type !== expectedTokenType) throw new Error(TOKEN_ERROR_CODES.TYPE_MISMATCH);
    if (clientFingerprint && decoded.fingerprint !== clientFingerprint) throw new Error(TOKEN_ERROR_CODES.FINGERPRINT_MISMATCH); // Only check if provided
    if (ADMIN_BYPASS_PID && decoded.pid !== pid && decoded.pid !== ADMIN_BYPASS_PID) throw new Error(TOKEN_ERROR_CODES.PID_MISMATCH);
    else if (!ADMIN_BYPASS_PID && decoded.pid !== pid) throw new Error(TOKEN_ERROR_CODES.PID_MISMATCH);
    // IP check remains commented out as per original logic
    // if (clientIp && decoded.ip !== clientIp) throw new Error("IP MISMATCH");

    if (expectedTokenType === JWT_TOKEN_TYPE_CONFIRM) {
        if (!RSA_PRIVATE_KEY_B64) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing API_RSA_PRIVATE');
        const privateKey = Buffer.from(RSA_PRIVATE_KEY_B64, 'base64').toString('utf-8');
        if (!privateKey) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Invalid API_RSA_PRIVATE');
        const accessTokenPayload = { issuer: JWT_ISSUER, type: JWT_TOKEN_TYPE_ACCESS, version: JWT_VERSION, pid: pid, ip: clientIp, fingerprint: clientFingerprint };
        const newAccessToken = jwt.sign(accessTokenPayload, privateKey, { algorithm: 'RS256', expiresIn: '1d' }); // Example: 1 day expiry
        return newAccessToken;
    } else if (expectedTokenType === JWT_TOKEN_TYPE_ACCESS) {
        return 0; // Success indicator for access token verification
    } else {
        throw new Error("Internal error: Unexpected token type requested for verification.");
    }
}

/**
 * Sends a confirmation email to the participant.
 * @async
 * @function sendConfirmationEmail
 * @param {string} pid - Participant ID.
 * @param {string} clientIp - Client's IP address (can be null/undefined).
 * @param {string} clientFingerprint - Client's browser fingerprint (can be null/undefined).
 * @param {string|boolean} [showcase] - Optional showcase identifier.
 * @returns {Promise<string>} Resolves with the participant's email address on success.
 * @throws {Error} If configuration is missing or sending fails.
 */
export async function sendConfirmationEmail(pid, clientIp, clientFingerprint, showcase) {
    // Check necessary configs at the start
    if (!RSA_PRIVATE_KEY_B64) throw new Error("RSA private key not configured for email sending.");
    if (!SMTP_USERNAME || !SMTP_PASSWORD) throw new Error("SMTP credentials not configured for email sending.");
    if (!TELIZE_RAPIDAPI_KEY || !TELIZE_API_HOST) throw new Error("Geolocation API Key or Host not configured for email sending.");
    if (!EMAIL_FROM || !EMAIL_REPLY_TO) throw new Error("Sender email addresses not configured for email sending.");
    if (!APP_DOMAIN) throw new Error("Application domain not configured for the current environment (for email sending).");
    if (!JWT_ISSUER) throw new Error(TOKEN_ERROR_CODES.CONFIG_ERROR + ': Missing JWT_ISSUER_NAME in environment for email sending.');

    // Find participant data internally
    const participantData = await findParticipantForAuth(pid);
    if (!participantData) {
        throw new Error("Participant not found");
    }

    const privateKey = Buffer.from(RSA_PRIVATE_KEY_B64, 'base64').toString('utf-8');
    if (!privateKey) throw new Error("Invalid API_RSA_PRIVATE key for email sending.");

    const confirmTokenPayload = { issuer: JWT_ISSUER, type: JWT_TOKEN_TYPE_CONFIRM, version: JWT_VERSION, pid: pid, ip: clientIp, fingerprint: clientFingerprint, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) }; // 24hr expiry
    const confirmationToken = jwt.sign(confirmTokenPayload, privateKey, { algorithm: 'RS256' });

    const language = participantData.writtenLangPref || 'English';
    const localPrompts = await getPromptsForAid('confirm'); // Uses shared getPromptsForAid
    const getConfirmPrompt = (promptId, lang) => {
        const found = localPrompts.find(p => p.prompt === `confirm-${promptId}` && p.language === lang);
        if (found) return found.text;
        const englishFallback = localPrompts.find(p => p.prompt === `confirm-${promptId}` && p.language === 'English');
        return englishFallback ? englishFallback.text : `confirm-${promptId}-${lang}-unknown`;
    };

    let location = 'an unknown location';
    if (clientIp) { // Only attempt geolocation if IP is available
        try {
            const geoOptions = { method: 'GET', url: `https://${TELIZE_API_HOST}/location/${clientIp}`, headers: { 'X-RapidAPI-Key': TELIZE_RAPIDAPI_KEY, 'X-RapidAPI-Host': TELIZE_API_HOST } };
            const geoResponse = await axios.request(geoOptions);
            if (geoResponse.data) location = `${geoResponse.data.city || ''}, ${geoResponse.data.region || ''} (${geoResponse.data.country || 'N/A'})`.replace(/^, |, $/g, '');
        } catch (geoError) { console.warn(`auth-logic: Could not fetch geolocation for IP ${clientIp}:`, geoError.message); }
    }

    let confirmationUrl = `${APP_DOMAIN}verify/?pid=${pid}&token=${confirmationToken}&language=${language}`;
    if (showcase) confirmationUrl += `&showcase=${encodeURIComponent(showcase)}`;

    let emailBody = getConfirmPrompt('email', language)
        .replace(/\|\|name\|\|/g, `${participantData.first} ${participantData.last}`)
        .replace(/\|\|location\|\|/g, location)
        .replace(/\|\|url\|\|/g, confirmationUrl);

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD } });
    const mailOptions = { from: EMAIL_FROM, replyTo: EMAIL_REPLY_TO, to: participantData.email, subject: getConfirmPrompt('subject', language), html: emailBody };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`auth-logic: Confirmation email sent successfully to: ${participantData.email}, Info: ${info.messageId}`);
        return participantData.email;
    } catch (emailError) {
        console.error("auth-logic: Failed to send confirmation email:", emailError);
        throw new Error(`Email sending failed: ${emailError.message}`);
    }
}

/**
 * Retrieves language permissions for a given PID.
 * @function getPermissionsLogic
 * @param {string} pid - The participant ID.
 * @returns {object} The permissions object for the PID, or a default "no permissions" object if not found.
 */
export function getPermissionsLogic(pid) {
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
 */
export function generateAuthHash(guid, secretKeyHex) {
    if (!/^[0-9a-f]{64}$/i.test(secretKeyHex)) {
        throw new Error('Secret key must be a 64-character hexadecimal string');
    }
    const secretKeyBuffer = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKeyBuffer);
    hmac.update(guid);
    return hmac.digest('hex');
}

/**
 * Checks access for a participant and URL using a hash and a secret from APP_ACCESS_JSON.
 *
 * @param {string} pid - Participant ID
 * @param {string} hash - Hash value to check
 * @param {string} url - URL of the calling app
 * @returns {Promise<object>} Empty object if authorized
 * @throws {Error} Various errors as described
 */
export async function handleCheckAccess(pid, hash, url) {
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) throw new Error('APP_ACCESS_JSON environment variable not set');
    let accessList;
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }
    console.log("accessList:", accessList, url)
    const entry = accessList.find(e => e.url === url);
    if (!entry) throw new Error('UNKNOWN_URL');
    if (entry.secret === 'none') return {};
    // Check hash
    const expectedHash = generateAuthHash(pid, entry.secret);
    if (expectedHash !== hash) throw new Error('BAD_HASH');
    // Lookup in AUTH table
    const AUTH_IDENTITY_POOL_ID = process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID;
    const tableName = getTableName('AUTH');
    const client = getDocClient(AUTH_IDENTITY_POOL_ID);
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const command = new GetCommand({ TableName: tableName, Key: { pid } });
    const data = await client.send(command);
    if (!data.Item) throw new Error('AUTH_PID_NOT_FOUND');
    const permittedUrls = data.Item['permitted-urls'] || [];
    if (!permittedUrls.includes(url)) throw new Error('AUTH_URL_NOT_FOUND');
    return {};
}
