import React, { useState, useEffect, useRef } from 'react';
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
    const [code, setCode] = useState(['', '', '', '', '', '']);
    const [isVerifying, setIsVerifying] = useState(false);
    const [attempts, setAttempts] = useState(0);
    const [isResending, setIsResending] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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

    // Global paste handler for when code input is visible
    useEffect(() => {
        if (typeof window !== 'undefined' && isSent) {
            const handleGlobalPaste = (e: ClipboardEvent) => {
                // Only handle paste if code input is visible and not already in an input field
                if (isSent && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    const pastedData = e.clipboardData?.getData('text') || '';
                    const digitsOnly = pastedData.replace(/\D/g, '').slice(0, 6);

                    if (digitsOnly.length > 0) {
                        const newCode = [...code];
                        for (let i = 0; i < 6; i++) {
                            newCode[i] = digitsOnly[i] || '';
                        }
                        setCode(newCode);

                        // Focus the last filled input or the next empty one
                        const lastFilledIndex = Math.min(digitsOnly.length - 1, 5);
                        if (inputRefs.current[lastFilledIndex]) {
                            inputRefs.current[lastFilledIndex]?.focus();
                        }
                    }
                }
            };

            window.addEventListener('paste', handleGlobalPaste);

            // Cleanup function
            return () => {
                window.removeEventListener('paste', handleGlobalPaste);
            };
        }
    }, [isSent, code]);

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
            const clientIp = await publicIpv4().catch(() => null);
            await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);
            setIsSent(true);
            setAttempts(0); // Reset attempts when new code is sent
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred while sending the email.');
            console.error('Verification email send error:', err);
        } finally {
            setIsSending(false);
        }
    };

    /**
     * Handles code input changes and auto-advances to next input
     */
    const handleCodeChange = (index: number, value: string) => {
        if (value.length > 1) {
            // Handle paste event - extract only digits
            const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
            const newCode = [...code];

            // Fill in the digits
            for (let i = 0; i < 6; i++) {
                newCode[i] = digitsOnly[i] || '';
            }
            setCode(newCode);

            // Focus the last filled input or the next empty one
            const lastFilledIndex = Math.min(digitsOnly.length - 1, 5);
            if (inputRefs.current[lastFilledIndex]) {
                inputRefs.current[lastFilledIndex]?.focus();
            }
        } else {
            // Handle single digit input
            const newCode = [...code];
            newCode[index] = value;
            setCode(newCode);

            // Auto-advance to next input if value is entered
            if (value && index < 5) {
                inputRefs.current[index + 1]?.focus();
            }
        }
    };

    /**
     * Handles backspace to go to previous input
     */
    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    /**
 * Handles paste events specifically for individual input fields
 */
    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent the global paste handler from also firing
        const pastedData = e.clipboardData.getData('text');
        const digitsOnly = pastedData.replace(/\D/g, '').slice(0, 6);

        if (digitsOnly.length > 0) {
            const newCode = [...code];
            for (let i = 0; i < 6; i++) {
                newCode[i] = digitsOnly[i] || '';
            }
            setCode(newCode);

            // Focus the last filled input or the next empty one
            const lastFilledIndex = Math.min(digitsOnly.length - 1, 5);
            if (inputRefs.current[lastFilledIndex]) {
                inputRefs.current[lastFilledIndex]?.focus();
            }
        }
    };

    /**
     * Verifies the entered 6-digit code
     */
    const verifyCode = async () => {
        const codeString = code.join('');
        if (codeString.length !== 6 || !/^\d{6}$/.test(codeString)) {
            setError('Please enter a valid 6-digit code.');
            return;
        }

        if (!pid || !hash) {
            setError('Missing required verification information.');
            return;
        }

        setIsVerifying(true);
        setError(null);

        try {
            const result = await api.post(`/api/auth/verificationEmailCallback/${codeString}`, pid, hash, {});

            if (result.status === 'authenticated') {
                // Success - set redirecting state to prevent UI changes
                setIsRedirecting(true);
                // Redirect to main app
                const redirectUrl = `/?pid=${pid}&hash=${hash}`;
                window.location.href = redirectUrl;
            } else {
                setError('You have entered an invalid code.');
                setAttempts(attempts + 1);
            }
        } catch (err: any) {
            if (err.message?.includes('expired') || err.message?.includes('not found')) {
                setError('The verification code has expired. Please request a new one.');
                setIsSent(false); // Show the send button again
            } else if (err.message?.includes('RATE_LIMIT_EXCEEDED')) {
                setError('Too many failed attempts. Please wait 5 minutes before trying again.');
            } else if (err.message?.includes('INVALID_FORMAT')) {
                setError('Please enter a valid 6-digit code.');
            } else {
                setError('Please try again later.');
            }
            setAttempts(attempts + 1);
        } finally {
            setIsVerifying(false);
        }
    };

    /**
     * Resends verification email
     */
    const resendCode = async () => {
        if (!pid || !hash || isResending) {
            setError('Please ensure all required information is available.');
            return;
        }

        setIsResending(true);
        setError(null);

        try {
            const clientIp = await publicIpv4().catch(() => null);
            await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);
            setCode(['', '', '', '', '', '']); // Clear the code inputs
            setAttempts(0); // Reset attempts
        } catch (err: any) {
            if (err.message?.includes('RATE_LIMIT_EXCEEDED')) {
                setError('Too many attempts. Please wait 5 minutes before requesting a new code.');
            } else {
                setError(err.message || 'An unexpected error occurred while sending the email.');
            }
            console.error('Verification email resend error:', err);
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-inter">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Identity Verification</h1>

                {!isSent && !isRedirecting && (
                    <>
                        <p className="text-gray-600 mb-6">
                            To securely log in, we need to verify your identity. Please click the button below to send a verification email to your registered address.
                            You will receive an email containing a 6-digit code to complete your login.
                        </p>

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
                    </>
                )}

                {isSent && (
                    <>
                        {!isRedirecting && (
                            <div className="mt-6 p-4 bg-green-100 text-green-700 rounded-lg shadow-inner mb-6">
                                <p className="font-semibold">Email Sent Successfully!</p>
                                <p className="text-sm mt-1">Please check your inbox for the 6-digit code.</p>
                            </div>
                        )}

                        {isRedirecting && (
                            <div className="mt-6 p-4 bg-blue-100 text-blue-700 rounded-lg shadow-inner mb-6">
                                <div className="flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
                                    <p className="font-semibold">Verification successful! Redirecting...</p>
                                </div>
                            </div>
                        )}

                        <p className="text-gray-600 mb-6">
                            Enter the 6-digit code from your email to complete verification:
                        </p>

                        {/* 6-digit code input */}
                        <div className="flex justify-center space-x-2 mb-6">
                            {code.map((digit, index) => (
                                <input
                                    key={index}
                                    ref={(el) => {
                                        inputRefs.current[index] = el;
                                    }}
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handleCodeChange(index, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(index, e)}
                                    onPaste={handlePaste}
                                    className="w-12 h-12 text-center text-xl font-mono border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    disabled={isVerifying || isRedirecting}
                                />
                            ))}
                        </div>

                        {/* Verify button */}
                        <button
                            onClick={verifyCode}
                            disabled={isVerifying || isRedirecting || code.join('').length !== 6}
                            className={`
                                w-full px-6 py-3 rounded-lg text-white font-semibold text-lg mb-4
                                transition-all duration-300 ease-in-out
                                ${isVerifying || isRedirecting || code.join('').length !== 6
                                    ? 'bg-indigo-300 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md hover:shadow-lg'
                                }
                            `}
                        >
                            {isVerifying ? 'Verifying...' : isRedirecting ? 'Redirecting...' : 'Verify Code'}
                        </button>

                        {/* Resend code button */}
                        <button
                            onClick={resendCode}
                            disabled={isResending || isRedirecting}
                            className="w-full px-6 py-2 text-indigo-600 hover:text-indigo-800 font-medium transition-colors duration-200"
                        >
                            {isResending ? 'Sending...' : isRedirecting ? 'Redirecting...' : 'Resend Code'}
                        </button>

                        {/* Show send button again after 3 failed attempts */}
                        {attempts >= 3 && !isRedirecting && (
                            <div className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner">
                                <p className="font-semibold mb-2">Too many failed attempts</p>
                                <button
                                    onClick={() => {
                                        setIsSent(false);
                                        setAttempts(0);
                                        setCode(['', '', '', '', '', '']);
                                    }}
                                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors duration-200"
                                >
                                    Send New Verification Email
                                </button>
                            </div>
                        )}
                    </>
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