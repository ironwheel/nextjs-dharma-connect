import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { publicIpv4 } from 'public-ip';
import { api } from './httpClient';

interface AuthVerificationCallbackProps {
    pid: string | null;
    hash: string | null;
    tokenId: string | null;
    targetWindow?: string | null;
}

/**
 * AuthVerificationCallback Component
 * This component handles the UI and logic for email verification callbacks.
 * It's designed to be a shared component in a monorepo setup.
 *
 * Props:
 * - pid: The user's unique identifier (e.g., from URL parameters).
 * - hash: A unique hash for the verification request (e.g., from URL parameters).
 * - tokenId: The verification token ID from the email link.
 * - targetWindow: The name of the window to redirect to after successful verification.
 */
const AuthVerificationCallback: React.FC<AuthVerificationCallbackProps> = ({ pid, hash, tokenId, targetWindow }) => {
    console.log('AuthVerificationCallback props:', { pid, hash, tokenId, targetWindow });
    const router = useRouter();
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Debug error state changes
    useEffect(() => {
        console.log('Error state changed to:', error);
    }, [error]);
    const [needsVerification, setNeedsVerification] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [isResent, setIsResent] = useState(false);

    /**
     * Handles the verification callback by calling the backend API.
     */
    const handleVerification = async () => {
        if (!pid || !hash || !tokenId) {
            setError('Missing required verification information.');
            return;
        }

        setIsVerifying(true);
        setError(null);
        setNeedsVerification(false);

        try {
            console.log('About to make API call to verificationEmailCallback');
            const result = await api.post(`/api/auth/verificationEmailCallback/${tokenId}`, pid, hash, {});
            console.log('API call succeeded with result:', result);

            if (result.status === 'authenticated') {
                // Success - redirect to the target window if specified, otherwise use current window
                const redirectUrl = `/?pid=${pid}&hash=${hash}`;

                if (targetWindow && typeof window !== 'undefined') {
                    console.log('Looking for target window:', targetWindow);
                    console.log('Current window name:', window.name);
                    console.log('Window opener:', window.opener);

                    // Try multiple strategies to find and redirect the target window
                    let redirected = false;

                    // Strategy 1: Check if we're in the target window
                    if (window.name === targetWindow) {
                        console.log('Strategy 1: We are in the target window, redirecting current window');
                        router.replace(redirectUrl);
                        redirected = true;
                    }
                    // Strategy 2: Check if we're in the target window via sessionStorage
                    else if (!redirected && sessionStorage.getItem('emailVerificationWindow') === 'true') {
                        console.log('Strategy 2: We are in the target window (via sessionStorage), redirecting current window');
                        router.replace(redirectUrl);
                        redirected = true;
                    }
                    // Strategy 3: Try to find the window by name
                    if (!redirected) {
                        console.log('Strategy 3: Trying to find window by name');
                        try {
                            const targetWindowObj = window.open('', targetWindow);
                            if (targetWindowObj && !targetWindowObj.closed) {
                                console.log('Strategy 3: Target window found by name, redirecting it');
                                targetWindowObj.location.href = redirectUrl;
                                window.close();
                                redirected = true;
                            } else {
                                console.log('Strategy 3: Target window not found by name');
                            }
                        } catch (err) {
                            console.log('Strategy 3: Error finding window by name:', err);
                        }
                    }
                    // Strategy 4: Try to redirect the opener window if it exists
                    if (!redirected && window.opener && !window.opener.closed) {
                        console.log('Strategy 4: Trying to redirect opener window');
                        try {
                            window.opener.location.href = redirectUrl;
                            window.close();
                            redirected = true;
                        } catch (err) {
                            console.log('Strategy 4: Error redirecting opener window:', err);
                        }
                    }
                    // Strategy 5: Try to find any window with the sessionStorage flag
                    if (!redirected) {
                        console.log('Strategy 5: Trying to find window with sessionStorage flag');
                        console.log('Current sessionStorage emailVerificationWindow:', sessionStorage.getItem('emailVerificationWindow'));

                        // Try to find the target window by name
                        const targetWindowObj = window.open('', targetWindow);
                        console.log('Strategy 5: Target window object from window.open:', targetWindowObj);

                        if (targetWindowObj && !targetWindowObj.closed) {
                            console.log('Strategy 5: Found target window, checking sessionStorage');
                            // Check if this window has the sessionStorage flag
                            try {
                                const hasFlag = targetWindowObj.sessionStorage.getItem('emailVerificationWindow');
                                console.log('Strategy 5: Target window sessionStorage flag:', hasFlag);
                                if (hasFlag === 'true') {
                                    console.log('Strategy 5: Found target window with sessionStorage flag, redirecting it');
                                    targetWindowObj.location.href = redirectUrl;
                                    window.close();
                                    redirected = true;
                                } else {
                                    console.log('Strategy 5: Target window found but no sessionStorage flag');
                                }
                            } catch (err) {
                                console.log('Strategy 5: Error checking sessionStorage in target window:', err);
                            }
                        } else {
                            console.log('Strategy 5: Could not find target window by name');

                            // Alternative approach: try to find any window that might be the verification window
                            // This is a more aggressive approach that tries to enumerate windows
                            console.log('Strategy 5: Trying alternative window enumeration approach');
                            try {
                                // Try to open a window with a known name to see if we can access it
                                const testWindow = window.open('', 'testWindow');
                                if (testWindow) {
                                    testWindow.close();
                                    console.log('Strategy 5: Can open windows, trying to find verification window');

                                    // Try a few common window names that might be the verification window
                                    const possibleNames = ['emailVerificationWindow', 'verification', 'auth', 'login'];
                                    for (const name of possibleNames) {
                                        const possibleWindow = window.open('', name);
                                        if (possibleWindow && !possibleWindow.closed) {
                                            console.log('Strategy 5: Found possible window with name:', name);
                                            try {
                                                const hasFlag = possibleWindow.sessionStorage.getItem('emailVerificationWindow');
                                                if (hasFlag === 'true') {
                                                    console.log('Strategy 5: Found verification window with name:', name);
                                                    possibleWindow.location.href = redirectUrl;
                                                    window.close();
                                                    redirected = true;
                                                    break;
                                                }
                                            } catch (err) {
                                                console.log('Strategy 5: Error checking sessionStorage in possible window:', err);
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                console.log('Strategy 5: Error in alternative window enumeration:', err);
                            }
                        }
                    }
                    // Strategy 6: Try to find window using localStorage (which persists across windows)
                    if (!redirected) {
                        console.log('Strategy 6: Trying to find window using localStorage');
                        try {
                            // Check if we can find any window that has the localStorage flag
                            const testWindow = window.open('', '_blank');
                            if (testWindow) {
                                testWindow.close();

                                // Try to find the target window
                                const targetWindowObj = window.open('', targetWindow);
                                if (targetWindowObj && !targetWindowObj.closed) {
                                    try {
                                        const hasLocalFlag = targetWindowObj.localStorage.getItem('emailVerificationWindow');
                                        console.log('Strategy 6: Target window localStorage flag:', hasLocalFlag);
                                        if (hasLocalFlag === 'true') {
                                            console.log('Strategy 6: Found target window with localStorage flag, redirecting it');
                                            targetWindowObj.location.href = redirectUrl;
                                            window.close();
                                            redirected = true;
                                        }
                                    } catch (err) {
                                        console.log('Strategy 6: Error checking localStorage in target window:', err);
                                    }
                                } else {
                                    console.log('Strategy 6: Could not find target window by name, trying alternative approach');

                                    // Alternative approach: try to find any window that might be the verification window
                                    console.log('Strategy 6: Trying alternative window enumeration approach with localStorage');
                                    try {
                                        // Try a few common window names that might be the verification window
                                        const possibleNames = ['emailVerificationWindow', 'verification', 'auth', 'login'];
                                        for (const name of possibleNames) {
                                            const possibleWindow = window.open('', name);
                                            if (possibleWindow && !possibleWindow.closed) {
                                                console.log('Strategy 6: Found possible window with name:', name);
                                                try {
                                                    const hasLocalFlag = possibleWindow.localStorage.getItem('emailVerificationWindow');
                                                    if (hasLocalFlag === 'true') {
                                                        console.log('Strategy 6: Found verification window with localStorage flag and name:', name);
                                                        possibleWindow.location.href = redirectUrl;
                                                        window.close();
                                                        redirected = true;
                                                        break;
                                                    }
                                                } catch (err) {
                                                    console.log('Strategy 6: Error checking localStorage in possible window:', err);
                                                }
                                            }
                                        }
                                    } catch (err) {
                                        console.log('Strategy 6: Error in alternative window enumeration:', err);
                                    }
                                }
                            }
                        } catch (err) {
                            console.log('Strategy 6: Error in localStorage approach:', err);
                        }
                    }

                    // Strategy 7: Try to use postMessage to communicate with other windows
                    if (!redirected) {
                        console.log('Strategy 7: Trying postMessage approach');
                        try {
                            // Try to send a message to any window that might be listening
                            const testWindow = window.open('', '_blank');
                            if (testWindow) {
                                testWindow.close();
                                console.log('Strategy 7: Can open windows, trying postMessage');

                                // Try to find any window and send it a message
                                const possibleNames = ['emailVerificationWindow', 'verification', 'auth', 'login'];
                                for (const name of possibleNames) {
                                    const possibleWindow = window.open('', name);
                                    if (possibleWindow && !possibleWindow.closed) {
                                        console.log('Strategy 7: Found possible window with name:', name);
                                        try {
                                            // Send a message to the window asking if it's the verification window
                                            possibleWindow.postMessage({
                                                type: 'VERIFICATION_CALLBACK',
                                                redirectUrl: redirectUrl
                                            }, '*');
                                            console.log('Strategy 7: Sent postMessage to window:', name);
                                            // Close this window since we're redirecting the other one
                                            window.close();
                                            redirected = true;
                                            break;
                                        } catch (err) {
                                            console.log('Strategy 7: Error sending postMessage to window:', err);
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.log('Strategy 7: Error in postMessage approach:', err);
                        }
                    }

                    // Strategy 8: Try to use a different approach - check if we can access the opener's opener
                    if (!redirected) {
                        console.log('Strategy 8: Trying opener chain approach');
                        try {
                            // Check if we have an opener and if that opener has an opener
                            if (window.opener && !window.opener.closed) {
                                console.log('Strategy 8: We have an opener window');
                                try {
                                    // Try to access the opener's opener
                                    if (window.opener.opener && !window.opener.opener.closed) {
                                        console.log('Strategy 8: Opener has an opener, checking if it\'s the verification window');
                                        try {
                                            const hasFlag = window.opener.opener.sessionStorage.getItem('emailVerificationWindow');
                                            if (hasFlag === 'true') {
                                                console.log('Strategy 8: Found verification window in opener chain, redirecting it');
                                                window.opener.opener.location.href = redirectUrl;
                                                window.close();
                                                redirected = true;
                                            }
                                        } catch (err) {
                                            console.log('Strategy 8: Error checking sessionStorage in opener\'s opener:', err);
                                        }
                                    }
                                } catch (err) {
                                    console.log('Strategy 8: Error accessing opener\'s opener:', err);
                                }
                            } else {
                                console.log('Strategy 8: No opener window or opener is closed');
                            }
                        } catch (err) {
                            console.log('Strategy 8: Error in opener chain approach:', err);
                        }
                    }

                    // Strategy 9: Fallback to current window
                    if (!redirected) {
                        console.log('Strategy 9: No target window found, redirecting current window');
                        router.replace(redirectUrl);
                    }
                } else {
                    // No target window specified, redirect current window
                    console.log('No target window specified, redirecting current window');
                    router.replace(redirectUrl);
                }
            } else if (result.status === 'needs-verification') {
                // Email link has expired
                setNeedsVerification(true);
            } else {
                setError('Unexpected response from verification.');
            }
        } catch (err: any) {
            console.log('Caught error in handleVerification:', err);
            console.log('Error message:', err.message);
            console.log('Error details:', err.details);
            const errorMessage = err.message || 'An unexpected error occurred during verification.';
            console.log('Setting error to:', errorMessage);
            setError(errorMessage);
            console.error('Verification callback error:', err);
        } finally {
            setIsVerifying(false);
        }
    };

    /**
     * Resends verification email when the original link has expired.
     */
    const resendVerification = async () => {
        if (!pid || !hash || isResending) {
            setError('Please ensure all required information is available.');
            return;
        }

        setIsResending(true);
        setError(null);

        try {
            const clientIp = await publicIpv4().catch(() => null);
            await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);
            setIsResent(true);
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred while sending the email.');
            console.error('Verification email resend error:', err);
        } finally {
            setIsResending(false);
        }
    };

    // Auto-trigger verification when component mounts
    useEffect(() => {
        if (pid && hash && tokenId) {
            console.log('useEffect: About to call handleVerification');
            handleVerification().catch(err => {
                console.log('useEffect caught error:', err);
                setError(err.message || 'Unexpected error during verification');
            });
        }
    }, [pid, hash, tokenId]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-inter">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Email Verification</h1>

                {/* Debug info */}
                <div className="mb-4 p-2 bg-gray-100 text-xs text-gray-600 rounded">
                    Debug: isVerifying={isVerifying.toString()}, error={error || 'null'}, needsVerification={needsVerification.toString()}
                </div>

                {isVerifying && (
                    <div className="mb-6">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Verifying your email...</p>
                    </div>
                )}

                {needsVerification && !isResent && (
                    <div className="mb-6">
                        <p className="text-gray-600 mb-6">
                            The verification link has expired. Please click the button below to receive a new verification email.
                        </p>
                        <button
                            onClick={resendVerification}
                            disabled={isResending || !pid || !hash}
                            className={`
                                w-full px-6 py-3 rounded-lg text-white font-semibold text-lg
                                transition-all duration-300 ease-in-out
                                ${isResending || !pid || !hash
                                    ? 'bg-indigo-300 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md hover:shadow-lg'
                                }
                            `}
                        >
                            {isResending ? 'Sending Email...' : 'Send New Verification Email'}
                        </button>
                    </div>
                )}

                {isResent && (
                    <div className="mt-6 p-4 bg-green-100 text-green-700 rounded-lg shadow-inner">
                        <p className="font-semibold">New Email Sent Successfully!</p>
                        <p className="text-sm mt-1">Please check your inbox for the new verification email.</p>
                    </div>
                )}

                {error && (
                    <div className="mt-6 p-4 bg-red-100 text-red-700 rounded-lg shadow-inner border-2 border-red-300">
                        <p className="font-semibold text-lg">⚠️ Error:</p>
                        <p className="text-sm mt-1 font-mono">{error}</p>
                        <p className="text-xs mt-1 opacity-75">Debug: Error is being displayed</p>
                    </div>
                )}

                {(!pid || !hash || !tokenId) && !isVerifying && !needsVerification && (
                    <div className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner">
                        <p className="font-semibold">Information Missing:</p>
                        <p className="text-sm mt-1">Unable to proceed. Required verification information (PID, Hash, or Token ID) is missing. Please ensure you've accessed this page correctly.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuthVerificationCallback; 