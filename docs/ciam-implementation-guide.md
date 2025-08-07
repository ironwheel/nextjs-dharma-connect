# CIAM Implementation Guide

This guide provides step-by-step implementation instructions for the two-stage authentication system described in auth-and-session-architecture.md.

## Prerequisites

- Next.js application configured
- AWS DynamoDB access configured
- Email service (AWS SES or similar) configured
- Environment variables set up

## Step 1: Environment Configuration

```env
# JWT Secrets
JWT_SECRET=your-jwt-secret-at-least-32-chars
TEMP_TOKEN_SECRET=your-temp-token-secret-at-least-32-chars

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_COGNITO_AUTH_IDENTITY_POOL_ID=your-identity-pool-id

# DynamoDB Tables
VERIFICATION_TOKENS_TABLE=nextjs-dharma-verification-tokens
SESSIONS_TABLE=nextjs-dharma-sessions
AUTH_TABLE=nextjs-dharma-auth

# App Configuration
APP_ACCESS_JSON=[{"url":"https://app.dharma-connect.com","secret":"64-char-hex-secret"}]
FRONTEND_URL=https://app.dharma-connect.com

# Email
EMAIL_FROM=noreply@dharma-connect.com
```

## Step 2: DynamoDB Table Setup

### Sessions Table

```javascript
const sessionsTable = {
  TableName: 'nextjs-dharma-sessions',
  KeySchema: [
    { AttributeName: 'sessionId', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'sessionId', AttributeType: 'S' },
    { AttributeName: 'pid', AttributeType: 'S' },
    { AttributeName: 'deviceFingerprint', AttributeType: 'S' },
    { AttributeName: 'userId', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'PidDeviceIndex',
      KeySchema: [
        { AttributeName: 'pid', KeyType: 'HASH' },
        { AttributeName: 'deviceFingerprint', KeyType: 'RANGE' }
      ],
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
      IndexName: 'UserIdIndex',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' }
      ],
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
  ],
  TimeToLiveSpecification: {
    AttributeName: 'expiresAt',
    Enabled: true
  },
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
};
```

### VerificationTokens Table

```javascript
const verificationTokensTable = {
  TableName: 'nextjs-dharma-verification-tokens',
  KeySchema: [
    { AttributeName: 'token', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'token', AttributeType: 'S' },
    { AttributeName: 'pid', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'PidIndex',
      KeySchema: [
        { AttributeName: 'pid', KeyType: 'HASH' }
      ],
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
  ],
  TimeToLiveSpecification: {
    AttributeName: 'expiresAt',
    Enabled: true
  },
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
};
```

## Step 3: Enhanced handleCheckAccess Implementation

