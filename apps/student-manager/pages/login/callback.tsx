// student-manager/pages/login/callback.tsx
import React, { useState, useEffect } from 'react';
import { AuthVerificationCallback } from 'sharedFrontend';
import { useRouter } from 'next/router';

const Callback: React.FC = () => {
    const router = useRouter();
    const [params, setParams] = useState({
        pid: null as string | null,
        hash: null as string | null,
        tokenId: null as string | null,
        targetWindow: null as string | null
    });

    useEffect(() => {
        if (router.isReady) {
            const { pid, hash, tokenid, targetWindow } = router.query;
            console.log('Callback page router.query:', router.query);
            console.log('Callback page extracted params:', { pid, hash, tokenid, targetWindow });
            console.log('Callback page window.location:', typeof window !== 'undefined' ? window.location.href : 'server-side');
            console.log('Callback page window.name:', typeof window !== 'undefined' ? window.name : 'server-side');
            console.log('Extracted pid:', pid, 'type:', typeof pid);
            console.log('Extracted hash:', hash, 'type:', typeof hash);
            console.log('Extracted tokenid:', tokenid, 'type:', typeof tokenid);
            console.log('Extracted targetWindow:', targetWindow, 'type:', typeof targetWindow);

            const newParams = {
                pid: pid as string,
                hash: hash as string,
                tokenId: tokenid as string,
                targetWindow: targetWindow as string
            };
            console.log('Setting params to:', newParams);
            setParams(newParams);
        }
    }, [router.isReady, router.query]);

    // Log when params state changes
    useEffect(() => {
        console.log('Params state changed to:', params);
    }, [params]);

    // Don't render until router is ready
    if (!router.isReady) {
        return <div>Loading...</div>;
    }

    // Extract parameters directly from router for immediate use
    const { pid, hash, tokenid, targetWindow } = router.query;
    const directParams = {
        pid: pid as string,
        hash: hash as string,
        tokenId: tokenid as string,
        targetWindow: targetWindow as string
    };

    console.log('Direct params for component:', directParams);

    return (
        // The Callback component simply renders the shared AuthVerificationCallback component
        // passing the necessary props from URL parameters.
        <AuthVerificationCallback
            pid={directParams.pid}
            hash={directParams.hash}
            tokenId={directParams.tokenId}
            targetWindow={directParams.targetWindow}
        />
    );
};

export default Callback; 