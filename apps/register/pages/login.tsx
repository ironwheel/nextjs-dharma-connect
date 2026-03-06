// --- register/login.tsx ---
// Application-specific login page; uses shared AuthVerification.

import React from 'react';
import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

function Login(): React.ReactElement {
    const router = useRouter();
    const { pid, hash, eventCode } = router.query;

    return (
        <AuthVerification pid={pid as string} hash={hash as string} eventCode={eventCode as string} />
    );
}

export default Login;

