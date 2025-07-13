// --- email-manager/login.tsx (Example Usage) ---
// This would be your application-specific login file.
// It imports the shared AuthVerification component.

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