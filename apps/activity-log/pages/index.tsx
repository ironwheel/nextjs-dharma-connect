import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Container, Spinner } from 'react-bootstrap';
import { ActivityLog, VersionBadge, authGetConfigValue } from 'sharedFrontend';

/**
 * Stand-alone, read-only view of the shared activity log (docs/ACTIVITY_LOG.md) for admins who
 * troubleshoot student inquiries without access to student-manager. Access is granted per user
 * by adding this app's host to their permitted hosts; email addresses are shown only to users
 * whose auth config for this host sets emailDisplay.
 */
const Home = () => {
    const router = useRouter();
    const { pid, hash } = router.query;
    const [emailDisplay, setEmailDisplay] = useState<boolean | null>(null);

    useEffect(() => {
        if (!router.isReady || typeof pid !== 'string' || typeof hash !== 'string') return;
        let cancelled = false;
        // The first API call: an unauthenticated user is sent to /login from here.
        authGetConfigValue(pid, hash, 'emailDisplay')
            .then(value => { if (!cancelled) setEmailDisplay(value === true); })
            .catch(() => { if (!cancelled) setEmailDisplay(false); });
        return () => { cancelled = true; };
    }, [router.isReady, pid, hash]);

    if (!router.isReady) return null;

    if (typeof pid !== 'string' || typeof hash !== 'string') {
        return <div className="page-message">Open the Activity Log from your access link.</div>;
    }

    return (
        <>
            <Head>
                <title>Activity Log</title>
            </Head>
            <Container fluid="xl" className="page-container">
                <nav className="modern-navbar">
                    <div className="navbar-container">
                        <h2 className="navbar-title">Activity Log</h2>
                        <span className="status-item version-info">
                            <VersionBadge pid={pid} hash={hash} />
                        </span>
                    </div>
                </nav>

                {emailDisplay === null ? (
                    <div className="page-message">
                        <Spinner animation="border" role="status" style={{ color: '#ffc107' }} />
                    </div>
                ) : (
                    <ActivityLog pid={pid} hash={hash} emailDisplayPermission={emailDisplay} />
                )}
            </Container>
        </>
    );
};

export default Home;
