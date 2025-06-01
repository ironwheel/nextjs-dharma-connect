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
import { getFingerprint } from '@dharma/shared';
import { dbgOut, dbgPrompt as studentDbgPrompt, dbgout as studentDbgout } from '@dharma/shared';
import { promptLookup as basePromptLookup } from '@dharma/shared';
import { callDbApi, getPromptsFromDbApi, writeProgramError } from '@dharma/shared';
import { TopNavBar, BottomNavBar } from "@dharma/shared";

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

    useEffect(() => {
        if (!router.isReady) return;

        if (queryLanguage) {
            g_language = queryLanguage;
        }

        // Fetch prompts using the shared utility
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
        }).catch(error => {
            setErrMsg(`Error loading essential resources: ${error.message}`);
        });

    }, [router.isReady, pid, token, queryLanguage, forceRender]); // Dependencies

    /**
     * Handles the confirmation button click. Uses /api/auth for verification.
     * @async
     * @function handleConfirm
     */
    const handleConfirm = async () => {
        if (!pid || !token) {
            setErrMsg(getPromptText('errMissingPIDOrToken'));
            return;
        }
        setLoadStatus(getPromptText('verifyingTokenStatus'));

        try {
            const ip = await publicIpv4().catch(() => null);
            const fingerprintId = await getFingerprint().catch(() => null);

            const response = await fetch("/api/auth", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'verifyConfirm',
                    pid,
                    ip,
                    fingerprint: fingerprintId,
                    token
                })
            });

            if (!response.ok) {
                console.error(`Verify Confirm API Error: ${response.status} ${response.statusText}`);
                const errorData = await response.json().catch(() => ({ data: { err: `HTTP error ${response.status}` } }));
                const reason = errorData.data?.reason ? `: ${errorData.data.reason}` : '';
                setErrMsg(getPromptText('errVerificationFailed') + reason);
                await writeProgramError(pid, 'confirmVerifyError', 'confirmVerifyErrorTime', `API Error ${response.status}${reason}`);
                setLoadStatus('');
                return;
            }

            const verifyResponse = await response.json();

            if (verifyResponse.data?.accessToken) {
                console.log("VERIFIED, received access token.");
                localStorage.setItem('token', verifyResponse.data.accessToken);
                router.replace(`/?pid=${pid}${showcase ? `&showcase=${showcase}` : ''}`);
            } else if (verifyResponse.data?.err) {
                throw new Error(verifyResponse.data.err);
            } else {
                throw new Error("Received unexpected response format from verification server.");
            }

        } catch (error) {
            console.error("handleConfirm error during token verification process:", error);
            const errorMessage = error.message || "Unknown verification process error.";
            setErrMsg(getPromptText('errVerificationProcessFailed') + `: ${errorMessage}`);
            await writeProgramError(pid, 'confirmVerifyError', 'confirmVerifyErrorTime', { message: "Client-side handleConfirm exception", detail: errorMessage });
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