```javascript
// utils/auth/handleCheckAccess.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { dynamodb } from '../aws/dynamodb';

export function generateAuthHash(guid, secretKeyHex) {
    if (!/^[0-9a-f]{64}$/i.test(secretKeyHex)) {
        throw new Error('Secret key must be a 64-character hexadecimal string');
    }
    const secretKeyBuffer = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKeyBuffer);
    hmac.update(guid);
    return hmac.digest('hex');
}

export async function handleCheckAccess(pid, hash, url, deviceFingerprint) {
    // Validate inputs
    if (!pid || !hash || !url || !deviceFingerprint) {
        throw new Error('Missing required parameters');
    }
    
    // Parse and validate APP_ACCESS_JSON
    const accessJson = process.env.APP_ACCESS_JSON;
    if (!accessJson) throw new Error('APP_ACCESS_JSON environment variable not set');
    
    let accessList;
    try {
        accessList = JSON.parse(accessJson);
    } catch (e) {
        throw new Error('APP_ACCESS_JSON is not valid JSON');
    }
    
    // Find URL configuration
    const entry = accessList.find(e => e.url === url);
    if (!entry) throw new Error('UNKNOWN_URL');
    
    if (entry.secret === 'none') {
        // No authentication required for this URL
        return { status: 'no-auth-required' };
    }
    
    // Verify hash
    const expectedHash = generateAuthHash(pid, entry.secret);
    if (expectedHash !== hash) throw new Error('BAD_HASH');
    
    // Lookup in AUTH table
    const AUTH_IDENTITY_POOL_ID = process.env.AWS_COGNITO_AUTH_IDENTITY_POOL_ID;
    if (!AUTH_IDENTITY_POOL_ID) {
        throw new Error('Server configuration error: Missing AWS_COGNITO_AUTH_IDENTITY_POOL_ID.');
    }
    
    const tableName = getTableName('AUTH');
    const client = getDocClient(AUTH_IDENTITY_POOL_ID);
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    
    const command = new GetCommand({ 
        TableName: tableName, 
        Key: { id: pid } 
    });
    
    const data = await client.send(command);
    if (!data.Item) throw new Error('AUTH_PID_NOT_FOUND');
    
    const permittedUrls = data.Item['permitted-urls'] || [];
    if (!permittedUrls.includes(url)) throw new Error('AUTH_URL_NOT_FOUND');
    
    // Check for existing verified session
    const { Items: sessions } = await dynamodb.query({
        TableName: process.env.SESSIONS_TABLE,
        IndexName: 'PidDeviceIndex',
        KeyConditionExpression: 'pid = :pid AND deviceFingerprint = :device',
        FilterExpression: 'verified = :true AND expiresAt > :now',
        ExpressionAttributeValues: {
            ':pid': pid,
            ':device': deviceFingerprint,
            ':true': true,
            ':now': Date.now()
        }
    }).promise();
    
    if (sessions && sessions.length > 0) {
        const session = sessions[0];
        
        // Generate fresh 15-minute JWT
        const accessToken = jwt.sign({
            // Identity
            userId: session.userId,
            pid: session.pid,
            email: session.email,
            
            // Authorization
            role: session.claims.authorization.role,
            actions: session.claims.authorization.actions,
            organizationId: session.claims.authorization.organizationId,
            
            // Session reference
            sessionId: session.sessionId,
            
            // Security metadata
            deviceFingerprint: deviceFingerprint,
            issuedAt: Date.now()
        }, process.env.JWT_SECRET, { 
            expiresIn: '15m',
            issuer: 'dharma-connect',
            audience: url
        });
        
        // Update session last used
        await dynamodb.update({
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId: session.sessionId },
            UpdateExpression: 'SET lastUsed = :now',
            ExpressionAttributeValues: { ':now': Date.now() }
        }).promise();
        
        return {
            status: 'authenticated',
            accessToken: accessToken,
            expiresIn: 900 // 15 minutes
        };
    }
    
    // No existing session - create temporary session
    const linkSessionId = crypto.randomUUID();
    
    await dynamodb.put({
        TableName: process.env.SESSIONS_TABLE,
        Item: {
            sessionId: linkSessionId,
            pid: pid,
            email: data.Item.email || null,
            verified: false,
            linkVerified: true,
            deviceFingerprint: deviceFingerprint,
            claims: {
                identity: {
                    pid: pid,
                    email: data.Item.email || null,
                    name: data.Item.name || null
                },
                authorization: {
                    role: 'link-holder',
                    actions: [
                        'handleRequestLogin',
                        'handleVerifyEmail',
                        'handleGetTranslations',
                        'handleGetPublicConfig'
                    ]
                }
            },
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000 // 1 hour for temp sessions
        }
    }).promise();
    
    // Generate limited JWT for auth flow
    const tempToken = jwt.sign({
        pid: pid,
        email: data.Item.email || null,
        purpose: 'auth-flow',
        actions: ['handleRequestLogin', 'handleGetTranslations'],
        linkSessionId: linkSessionId,
        deviceFingerprint: deviceFingerprint
    }, process.env.TEMP_TOKEN_SECRET, { 
        expiresIn: '30m' 
    });
    
    return {
        status: 'needs-verification',
        tempToken: tempToken,
        email: data.Item.email || null
    };
}
```

