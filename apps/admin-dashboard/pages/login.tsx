// --- admin-dashboard/login.tsx ---
// This is the application-specific login file for admin-dashboard.
// It imports the shared AuthVerification component.

import React from 'react';
import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

const Login: React.FC = () => {
    const router = useRouter();
    const { pid, hash } = router.query;

    return (
        <AuthVerification pid={pid as string} hash={hash as string} />
    );
};

export default Login; 