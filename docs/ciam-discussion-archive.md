# CIAM Discussion Archive

This document contains the complete discussion about implementing the two-stage authentication system for nextjs-dharma-connect.

## Summary of Key Decisions

### Authentication Architecture
1. **Two-stage authentication**: PID+hash validation (Stage 1) followed by email verification (Stage 2)
2. **No refresh tokens**: Using session IDs stored in DynamoDB instead
3. **JWT access tokens**: 15-minute expiration with claims embedded
4. **Device fingerprinting**: Additional security layer for all auth operations
5. **Action-based permissions**: Permissions map directly to API action strings like 'handleFindParticipant'

### Implementation Choices
1. **Separate landing page** (`/access`) for authentication, not mixed with main app
2. **Explicit email confirmation**: Users must click "Send verification email" 
3. **Confirmation page**: Users must explicitly confirm "Yes, this is me" after clicking email link
4. **httpOnly cookies**: All tokens stored as httpOnly cookies
5. **Single session type**: With `verified` boolean flag
6. **Hierarchical claims**: identity, authorization, limits, metadata

## Critical Code Components

### Enhanced handleCheckAccess
The existing `handleCheckAccess` function is enhanced to:
- Check for existing valid sessions by PID + device fingerprint
- Return a JWT if session exists (no additional auth needed)
- Create temporary session if verification is needed
- Required deviceFingerprint parameter

### Session Structure
```javascript
{
  sessionId: UUID,
  pid: "e271aea6-031e-4a7d-8269-99ee4adae5bf",
  userId: "user-123",
  email: "user@example.com",
  verified: false/true,
  claims: {
    identity: { email, name, locale, timezone },
    authorization: { role, actions: ["handleFindParticipant", ...], organizationId },
    limits: { apiCallsRemaining, storageUsedMB },
    metadata: { lastPasswordChange, mfaEnabled }
  },
  deviceFingerprint: "abc123...",
  createdAt: timestamp,
  expiresAt: timestamp + 30 days,
  lastUsed: timestamp
}
```

### Security Flow
1. User visits: `/access?pid=xxx&hash=yyy`
2. System calls `handleCheckAccess(pid, hash, url, deviceFingerprint)`
3. If valid session exists → Return JWT → Redirect to app
4. If no session → Show email form → Send verification → Confirm identity → Create session

### Key Security Features
- PID+hash prevents unauthorized access attempts
- Device fingerprinting adds device-level security
- Explicit confirmation prevents accidental verification
- Short JWT expiration (15 min) limits exposure
- Session-based claims allow dynamic permission updates

## Implementation Order

1. **Update handleCheckAccess** to support session checking
2. **Create DynamoDB tables** with proper indexes and TTL
3. **Build /access page** for initial authentication
4. **Implement email verification** endpoints
5. **Create /confirm page** for explicit confirmation
6. **Add auth middleware** for route protection
7. **Update API routes** to check action-based permissions

## Important Notes

### Why This Approach
- **Defense in depth**: Two-stage auth stops attacks before they reach the system
- **No password management**: Reduces attack surface
- **Audit trail**: Every access attempt is logged
- **Flexibility**: Can add trusted devices, MFA, etc. later

### Trade-offs Accepted
- **Complexity**: Two-stage auth is more complex than simple login
- **Email dependency**: System requires working email delivery
- **Device changes**: Users may need to re-verify on new devices

### Future Enhancements
- Trusted device management
- Progressive security (easier auth for low-risk actions)
- Anomaly detection
- Optional MFA for sensitive operations

## Original Requirements

The system needed to:
1. Use existing PID+hash validation
2. Add email verification for identity confirmation  
3. Support 30-day sessions without passwords
4. Use JWT for stateless auth checks
5. Support dynamic permission updates
6. Work across multiple apps in monorepo

## Final Architecture Achieves

✅ Zero-knowledge initial access (just need valid link)  
✅ Strong identity verification (email confirmation)  
✅ Seamless return user experience (30-day sessions)  
✅ Granular permissions (action-based)  
✅ Dynamic authorization (claims refresh)  
✅ Comprehensive audit trail  
✅ Protection against automated attacks

## Key Insights from Discussion

1. **Session IDs vs Refresh Tokens**: We chose session IDs because we're already doing DB lookups, so refresh tokens add no value
2. **Action-based permissions**: Using actual function names like 'handleFindParticipant' creates direct mapping between code and permissions
3. **Explicit over implicit**: Requiring user confirmation at each step improves security and user awareness
4. **Landing page pattern**: Separating auth from app creates cleaner architecture and better security boundaries

## Gotchas to Avoid

1. **Don't auto-send emails**: Could be abused for spam
2. **Don't trust device fingerprints completely**: They can change with browser updates
3. **Don't skip PID validation**: It's the first line of defense
4. **Don't make JWTs long-lived**: 15 minutes maximum
5. **Don't store sensitive data in JWTs**: They're visible in browser tools

## Questions Resolved

1. **Q: Should we use refresh tokens?**  
   A: No, session IDs are sufficient since we're already using a database

2. **Q: How do returning users authenticate?**  
   A: handleCheckAccess checks for existing sessions and returns JWT directly

3. **Q: Should auth logic be in main app or separate page?**  
   A: Separate /access page for clean separation of concerns

4. **Q: What about bookmark handling?**  
   A: Main app redirects to /access if no valid auth

5. **Q: How are permissions structured?**  
   A: As arrays of action strings that map to API functions

## References in Discussion

- JWT best practices
- httpOnly cookie security
- CSRF/CORS protection
- DynamoDB TTL for automatic cleanup
- Device fingerprinting limitations
- Rate limiting strategies
- Email delivery considerations

This architecture provides a robust, secure, and user-friendly authentication system that leverages existing PID infrastructure while adding modern session management and fine-grained authorization.