## Step 4: Frontend Access Page

```javascript
// pages/access.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getDeviceFingerprint } from '../utils/device-fingerprint';

export default function AccessPage() {
    const router = useRouter();
    const { pid, hash } = router.query;
    const [status, setStatus] = useState('checking');
    const [email, setEmail] = useState('');
    const [emailSent, setEmailSent] = useState(false);
    
    useEffect(() => {
        if (pid && hash) {
            checkAccess();
        } else {
            setStatus('missing-params');
        }
    }, [pid, hash]);
    
    async function checkAccess() {
        try {
            const deviceFingerprint = await getDeviceFingerprint();
            
            const response = await fetch('/api/auth/check-access', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': deviceFingerprint
                },
                body: JSON.stringify({
                    pid,
                    hash,
                    url: window.location.origin,
                    deviceFingerprint
                }),
                credentials: 'include'
            });
            
            const result = await response.json();
            
            if (result.status === 'authenticated') {
                // Set auth cookie and redirect
                await fetch('/api/auth/set-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        accessToken: result.accessToken,
                        expiresIn: result.expiresIn 
                    }),
                    credentials: 'include'
                });
                
                router.push('/dashboard');
            } else if (result.status === 'needs-verification') {
                setEmail(result.email || '');
                setStatus('request-email');
            }
        } catch (error) {
            console.error('Access check failed:', error);
            setStatus('error');
        }
    }
    
    async function handleRequestEmail(e) {
        e.preventDefault();
        setStatus('sending');
        
        try {
            const response = await fetch('/api/auth/request-login', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': await getDeviceFingerprint()
                },
                body: JSON.stringify({ email, pid }),
                credentials: 'include'
            });
            
            if (response.ok) {
                setEmailSent(true);
                setStatus('email-sent');
            } else {
                setStatus('email-error');
            }
        } catch (error) {
            setStatus('email-error');
        }
    }
    
    // Render different states
    if (status === 'checking') {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="spinner"></div>
                    <p className="mt-4">Validating access...</p>
                </div>
            </div>
        );
    }
    
    if (status === 'missing-params') {
        return (
            <div className="error-container">
                <h1>Invalid Access Link</h1>
                <p>The access link appears to be incomplete or invalid.</p>
                <p>Please use the complete link provided by your administrator.</p>
            </div>
        );
    }
    
    if (status === 'request-email' && !emailSent) {
        return (
            <div className="auth-container">
                <h1>Welcome to Dharma Connect</h1>
                <p>Your access link is valid. Please verify your email to continue.</p>
                
                <form onSubmit={handleRequestEmail} className="mt-6">
                    <label htmlFor="email" className="block text-sm font-medium">
                        Email Address
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        required
                        className="mt-1 block w-full rounded-md border-gray-300"
                    />
                    
                    <button 
                        type="submit" 
                        disabled={status === 'sending'}
                        className="mt-4 w-full btn-primary"
                    >
                        {status === 'sending' ? 'Sending...' : 'Send Verification Email'}
                    </button>
                </form>
            </div>
        );
    }
    
    if (status === 'email-sent') {
        return (
            <div className="auth-container">
                <h1>Check Your Email</h1>
                <p>We've sent a verification link to:</p>
                <p className="font-bold text-lg mt-2">{email}</p>
                
                <div className="mt-6 p-4 bg-blue-50 rounded-md">
                    <p className="text-sm">
                        Click the link in the email to verify your identity and access your account.
                    </p>
                    <p className="text-sm mt-2">
                        The link will expire in 15 minutes.
                    </p>
                </div>
                
                <button 
                    onClick={() => setEmailSent(false)}
                    className="mt-6 text-sm text-blue-600 hover:text-blue-800"
                >
                    Didn't receive the email? Try again
                </button>
            </div>
        );
    }
    
    if (status === 'error') {
        return (
            <div className="error-container">
                <h1>Access Error</h1>
                <p>We encountered an error validating your access.</p>
                <p>Please check your link or contact support.</p>
            </div>
        );
    }
}
```

