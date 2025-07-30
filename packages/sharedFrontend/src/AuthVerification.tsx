import React, { useState, useEffect } from 'react';
import { publicIpv4 } from 'public-ip';
import { api } from './httpClient';

interface AuthVerificationProps {
    pid: string | null;
    hash: string | null;
}

/**
 * AuthVerification Component
 * This component handles the UI and logic for sending a verification email.
 * It's designed to be a shared component in a monorepo setup.
 *
 * Props:
 * - pid: The user's unique identifier (e.g., from URL parameters).
 * - hash: A unique hash for the verification request (e.g., from URL parameters).
 */
const AuthVerification: React.FC<AuthVerificationProps> = ({ pid, hash }) => {
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSent, setIsSent] = useState(false);

    // Name the window when component mounts (when user needs email verification)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.name = 'emailVerificationWindow';
            // Store flags in both sessionStorage and localStorage to identify this window
            sessionStorage.setItem('emailVerificationWindow', 'true');
            localStorage.setItem('emailVerificationWindow', 'true');
            console.log('AuthVerification: Window named and storage flags set');

            // Add message listener to handle verification callbacks from other windows
            const handleMessage = (event: MessageEvent) => {
                console.log('AuthVerification: Received message:', event.data);
                if (event.data && event.data.type === 'VERIFICATION_CALLBACK') {
                    console.log('AuthVerification: Received verification callback, redirecting to:', event.data.redirectUrl);
                    window.location.href = event.data.redirectUrl;
                }
            };

            window.addEventListener('message', handleMessage);

            // Cleanup function
            return () => {
                window.removeEventListener('message', handleMessage);
            };
        }
    }, []);

    /**
     * Initiates the email verification process by calling the backend API.
     * Displays loading, success, or error messages based on the API response.
     */
    const initiateVerification = async () => {
        // Prevent sending if pid or hash are missing, or if already sending/sent
        if (!pid || !hash || isSending || isSent) {
            setError('Please ensure all required information is available.');
            return;
        }

        setIsSending(true);
        setError(null); // Clear previous errors
        try {
            // The actual API call as described in your prompt
            // Note: The second and third arguments to api.post might need adjustment
            // based on your actual api client's signature. Here, I'm passing pid and hash
            // as separate arguments as per your example.
            const clientIp = await publicIpv4().catch(() => null);
            await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);
            setIsSent(true);
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred while sending the email.');
            console.error('Verification email send error:', err);
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-inter">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Identity Verification</h1>

                <p className="text-gray-600 mb-6">
                    To securely log in, we need to verify your identity. Please click the button below to send a verification email to your registered address.
                    You will receive an email containing a link to complete your login.
                </p>

                {!isSent && (
                    <button
                        onClick={initiateVerification}
                        disabled={isSending || !pid || !hash}
                        className={`
              w-full px-6 py-3 rounded-lg text-white font-semibold text-lg
              transition-all duration-300 ease-in-out
              ${isSending || !pid || !hash
                                ? 'bg-indigo-300 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md hover:shadow-lg'
                            }
            `}
                    >
                        {isSending ? 'Sending Email...' : 'Send Verification Email'}
                    </button>
                )}

                {isSent && (
                    <div className="mt-6 p-4 bg-green-100 text-green-700 rounded-lg shadow-inner">
                        <p className="font-semibold">Email Sent Successfully!</p>
                        <p className="text-sm mt-1">Please check your inbox.</p>
                    </div>
                )}

                {error && (
                    <div className="mt-6 p-4 bg-red-100 text-red-700 rounded-lg shadow-inner">
                        <p className="font-semibold">Error:</p>
                        <p className="text-sm mt-1">{error}</p>
                    </div>
                )}

                {(!pid || !hash) && !isSent && !isSending && (
                    <div className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner">
                        <p className="font-semibold">Information Missing:</p>
                        <p className="text-sm mt-1">Unable to proceed. Required identity information (PID or Hash) is missing. Please ensure you've accessed this page correctly.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuthVerification;