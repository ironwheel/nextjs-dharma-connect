/**
 * @file pages/confirm.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description This page handles the email confirmation process. It verifies a token
 * received via URL parameters, and upon successful verification, it generates and
 * stores an access token, then redirects the user to the main dashboard.
 * It uses /api/auth for token verification and /api/db for logging errors and fetching prompts.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from 'next/router';
import { Container, Form, Row, Button, Col } from "react-bootstrap";
import { publicIpv4 } from 'public-ip';

// Shared utilities and components using '@/' alias
import { getFingerprint } from '@/utils/fingerprint';
import { dbgOut, dbgPrompt as studentDbgPrompt, dbgout as studentDbgout } from '@/utils/debugUtils';
import { promptLookup as basePromptLookup } from '@/utils/promptUtils';
import { TopNavBar, BottomNavBar } from '@/components/SharedLayout';

// Module-level variable to store fetched prompts
let masterPrompts = [];
// Module-level variable for language, typically set from router query
let g_language = 'English'; // Default language

/**
 * A wrapper for the basePromptLookup utility, providing the necessary context
 * (prompts array, current language, and a fixed AID for this page).
 * @function getPromptText
 * @param {string} key - The prompt key to look up.
 * @returns {string} The localized prompt text.
 */
const getPromptText = (key) => {
    // The AID for confirm page prompts is assumed to be 'dashboard' or a generic one.
    return basePromptLookup(masterPrompts, key, g_language, 'dashboard', () => studentDbgPrompt(null), (...args) => studentDbgout(null, ...args));
};

/**
 * The Confirm component handles the token verification logic.
 * @function Confirm
 * @returns {React.Component} The rendered confirmation page UI.
 */