## Step 5: Email Verification Endpoints

### Request Login

```javascript
// pages/api/auth/request-login.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { dynamodb } from '../../../utils/aws/dynamodb';
import { sendVerificationEmail } from '../../../utils/email';
import { rateLimiter } from '../../../utils/rate-limit';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { email, pid } = req.body;
    const deviceFingerprint = req.headers['x-device-fingerprint'];
    const tempToken = req.cookies.tempAuthToken;
    
    if (!email || !pid || !deviceFingerprint) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify temp token
    let linkSession;
    try {
        const decoded = jwt.verify(tempToken, process.env.TEMP_TOKEN_SECRET);
        if (decoded.pid !== pid || decoded.purpose !== 'auth-flow') {
            throw new Error('Invalid temp token');
        }
        linkSession = decoded;
    } catch (error) {
        return res.status(403).json({ error: 'Invalid session' });
    }
    
    // Rate limiting
    const rateLimitKey = `email:${email}:${req.headers['x-forwarded-for'] || req.connection.remoteAddress}`;
    const allowed = await rateLimiter.check(rateLimitKey, 3, 3600); // 3 per hour
    
    if (!allowed) {
        return res.status(429).json({ 
            error: 'Too many attempts',
            retryAfter: 3600 
        });
    }
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Store verification token
    await dynamodb.put({
        TableName: process.env.VERIFICATION_TOKENS_TABLE,
        Item: {
            token: verificationToken,
            pid: pid,
            email: email,
            deviceFingerprint: deviceFingerprint,
            linkSessionId: linkSession.linkSessionId,
            
            requestContext: {
                ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                userAgent: req.headers['user-agent'],
                timestamp: Date.now()
            },
            
            postVerificationAction: {
                redirectTo: '/dashboard',
                createSessionFor: {
                    pid: pid,
                    email: email
                }
            },
            
            createdAt: Date.now(),
            expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
            used: false,
            attempts: 0
        }
    }).promise();
    
    // Send verification email
    const verifyUrl = `${process.env.FRONTEND_URL}/confirm?token=${verificationToken}`;
    await sendVerificationEmail(email, verifyUrl, {
        ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
}
```

### Confirmation Page

