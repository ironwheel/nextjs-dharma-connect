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
    const [expiredAuthFlow, setExpiredAuthFlow] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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
        setExpiredAuthFlow(false); // Clear expired auth flow state
        try {
            const clientIp = await publicIpv4().catch(() => null);
            const result = await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);

            // Check if this is an expired auth flow response
            if (result && result.expiredAuthFlow) {
                setExpiredAuthFlow(true);
                setAttempts(0);
                return;
            }

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
        setExpiredAuthFlow(false); // Clear expired auth flow state

        try {
            const clientIp = await publicIpv4().catch(() => null);
            const result = await api.post(`/api/auth/verificationEmailSend/${pid}`, pid, hash, clientIp);

            // Check if this is an expired auth flow response
            if (result && result.expiredAuthFlow) {
                setExpiredAuthFlow(true);
                setCode(['', '', '', '', '', '']); // Clear the code inputs
                setAttempts(0); // Reset attempts
                return;
            }

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
        <div
            className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-inter"
            style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                backgroundColor: '#f3f4f6',
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem'
            }}
        >
            <style dangerouslySetInnerHTML={{
                __html: `
                    .auth-verification-input {
                        background-color: #ffffff !important;
                        color: #000000 !important;
                        border-color: #d1d5db !important;
                        caret-color: #000000 !important;
                        -webkit-text-fill-color: #000000 !important;
                        -webkit-appearance: none !important;
                        -moz-appearance: textfield !important;
                        background: #ffffff !important;
                        background-image: none !important;
                        background-clip: padding-box !important;
                        border: 2px solid #d1d5db !important;
                        border-radius: 0.5rem !important;
                        box-shadow: none !important;
                        outline: none !important;
                        text-align: center !important;
                        font-size: 1.25rem !important;
                        font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace !important;
                        font-weight: 400 !important;
                        line-height: 1.5 !important;
                        padding: 0.5rem !important;
                        width: 3rem !important;
                        height: 3rem !important;
                        min-width: 3rem !important;
                        min-height: 3rem !important;
                        max-width: 3rem !important;
                        max-height: 3rem !important;
                    }
                    
                    .auth-verification-input:focus {
                        background-color: #ffffff !important;
                        color: #000000 !important;
                        border-color: #6366f1 !important;
                        -webkit-text-fill-color: #000000 !important;
                        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2) !important;
                    }
                    
                    .auth-verification-input:disabled {
                        background-color: #f3f4f6 !important;
                        color: #6b7280 !important;
                        -webkit-text-fill-color: #6b7280 !important;
                    }
                `
            }} />
            <div
                className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center"
                style={{
                    backgroundColor: '#ffffff',
                    padding: '2rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    maxWidth: '28rem',
                    width: '100%',
                    textAlign: 'center'
                }}
            >
                <h1 className="text-3xl font-bold text-gray-800 mb-6" style={{ color: '#1f2937', fontWeight: 'bold' }}>Identity Verification</h1>

                {!isSent && !isRedirecting && (
                    <>
                        {expiredAuthFlow && (
                            <div
                                className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner mb-6"
                                style={{
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    backgroundColor: '#fef3c7',
                                    color: '#a16207',
                                    borderRadius: '0.5rem',
                                    boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
                                    marginBottom: '1.5rem'
                                }}
                            >
                                <p className="font-semibold" style={{ fontWeight: '600' }}>Your login session expired.</p>
                                <p className="text-sm mt-1" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Please press Send Verification Email again to send a new code.</p>
                            </div>
                        )}

                        <p className="text-gray-600 mb-6" style={{ color: '#4b5563' }}>
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
                            style={{
                                width: '100%',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '0.5rem',
                                color: '#ffffff',
                                fontWeight: '600',
                                fontSize: '1.125rem',
                                transition: 'all 0.3s ease-in-out',
                                backgroundColor: isSending || !pid || !hash ? '#a5b4fc' : '#4f46e5',
                                cursor: isSending || !pid || !hash ? 'not-allowed' : 'pointer',
                                border: 'none',
                                outline: 'none'
                            }}
                        >
                            {isSending ? 'Sending Email...' : 'Send Verification Email'}
                        </button>
                    </>
                )}

                {isSent && (
                    <>
                        {!isRedirecting && (
                            <div
                                className="mt-6 p-4 bg-green-100 text-green-700 rounded-lg shadow-inner mb-6"
                                style={{
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    backgroundColor: '#dcfce7',
                                    color: '#15803d',
                                    borderRadius: '0.5rem',
                                    boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
                                    marginBottom: '1.5rem'
                                }}
                            >
                                <p className="font-semibold" style={{ fontWeight: '600' }}>Email Sent Successfully!</p>
                                <p className="text-sm mt-1" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Please check your inbox for the 6-digit code.</p>
                            </div>
                        )}

                        {isRedirecting && (
                            <div
                                className="mt-6 p-4 bg-blue-100 text-blue-700 rounded-lg shadow-inner mb-6"
                                style={{
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    backgroundColor: '#dbeafe',
                                    color: '#1d4ed8',
                                    borderRadius: '0.5rem',
                                    boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
                                    marginBottom: '1.5rem'
                                }}
                            >
                                <div className="flex items-center justify-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3" style={{ animation: 'spin 1s linear infinite', borderRadius: '50%', height: '1.5rem', width: '1.5rem', borderBottom: '2px solid #2563eb', marginRight: '0.75rem' }}></div>
                                    <p className="font-semibold" style={{ fontWeight: '600' }}>Verification successful! Redirecting...</p>
                                </div>
                            </div>
                        )}

                        <p className="text-gray-600 mb-6" style={{ color: '#4b5563' }}>
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
                                    className="auth-verification-input w-12 h-12 text-center text-xl font-mono border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    style={{
                                        backgroundColor: '#ffffff !important',
                                        color: '#000000 !important',
                                        borderColor: '#d1d5db !important',
                                        caretColor: '#000000 !important',
                                        WebkitTextFillColor: '#000000 !important',
                                        WebkitAppearance: 'none',
                                        MozAppearance: 'textfield',
                                        background: '#ffffff !important',
                                        backgroundImage: 'none !important',
                                        backgroundClip: 'padding-box !important',
                                        border: '2px solid #d1d5db !important',
                                        borderRadius: '0.5rem !important',
                                        boxShadow: 'none !important',
                                        outline: 'none !important',
                                        textAlign: 'center',
                                        fontSize: '1.25rem !important',
                                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace !important',
                                        fontWeight: '400 !important',
                                        lineHeight: '1.5 !important',
                                        padding: '0.5rem !important',
                                        width: '3rem !important',
                                        height: '3rem !important',
                                        minWidth: '3rem !important',
                                        minHeight: '3rem !important',
                                        maxWidth: '3rem !important',
                                        maxHeight: '3rem !important'
                                    }}
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
                            style={{
                                width: '100%',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '0.5rem',
                                color: '#ffffff',
                                fontWeight: '600',
                                fontSize: '1.125rem',
                                marginBottom: '1rem',
                                transition: 'all 0.3s ease-in-out',
                                backgroundColor: isVerifying || isRedirecting || code.join('').length !== 6 ? '#a5b4fc' : '#4f46e5',
                                cursor: isVerifying || isRedirecting || code.join('').length !== 6 ? 'not-allowed' : 'pointer',
                                border: 'none',
                                outline: 'none'
                            }}
                        >
                            {isVerifying ? 'Verifying...' : isRedirecting ? 'Redirecting...' : 'Verify Code'}
                        </button>

                        {/* Resend code button */}
                        <button
                            onClick={resendCode}
                            disabled={isResending || isRedirecting}
                            className="w-full px-6 py-2 text-indigo-600 hover:text-indigo-800 font-medium transition-colors duration-200"
                            style={{
                                width: '100%',
                                padding: '0.5rem 1.5rem',
                                color: '#4f46e5',
                                fontWeight: '500',
                                transition: 'color 0.2s',
                                backgroundColor: 'transparent',
                                border: 'none',
                                outline: 'none',
                                cursor: isResending || isRedirecting ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {isResending ? 'Sending...' : isRedirecting ? 'Redirecting...' : 'Resend Code'}
                        </button>

                        {/* Show send button again after 3 failed attempts */}
                        {attempts >= 3 && !isRedirecting && (
                            <div
                                className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner"
                                style={{
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    backgroundColor: '#fef3c7',
                                    color: '#a16207',
                                    borderRadius: '0.5rem',
                                    boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
                                }}
                            >
                                <p className="font-semibold mb-2" style={{ fontWeight: '600', marginBottom: '0.5rem' }}>Too many failed attempts</p>
                                <button
                                    onClick={() => {
                                        setIsSent(false);
                                        setAttempts(0);
                                        setCode(['', '', '', '', '', '']);
                                    }}
                                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors duration-200"
                                    style={{
                                        padding: '0.5rem 1rem',
                                        backgroundColor: '#d97706',
                                        color: '#ffffff',
                                        borderRadius: '0.5rem',
                                        transition: 'background-color 0.2s',
                                        border: 'none',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Send New Verification Email
                                </button>
                            </div>
                        )}
                    </>
                )}

                {error && (
                    <div
                        className="mt-6 p-4 bg-red-100 text-red-700 rounded-lg shadow-inner"
                        style={{
                            marginTop: '1.5rem',
                            padding: '1rem',
                            backgroundColor: '#fee2e2',
                            color: '#b91c1c',
                            borderRadius: '0.5rem',
                            boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
                        }}
                    >
                        <p className="font-semibold" style={{ fontWeight: '600' }}>Error:</p>
                        <p className="text-sm mt-1" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{error}</p>
                    </div>
                )}

                {(!pid || !hash) && !isSent && !isSending && (
                    <div
                        className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg shadow-inner"
                        style={{
                            marginTop: '1.5rem',
                            padding: '1rem',
                            backgroundColor: '#fef3c7',
                            color: '#a16207',
                            borderRadius: '0.5rem',
                            boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
                        }}
                    >
                        <p className="font-semibold" style={{ fontWeight: '600' }}>Information Missing:</p>
                        <p className="text-sm mt-1" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Unable to proceed. Required identity information (PID or Hash) is missing. Please ensure you've accessed this page correctly.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuthVerification;