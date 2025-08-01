// student-dashboard/pages/login/callback.tsx
import { AuthVerificationCallback } from 'sharedFrontend';
import { useRouter } from 'next/router';

const Callback: React.FC = () => {
    const router = useRouter();
    const { pid, hash, tokenid, targetWindow } = router.query;

    return (
        <AuthVerificationCallback
            pid={pid as string}
            hash={hash as string}
            tokenId={tokenid as string}
            targetWindow={targetWindow as string}
        />
    );
};

export default Callback; 