```javascript
// pages/confirm.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getDeviceFingerprint } from '../utils/device-fingerprint';

export default function ConfirmPage() {
    const router = useRouter();
    const { token } = router.query;
    const [status, setStatus] = useState('loading');
    const [verificationData, setVerificationData] = useState(null);
    const [deviceMatch, setDeviceMatch] = useState(true);
    
    useEffect(() => {
        if (token) {
            validateToken();
        }
    }, [token]);
    
    async function validateToken() {
        try {
            const response = await fetch('/api/auth/validate-token', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': await getDeviceFingerprint()
                },
                body: JSON.stringify({ token }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.valid) {
                setVerificationData(data);
                setDeviceMatch(data.deviceMatch);
                setStatus('ready-to-confirm');
            } else {
                setStatus(data.reason || 'invalid');
            }
        } catch (error) {
            setStatus('error');
        }
    }
    
    async function handleConfirm() {
        setStatus('confirming');
        
        try {
            const response = await fetch('/api/auth/complete-verification', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': await getDeviceFingerprint()
                },
                body: JSON.stringify({ 
                    token,
                    confirmed: true 
                }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                setStatus('success');
                setTimeout(() => {
                    router.push(data.redirectTo || '/dashboard');
                }, 1500);
            } else {
                setStatus('confirm-error');
            }
        } catch (error) {
            setStatus('confirm-error');
        }
    }
    
    // Render states
    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="spinner"></div>
                    <p className="mt-4">Validating verification link...</p>
                </div>
            </div>
        );
    }
    
    if (status === 'ready-to-confirm') {
        return (
            <div className="confirm-container max-w-md mx-auto mt-20 p-6">
                <h1 className="text-2xl font-bold mb-4">Confirm Your Identity</h1>
                
                <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm mb-2">You are about to verify access for:</p>
                    <div className="mt-3">
                        <p><strong>Email:</strong> {verificationData.email}</p>
                        <p><strong>Access Level:</strong> {verificationData.accessLevel}</p>
                    </div>
                    
                    {!deviceMatch && (
                        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                            <p className="text-sm text-yellow-800">
                                ⚠️ You're verifying from a different device than the one that requested access
                            </p>
                        </div>
                    )}
                </div>
                
                <div className="space-y-3">
                    <button 
                        onClick={handleConfirm}
                        disabled={status === 'confirming'}
                        className="w-full py-3 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {status === 'confirming' ? 'Confirming...' : 'Yes, This Is Me - Grant Access'}
                    </button>
                    
                    <button 
                        onClick={() => router.push('/')}
                        className="w-full py-3 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
                    >
                        Cancel
                    </button>
                </div>
                
                <p className="text-xs text-gray-500 mt-6">
                    This verification link expires in 15 minutes and can only be used once.
                </p>
            </div>
        );
    }
    
    if (status === 'success') {
        return (
            <div className="success-container max-w-md mx-auto mt-20 p-6 text-center">
                <div className="text-green-600 text-5xl mb-4">✓</div>
                <h1 className="text-2xl font-bold mb-2">Verification Successful</h1>
                <p>You've been verified. Redirecting to your dashboard...</p>
            </div>
        );
    }
    
    if (status === 'expired') {
        return (
            <div className="error-container max-w-md mx-auto mt-20 p-6 text-center">
                <h1 className="text-2xl font-bold mb-4 text-red-600">Link Expired</h1>
                <p className="mb-6">This verification link has expired. Please request a new one.</p>
                <button 
                    onClick={() => router.push('/access')}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                    Back to Login
                </button>
            </div>
        );
    }
    
    if (status === 'already-used') {
        return (
            <div className="error-container max-w-md mx-auto mt-20 p-6 text-center">
                <h1 className="text-2xl font-bold mb-4 text-red-600">Link Already Used</h1>
                <p className="mb-6">This verification link has already been used.</p>
                <button 
                    onClick={() => router.push('/dashboard')}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                    Go to Dashboard
                </button>
            </div>
        );
    }
    
    return (
        <div className="error-container max-w-md mx-auto mt-20 p-6 text-center">
            <h1 className="text-2xl font-bold mb-4 text-red-600">Verification Error</h1>
            <p>We encountered an error with your verification link.</p>
            <p className="mt-4">
                <a href="/access" className="text-blue-600 hover:underline">
                    Try logging in again
                </a>
            </p>
        </div>
    );
}
```

### Complete Verification

