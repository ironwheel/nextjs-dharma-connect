// --- register/login.tsx ---
// Application-specific login page; uses shared AuthVerification.

import React from 'react';
import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

// Cast for React 19 JSX compatibility (sharedFrontend uses React 18 FC types)
const Auth = AuthVerification as React.ComponentType<{ pid: string; hash: string; eventCode: string }>;

function Login() {
    const router = useRouter();
    const { pid, hash, eventCode } = router.query;

    return (
        <Auth pid={pid as string} hash={hash as string} eventCode={eventCode as string} />
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Next.js PagesPageConfig conflicts with React 19 types
export default Login as any;

