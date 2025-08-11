/**
 * @file apps/auth-test/pages/login.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description The login page for the auth-test application.
 */

import { AuthVerification } from 'sharedFrontend';
import { useRouter } from 'next/router';

/**
 * @component Login
 * @description The login page for the auth-test application.
 * @returns {React.FC} The Login component.
 */
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