```javascript
// pages/api/auth/complete-verification.js
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { dynamodb } from '../../../utils/aws/dynamodb';
import { buildUserClaims } from '../../../utils/auth/claims';
import cookie from 'cookie';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { token, confirmed } = req.body;
    const deviceFingerprint = req.headers['x-device-fingerprint'];
    
    if (!token || !confirmed || !deviceFingerprint) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get verification token
    const result = await dynamodb.get({
        TableName: process.env.VERIFICATION_TOKENS_TABLE,
        Key: { token }
    }).promise();
    
    if (!result.Item) {
        return res.status(404).json({ error: 'Invalid token' });
    }
    
    const tokenData = result.Item;
    
    // Validate token
    if (tokenData.used) {
        return res.status(400).json({ error: 'Token already used' });
    }
    
    if (tokenData.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Token expired' });
    }
    
    if (tokenData.attempts >= 3) {
        return res.status(429).json({ error: 'Too many attempts' });
    }
    
    // Device fingerprint warning (but don't block)
    const deviceMatch = tokenData.deviceFingerprint === deviceFingerprint;
    
    // Mark token as used
    await dynamodb.update({
        TableName: process.env.VERIFICATION_TOKENS_TABLE,
        Key: { token },
        UpdateExpression: 'SET used = :true, usedAt = :now, usedByDevice = :device',
        ExpressionAttributeValues: {
            ':true': true,
            ':now': Date.now(),
            ':device': deviceFingerprint
        }
    }).promise();
    
    // Get user data
    const userData = await getUserByEmail(tokenData.email);
    if (!userData) {
        // Create new user if needed
        userData = await createUser({
            email: tokenData.email,
            pid: tokenData.pid
        });
    }
    
    // Build claims
    const claims = await buildUserClaims(userData, tokenData.pid);
    
    // Create verified session
    const sessionId = crypto.randomUUID();
    
    await dynamodb.put({
        TableName: process.env.SESSIONS_TABLE,
        Item: {
            sessionId,
            pid: tokenData.pid,
            userId: userData.id,
            email: tokenData.email,
            verified: true,
            linkVerified: true,
            
            claims: claims,
            
            deviceFingerprint: deviceFingerprint,
            originalRequestDevice: tokenData.deviceFingerprint,
            deviceMatch: deviceMatch,
            verificationTokenUsed: token,
            
            createdAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
            lastUsed: Date.now(),
            lastClaimsRefresh: Date.now()
        }
    }).promise();
    
    // Generate access token
    const accessToken = jwt.sign({
        userId: userData.id,
        pid: tokenData.pid,
        email: tokenData.email,
        role: claims.authorization.role,
        actions: claims.authorization.actions,
        sessionId: sessionId
    }, process.env.JWT_SECRET, { 
        expiresIn: '15m',
        issuer: 'dharma-connect'
    });
    
    // Set cookies
    res.setHeader('Set-Cookie', [
        cookie.serialize('sessionId', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24,
            path: '/'
        }),
        cookie.serialize('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 15,
            path: '/'
        })
    ]);
    
    // Log authentication event
    await logAuthEvent({
        type: 'verification_completed',
        pid: tokenData.pid,
        email: tokenData.email,
        sessionId: sessionId,
        deviceMatch: deviceMatch,
        ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
    
    res.json({
        success: true,
        redirectTo: tokenData.postVerificationAction.redirectTo || '/dashboard'
    });
}
```

## Step 6: Auth Middleware

