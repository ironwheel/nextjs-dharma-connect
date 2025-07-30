// packages/api/pages/login/callback.tsx
import { AuthVerificationCallback } from 'sharedFrontend';
import { useRouter } from 'next/router';

const Callback: React.FC = () => {
    const router = useRouter();
    const { pid, hash, tokenid, targetWindow } = router.query;

    return (
        // The Callback component simply renders the shared AuthVerificationCallback component
        // passing the necessary props from URL parameters.
        <AuthVerificationCallback
            pid={pid as string}
            hash={hash as string}
            tokenId={tokenid as string}
            targetWindow={targetWindow as string}
        />
    );
};

export default Callback;