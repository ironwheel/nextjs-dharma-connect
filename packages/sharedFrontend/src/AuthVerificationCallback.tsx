import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { publicIpv4 } from 'public-ip';
import { api } from './httpClient';

interface AuthVerificationCallbackProps {
    pid: string | null;
    hash: string | null;
    tokenId: string | null;
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
 */
const AuthVerificationCallback: React.FC<AuthVerificationCallbackProps> = ({ pid, hash, tokenId }) => {
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
                // Success - redirect to the app with pid and hash
                router.replace(`/?pid=${pid}&hash=${hash}`);
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