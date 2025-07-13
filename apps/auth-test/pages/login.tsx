// --- auth-test/login.tsx (Example Usage) ---
// This would be your application-specific login file.
// It imports the shared AuthVerification component.

import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

const Login: React.FC = () => {
    const router = useRouter();
    const { pid, hash } = router.query;

    return (
        // The Login component simply renders the shared AuthVerification component
        // passing the necessary props.
        <AuthVerification pid={pid as string} hash={hash as string} />
    );
};

export default Login;