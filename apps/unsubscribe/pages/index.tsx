/**
 * @file apps/unsubscribe/pages/index.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Email unsubscribe page, reached from the footer link in every event email
 * (?pid=<participant id>). Confirms before unsubscribing, and lets an unsubscribed participant
 * re-subscribe with the same link.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getUnsubscribeStatus, setUnsubscribe, UnsubscribeStatus } from 'sharedFrontend';
import Contact from '../components/Contact';

type View = 'loading' | 'no-pid' | 'not-found' | 'ready' | 'error';

function isRedirect(value: unknown): value is { redirected: true } {
    return !!value && typeof value === 'object' && 'redirected' in value;
}

function formatDate(ts?: string): string | undefined {
    if (!ts) return undefined;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? undefined : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function Home() {
    const router = useRouter();
    const [view, setView] = useState<View>('loading');
    const [pid, setPid] = useState('');
    const [status, setStatus] = useState<UnsubscribeStatus | null>(null);
    /** Set after the participant acts on this page, so the result is acknowledged. */
    const [justChanged, setJustChanged] = useState(false);
    const [working, setWorking] = useState(false);
    const [actionError, setActionError] = useState('');

    useEffect(() => {
        if (!router.isReady) return;
        const queryPid = typeof router.query.pid === 'string' ? router.query.pid.trim() : '';
        if (!queryPid) {
            setView('no-pid');
            return;
        }
        setPid(queryPid);
        (async () => {
            try {
                const result = await getUnsubscribeStatus(queryPid);
                if (isRedirect(result)) return; // the HTTP client has already navigated away
                setStatus(result);
                setView(result.found ? 'ready' : 'not-found');
            } catch (err) {
                console.error('Failed to load subscription status:', err);
                setView('error');
            }
        })();
    }, [router.isReady, router.query.pid]);

    const change = async (unsubscribe: boolean) => {
        setWorking(true);
        setActionError('');
        try {
            const result = await setUnsubscribe(pid, unsubscribe);
            if (isRedirect(result)) return;
            if (!result.found) {
                setView('not-found');
                return;
            }
            setStatus(result);
            setJustChanged(true);
        } catch (err) {
            console.error('Failed to update subscription:', err);
            setActionError('Sorry, something went wrong. Please try again.');
        } finally {
            setWorking(false);
        }
    };

    const name = status?.first ? `, ${status.first}` : '';
    let body: React.ReactNode;
    switch (view) {
        case 'loading':
            body = <p>Loading…</p>;
            break;
        case 'no-pid':
            body = (
                <>
                    <h1>This link is incomplete</h1>
                    <p>Please use the unsubscribe link at the bottom of one of our emails.</p>
                </>
            );
            break;
        case 'not-found':
            body = (
                <>
                    <h1>We don&apos;t recognize this link</h1>
                    <p>Please use the unsubscribe link at the bottom of one of our emails.</p>
                </>
            );
            break;
        case 'error':
            body = (
                <>
                    <h1>Something went wrong</h1>
                    <p className="error">We couldn&apos;t load your email preferences. Please try again later.</p>
                </>
            );
            break;
        case 'ready':
            if (status?.unsubscribed) {
                const since = formatDate(status.unsubscribeTS);
                body = (
                    <>
                        <h1>{justChanged ? `You're unsubscribed${name}` : `You're already unsubscribed${name}`}</h1>
                        <p>
                            {justChanged
                                ? 'You will no longer receive our event emails.'
                                : `You haven't been receiving our event emails${since ? ` since ${since}` : ''}.`}
                        </p>
                        <p>Changed your mind? You can re-subscribe at any time with this same link.</p>
                        <div className="actions">
                            <button className="button button-secondary" disabled={working} onClick={() => change(false)}>
                                {working ? 'Re-subscribing…' : 'Re-subscribe'}
                            </button>
                        </div>
                    </>
                );
            } else if (justChanged) {
                body = (
                    <>
                        <h1>Welcome back{name}</h1>
                        <p>You&apos;re subscribed again and will receive our event emails.</p>
                        <div className="actions">
                            <button className="button button-secondary" disabled={working} onClick={() => change(true)}>
                                {working ? 'Unsubscribing…' : 'Unsubscribe'}
                            </button>
                        </div>
                    </>
                );
            } else {
                body = (
                    <>
                        <h1>Unsubscribe{name}?</h1>
                        <p>You will stop receiving our event emails, including announcements and registration information.</p>
                        <div className="actions">
                            <button className="button button-primary" disabled={working} onClick={() => change(true)}>
                                {working ? 'Unsubscribing…' : 'Yes, unsubscribe me'}
                            </button>
                        </div>
                    </>
                );
            }
            break;
    }

    return (
        <main className="page">
            <div className="card">
                {body}
                {actionError && <p className="error">{actionError}</p>}
                <Contact />
            </div>
        </main>
    );
}
