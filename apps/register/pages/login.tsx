// --- register/login.tsx ---
// Application-specific login page; uses shared AuthVerification.

import React from 'react';
import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

function Login() {
    const router = useRouter();
    const { pid, hash, eventCode } = router.query;

    return (
        <AuthVerification pid={pid as string} hash={hash as string} eventCode={eventCode as string} />
    );
}

// Type assertion for Next.js PagesPageConfig (React 19 / Next 16 type mismatch with ReactNode)
export default Login as React.ComponentType;