const Confirm = () => {
    const [errMsg, setErrMsg] = useState("");
    const [value, setValue] = useState(0); // For forceRender
    const [loaded, setLoaded] = useState(false);
    const [loadStatus, setLoadStatus] = useState("Loading confirmation...");

    const router = useRouter();
    const { pid, token, language: queryLanguage, showcase } = router.query;

    /**
     * Callback to force a re-render of the component.
     * @function forceRender
     */
    const forceRender = useCallback(() => {
        setValue(v => v + 1);
    }, []);

    /**
     * Helper to call the generic /api/db endpoint.
     * @async
     * @function callDbApi
     * @param {string} action - The action name for the backend handler.
     * @param {object} payload - The data payload for the action.
     * @returns {Promise<object>} The 'data' portion of the API response.
     * @throws {Error} If the fetch fails, response is not ok, or data contains an error.
     */
    const callDbApi = async (action, payload) => {
        console.log(`Calling DB API Action from Confirm page: ${action}`);
        try {
            const response = await fetch(`/api/db`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload })
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                console.error(`DB API Error (${action}): ${response.status} ${errorText}`);
                throw new Error(`API Error (${response.status}) for action ${action}: ${errorText}`);
            }

            const result = await response.json();
            if (result.data?.err) {
                console.error(`DB API Application Error (${action}): ${result.data.err}`);
                throw new Error(`API returned error for action ${action}: ${result.data.err}`);
            }
            return result.data;
        } catch (error) {
            console.error(`Error in callDbApi (${action}):`, error);
            // Re-throw the error to be caught by the calling function
            throw error;
        }
    };

    useEffect(() => {
        if (!router.isReady) return;

        /**
         * Fetches prompts required for this page from the API using /api/db.
         * @async
         * @param {string} aid - The application ID (used in payload if needed by backend action).
         * @returns {Promise<Array<object>>} Array of prompt objects.
         */
        const getPromptsFromDbApi = async (aid) => {
            try {
                // Assuming the 'getPrompts' action in db.js fetches all prompts
                // or filters based on payload if necessary.
                // For now, sending an empty payload to get all.
                const prompts = await callDbApi('getPrompts', { aid: aid }); // Pass aid if needed by backend action
                return prompts || [];
            } catch (error) {
                console.error("getPromptsFromDbApi error:", error);
                setErrMsg(`Error loading essential resources: ${error.message}`);
                return [];
            }
        };

        if (queryLanguage) {
            g_language = queryLanguage;
        }

        // Fetch prompts using the new function
        getPromptsFromDbApi('dashboard').then((apiPrompts) => {
            masterPrompts = apiPrompts;
            if (typeof token === 'undefined') {
                setErrMsg(getPromptText('errMissingToken'));
            } else if (typeof pid === 'undefined') {
                setErrMsg(getPromptText('errMissingPID'));
            } else {
                setLoadStatus(getPromptText('confirmPageLoaded'));
                setLoaded(true);
            }
            forceRender();
        });

    }, [router.isReady, pid, token, queryLanguage, forceRender]); // Dependencies


    /**
     * Writes a "confirmation verification error" to the student's record via the /api/db endpoint.
     * @async
     * @function writeStudentConfirmVerifyError
     * @param {string} localPid - The participant ID.
     * @param {string | object} errorDetail - Details of the error.
     * @returns {Promise<void>} Resolves when done, logs errors internally.
     */
    const writeStudentConfirmVerifyError = async (localPid, errorDetail) => {
        const errorString = typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail);
        try {
            // Use the existing callDbApi helper
            await callDbApi('writeProgramError', {
                id: localPid,
                errorKey: 'confirmVerifyError',
                errorTimeKey: 'confirmVerifyErrorTime',
                errorValue: errorString
            });
            console.log(`Logged confirmVerifyError for PID ${localPid}`);
        } catch (apiError) {
            console.error("API Error logging confirm verify error via /api/db:", apiError);
        }
    };

    /**
     * Handles the confirmation button click. Uses /api/auth for verification.
     * @async
     * @function handleConfirm
     */
    const handleConfirm = async () => {
        // ... (handleConfirm logic remains the same, using fetch to /api/auth) ...
        if (!pid || !token) {
            setErrMsg(getPromptText('errMissingPIDOrToken'));
            return;
        }
        setLoadStatus(getPromptText('verifyingTokenStatus'));

        try {
            const ip = await publicIpv4().catch(() => null);
            const fingerprintId = await getFingerprint().catch(() => null);
            const body = { pid: pid, ip: ip, fingerprint: fingerprintId, token: token };

            const response = await fetch("/api/auth/?op=verifyConfirm", { method: "POST", body: JSON.stringify(body) });

            if (!response.ok) {
                console.error(`Verify Confirm API Error: ${response.status} ${response.statusText}`);
                const errorData = await response.json().catch(() => ({ data: { err: `HTTP error ${response.status}` } }));
                const reason = errorData.data?.reason ? `: ${errorData.data.reason}` : '';
                setErrMsg(getPromptText('errVerificationFailed') + reason);
                await writeStudentConfirmVerifyError(pid, `API Error ${response.status}${reason}`);
                setLoadStatus('');
                return;
            }

            const verifyResponse = await response.json();

            if (typeof verifyResponse.data === 'string') {
                console.log("VERIFIED, received access token.");
                localStorage.setItem('token', verifyResponse.data);
                router.replace(`/?pid=${pid}${showcase ? `&showcase=${showcase}` : ''}`);
            } else {
                throw new Error("Received unexpected success response from verification server.");
            }

        } catch (error) {
            console.error("handleConfirm error during token verification process:", error);
            const errorMessage = error.message || "Unknown verification process error.";
            setErrMsg(getPromptText('errVerificationProcessFailed') + `: ${errorMessage}`);
            await writeStudentConfirmVerifyError(pid, { message: "Client-side handleConfirm exception", detail: errorMessage });
            setLoadStatus('');
        }
    };


    // --- Render Logic (remains the same) ---
    if (!loaded && !errMsg) {
        return (
            <>
                <TopNavBar
                    titlePromptKey="title"
                    currentLanguage={g_language}
                    onLanguageChange={(langKey) => { g_language = langKey; forceRender(); }}
                    getPromptText={getPromptText}
                />
                <Container className="mt-5 text-center"> <p><b>{loadStatus}</b></p> </Container>
            </>
        );
    }
    if (errMsg) {
        return (
            <>
                <TopNavBar
                    titlePromptKey="title"
                    currentLanguage={g_language}
                    onLanguageChange={(langKey) => { g_language = langKey; forceRender(); }}
                    getPromptText={getPromptText}
                />
                <Container className="mt-5 text-center">
                    <h4>{getPromptText('errorTitle') || 'Error'}</h4>
                    <p style={{ color: "red" }}><b>{errMsg}</b></p>
                    <Button variant="secondary" onClick={() => router.push('/')}>Go Home</Button>
                </Container>
                <BottomNavBar scrollMsg={errMsg} getPromptText={getPromptText} />
            </>
        );
    }
    return (
        <>
            <TopNavBar
                titlePromptKey="title"
                currentLanguage={g_language}
                onLanguageChange={(langKey) => { g_language = langKey; forceRender(); }}
                getPromptText={getPromptText}
            />
            <Container className="mt-4">
                <Row className="justify-content-md-center">
                    <Col md={8} lg={6} className="text-center">
                        <p>{getPromptText("verifyMessage")}</p>
                        <br />
                        <Button
                            onClick={handleConfirm}
                            type="button"
                            variant="primary"
                            size="lg"
                            disabled={loadStatus === getPromptText('verifyingTokenStatus')}
                        >
                            {loadStatus === getPromptText('verifyingTokenStatus')
                                ? (getPromptText('verifyingButton') || 'Verifying...')
                                : <b>{getPromptText("verifyButton")}</b>
                            }
                        </Button>
                        {loadStatus === getPromptText('verifyingTokenStatus') && <p className="mt-2">{loadStatus}</p>}
                    </Col>
                </Row>
            </Container>
            <BottomNavBar scrollMsg={""} getPromptText={getPromptText} />
        </>
    );
};

export default Confirm;