```javascript
// middleware/auth.js
import jwt from 'jsonwebtoken';
import { dynamodb } from '../utils/aws/dynamodb';
import cookie from 'cookie';

export function withAuth(handler, options = {}) {
    return async (req, res) => {
        const { routeType = 'protected' } = options;
        
        // Public routes - no auth needed
        if (routeType === 'public') {
            return handler(req, res);
        }
        
        const cookies = cookie.parse(req.headers.cookie || '');
        
        // Auth flow routes - allow temp token
        if (routeType === 'auth-flow') {
            const tempToken = cookies.tempAuthToken;
            if (tempToken) {
                try {
                    const decoded = jwt.verify(tempToken, process.env.TEMP_TOKEN_SECRET);
                    if (decoded.purpose === 'auth-flow' && decoded.validUntil > Date.now()) {
                        req.tempAuth = decoded;
                        return handler(req, res);
                    }
                } catch (error) {
                    // Continue to check for full auth
                }
            }
        }
        
        // Protected routes - require full auth
        const accessToken = cookies.accessToken;
        const sessionId = cookies.sessionId;
        
        if (!accessToken) {
            return res.status(401).json({ error: 'No access token' });
        }
        
        try {
            // Verify JWT
            const decoded = jwt.verify(accessToken, process.env.JWT_SECRET, {
                issuer: 'dharma-connect'
            });
            
            req.user = decoded;
            return handler(req, res);
            
        } catch (error) {
            if (error.name === 'TokenExpiredError' && sessionId) {
                // Try to refresh using session
                try {
                    const newAuth = await refreshAccessToken(sessionId, res);
                    if (newAuth) {
                        req.user = newAuth;
                        return handler(req, res);
                    }
                } catch (refreshError) {
                    return res.status(401).json({ error: 'Failed to refresh token' });
                }
            }
            
            return res.status(401).json({ error: 'Invalid token' });
        }
    };
}

async function refreshAccessToken(sessionId, res) {
    const result = await dynamodb.get({
        TableName: process.env.SESSIONS_TABLE,
        Key: { sessionId }
    }).promise();
    
    if (!result.Item || !result.Item.verified || result.Item.expiresAt < Date.now()) {
        throw new Error('Invalid or expired session');
    }
    
    const session = result.Item;
    
    // Check if claims need refresh (every hour)
    if (Date.now() - session.lastClaimsRefresh > 3600000) {
        const updatedClaims = await refreshUserClaims(session.userId, session.pid);
        
        await dynamodb.update({
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET claims = :claims, lastClaimsRefresh = :now, lastUsed = :now',
            ExpressionAttributeValues: {
                ':claims': updatedClaims,
                ':now': Date.now()
            }
        }).promise();
        
        session.claims = updatedClaims;
    } else {
        // Just update last used
        await dynamodb.update({
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET lastUsed = :now',
            ExpressionAttributeValues: { ':now': Date.now() }
        }).promise();
    }
    
    // Generate new access token
    const accessToken = jwt.sign({
        userId: session.userId,
        pid: session.pid,
        email: session.email,
        role: session.claims.authorization.role,
        actions: session.claims.authorization.actions,
        sessionId: sessionId
    }, process.env.JWT_SECRET, { 
        expiresIn: '15m',
        issuer: 'dharma-connect'
    });
    
    // Set new access token cookie
    res.setHeader('Set-Cookie', cookie.serialize('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 15,
        path: '/'
    }));
    
    return jwt.decode(accessToken);
}
```

## Step 7: API Route Protection

```javascript
// pages/api/db.js
import { withAuth } from '../../middleware/auth';

export default withAuth(async function handler(req, res) {
    const { action, params } = req.body;
    const userActions = req.user.actions || [];
    
    // Check if user has permission for this action
    if (!userActions.includes(action)) {
        return res.status(403).json({ 
            error: 'Forbidden',
            message: `Action '${action}' not permitted`
        });
    }
    
    // Check action-specific constraints
    const constraints = req.user.actionConstraints?.[action];
    if (constraints) {
        const validationError = validateActionParams(action, params, constraints);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }
    }
    
    // Execute the action
    try {
        const result = await executeAction(action, params, req.user);
        res.json(result);
    } catch (error) {
        console.error(`Error executing ${action}:`, error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}, { routeType: 'protected' });

async function executeAction(action, params, user) {
    switch (action) {
        case 'handleFindParticipant':
            return await handleFindParticipant(params, user);
            
        case 'handleScanTable':
            return await handleScanTable(params, user);
            
        case 'handleCheckAccess':
            return await handleCheckAccess(params, user);
            
        case 'handleCreateDocument':
            return await handleCreateDocument(params, user);
            
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
```

## Step 8: Client-Side Setup

### Device Fingerprinting

```javascript
// utils/device-fingerprint.js
import FingerprintJS from '@fingerprintjs/fingerprintjs';

let fpPromise = null;

export async function getDeviceFingerprint() {
    if (!fpPromise) {
        fpPromise = FingerprintJS.load();
    }
    
    const fp = await fpPromise;
    const result = await fp.get();
    
    return result.visitorId;
}
```

### API Client

```javascript
// utils/api-client.js
import { getDeviceFingerprint } from './device-fingerprint';

export async function callDbApi(action, params = {}) {
    const deviceFingerprint = await getDeviceFingerprint();
    
    const response = await fetch('/api/db', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Device-Fingerprint': deviceFingerprint
        },
        credentials: 'include',
        body: JSON.stringify({ action, params })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Failed to execute ${action}`);
    }
    
    return response.json();
}
```

## Step 9: Email Templates

```javascript
// utils/email/templates.js
export function getVerificationEmailTemplate(verifyUrl, context) {
    return {
        subject: 'Verify Your Identity - Dharma Connect',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
                    .content { padding: 30px 20px; }
                    .button { 
                        display: inline-block; 
                        padding: 12px 30px; 
                        background-color: #007bff; 
                        color: white; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        margin: 20px 0;
                    }
                    .details { 
                        background-color: #f8f9fa; 
                        padding: 15px; 
                        border-radius: 5px; 
                        margin: 20px 0;
                    }
                    .footer { 
                        margin-top: 30px; 
                        padding-top: 20px; 
                        border-top: 1px solid #ddd; 
                        font-size: 12px; 
                        color: #666;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Dharma Connect</h2>
                    </div>
                    <div class="content">
                        <h3>Verify Your Identity</h3>
                        <p>Someone requested access to your Dharma Connect account.</p>
                        
                        <div class="details">
                            <p><strong>Request Details:</strong></p>
                            <p>Time: ${context.timestamp}</p>
                            <p>IP Address: ${context.ipAddress}</p>
                            <p>Device: ${context.userAgent}</p>
                        </div>
                        
                        <p>If this was you, click the button below to confirm your identity:</p>
                        
                        <div style="text-align: center;">
                            <a href="${verifyUrl}" class="button">Verify My Identity</a>
                        </div>
                        
                        <p>Or copy and paste this link into your browser:</p>
                        <p style="word-break: break-all; font-size: 12px;">${verifyUrl}</p>
                        
                        <div class="footer">
                            <p>This link expires in 15 minutes and can only be used once.</p>
                            <p>If you didn't request this, you can safely ignore this email.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
            Verify Your Identity - Dharma Connect
            
            Someone requested access to your Dharma Connect account.
            
            Request Details:
            Time: ${context.timestamp}
            IP Address: ${context.ipAddress}
            Device: ${context.userAgent}
            
            If this was you, visit this link to confirm your identity:
            ${verifyUrl}
            
            This link expires in 15 minutes and can only be used once.
            If you didn't request this, you can safely ignore this email.
        `
    };
}
```

## Testing Checklist

- [ ] Create DynamoDB tables with proper indexes and TTL
- [ ] Set up environment variables
- [ ] Test handleCheckAccess with valid/invalid PIDs and hashes
- [ ] Test device fingerprinting across browsers
- [ ] Test email delivery and formatting
- [ ] Test verification flow with correct/incorrect devices
- [ ] Test session expiration and refresh
- [ ] Test rate limiting
- [ ] Test error states and edge cases
- [ ] Test CORS/CSRF protection
- [ ] Load test the authentication flow

## Security Considerations

1. **Always validate PID+hash first** - Never skip this step
2. **Rate limit aggressively** - Prevent brute force attempts
3. **Log all auth events** - For security auditing
4. **Use short JWT expiration** - 15 minutes maximum
5. **Implement device trust** - Track known devices per user
6. **Monitor for anomalies** - Unusual login patterns
7. **Secure email links** - Use HTTPS, short expiration
8. **Handle edge cases** - Device changes, clock skew, etc.

## Troubleshooting

### Common Issues

1. **"BAD_HASH" errors**
   - Verify APP_ACCESS_JSON format
   - Check secret key is 64-char hex
   - Ensure PID hasn't been modified

2. **Device fingerprint mismatches**
   - Expected with browser updates
   - Consider grace period for known users
   - Log but don't always block

3. **Email delivery issues**
   - Check AWS SES configuration
   - Verify sender domain
   - Monitor bounce/complaint rates

4. **Token expiration errors**
   - Check server time sync
   - Adjust TTL if needed
   - Clear expired tokens regularly

5. **Session not found**
   - Check DynamoDB indexes
   - Verify TTL configuration
   - Monitor table capacity