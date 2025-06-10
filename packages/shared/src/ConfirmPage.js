/**
 * @file packages/shared/src/ConfirmPage.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared confirmation page component used in both dashboards.
 * It verifies a token received via URL parameters and, on success,
 * stores an access token before redirecting to the main dashboard.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from 'next/router';
import { Container, Form, Row, Button, Col } from "react-bootstrap";
import { publicIpv4 } from 'public-ip';

// Shared utilities and components from the shared package
import { getFingerprint } from './fingerprint';
import { dbgPrompt as studentDbgPrompt, dbgout as studentDbgout } from './debugUtils';
import { promptLookup as basePromptLookup } from './promptUtils';
import { getPromptsFromDbApi, writeProgramError } from './apiUtils';
import { TopNavBar, BottomNavBar } from "./SharedLayout";

// Module-level variables to store prompts and current language
let masterPrompts = [];
let g_language = 'English';

/**
 * Wrapper around the basePromptLookup utility providing context for this page.
 * @function getPromptText
 * @param {string} key - The prompt key to look up.
 * @returns {string} The localized prompt text.
 */
const getPromptText = (key) => {
    return basePromptLookup(masterPrompts, key, g_language, 'dashboard', () => studentDbgPrompt(null), (...args) => studentDbgout(null, ...args));
};

/**
 * Component containing the confirmation logic previously in the student dashboard.
 * @function ConfirmPage
 * @returns {React.Component} Rendered confirmation page UI.
 */
export const ConfirmPage = () => {
    const [errMsg, setErrMsg] = useState("");
    const [value, setValue] = useState(0); // For forceRender
    const [loaded, setLoaded] = useState(false);
    const [loadStatus, setLoadStatus] = useState("Loading confirmation...");

    const router = useRouter();
    const { pid, token, language: queryLanguage, showcase } = router.query;

    /**
     * Forces a component re-render.
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

        // Fetch prompts and initialize state
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

    }, [router.isReady, pid, token, queryLanguage, forceRender]);

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

    // --- Render Logic ---
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
