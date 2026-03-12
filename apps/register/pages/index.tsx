import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getTableItem, getTableItemOrNull, getAllTableItemsFiltered, getAllTableItems, putTableItem, deleteTableItemWithSortKey, checkEligibility, completeOffering } from 'sharedFrontend';
import { ScriptEngine } from '../components/script/ScriptEngine';
import { promptLookup } from '../components/script/StepComponents';
import { getScriptSteps, stepRegistry } from '../config/stepRegistry';
import { ScriptDefinition, ScriptContext, ScriptStep } from '../components/script/types';
import { Offer } from '../components/Offer';
import { useTheme, type ThemeId } from '../context/ThemeContext';

/** One row per storage field for debug table. displayPath uses "events"; storagePath is path into student (no "student." prefix). */
function getStepStorageRows(stepId: string, eventCode: string): Array<{ scriptStep: string; displayPath: string; storagePath: string | null }> {
    const ev = `student.events[${eventCode}]`;
    const rows: Record<string, Array<{ scriptStep: string; displayPath: string; storagePath: string | null }>> = {
        introduction: [{ scriptStep: 'introduction', displayPath: '(no data stored)', storagePath: null }],
        writtenTranslation: [{ scriptStep: 'writtenTranslation', displayPath: 'student.writtenLangPref', storagePath: 'writtenLangPref' }],
        location: [
            { scriptStep: 'location', displayPath: 'student.country', storagePath: 'country' },
            { scriptStep: 'location', displayPath: 'student.stateProvince', storagePath: 'stateProvince' },
            { scriptStep: 'location', displayPath: 'student.city', storagePath: 'city' },
        ],
        whichRetreats: [{ scriptStep: 'whichRetreats', displayPath: `${ev}.whichRetreats`, storagePath: `programs.${eventCode}.whichRetreats` }],
        preferenceNecessity: [{ scriptStep: 'preferenceNecessity', displayPath: `${ev}.prefNec`, storagePath: `programs.${eventCode}.prefNec` }],
        vyOnlineSeries: [{ scriptStep: 'vyOnlineSeries', displayPath: `${ev}.vyOnlineSeries`, storagePath: `programs.${eventCode}.vyOnlineSeries` }],
        mobilePhone: [{ scriptStep: 'mobilePhone', displayPath: 'student.mobilePhone', storagePath: 'mobilePhone' }],
        inPersonTeachings: [{ scriptStep: 'inPersonTeachings', displayPath: 'student.inPersonTeachings', storagePath: 'inPersonTeachings' }],
        interestedInSetup: [{ scriptStep: 'interestedInSetup', displayPath: `${ev}.setup`, storagePath: `programs.${eventCode}.setup` }],
        interestedInTakedown: [{ scriptStep: 'interestedInTakedown', displayPath: `${ev}.interestedInTakedown`, storagePath: `programs.${eventCode}.interestedInTakedown` }],
        healthcareProfessional: [
            { scriptStep: 'healthcareProfessional', displayPath: 'student.healthcareProfessional', storagePath: 'healthcareProfessional' },
            { scriptStep: 'healthcareProfessional', displayPath: 'student.healthcareTraining', storagePath: 'healthcareTraining' },
        ],
        serviceAlready: [
            { scriptStep: 'serviceAlready', displayPath: `${ev}.serviceAlready`, storagePath: `programs.${eventCode}.serviceAlready` },
            { scriptStep: 'serviceAlready', displayPath: `${ev}.serviceAlreadyResponse`, storagePath: `programs.${eventCode}.serviceAlreadyResponse` },
        ],
        serviceNoQuestion: [{ scriptStep: 'serviceNoQuestion', displayPath: `${ev}.service`, storagePath: `programs.${eventCode}.service` }],
        serviceContact: [{ scriptStep: 'serviceContact', displayPath: `${ev}.serviceContact`, storagePath: `programs.${eventCode}.serviceContact` }],
        accessiblity: [
            { scriptStep: 'accessiblity', displayPath: 'student.accessibility', storagePath: 'accessibility' },
            { scriptStep: 'accessiblity', displayPath: 'student.accessibilityDetails', storagePath: 'accessibilityDetails' },
        ],
        supplicationMY: [
            { scriptStep: 'supplicationMY', displayPath: `${ev}.joinMY`, storagePath: `programs.${eventCode}.joinMY` },
            { scriptStep: 'supplicationMY', displayPath: `${ev}.visible`, storagePath: `programs.${eventCode}.visible` },
        ],
        joinMY: [{ scriptStep: 'joinMY', displayPath: `${ev}.joinMY`, storagePath: `programs.${eventCode}.joinMY` }],
        supplicationVY: [
            { scriptStep: 'supplicationVY', displayPath: `${ev}.joinVY`, storagePath: `programs.${eventCode}.joinVY` },
            { scriptStep: 'supplicationVY', displayPath: `${ev}.visible`, storagePath: `programs.${eventCode}.visible` },
        ],
        joinVY: [{ scriptStep: 'joinVY', displayPath: `${ev}.joinVY`, storagePath: `programs.${eventCode}.joinVY` }],
        visibleSignature: [{ scriptStep: 'visibleSignature', displayPath: `${ev}.visible`, storagePath: `programs.${eventCode}.visible` }],
        socialMedia: [{ scriptStep: 'socialMedia', displayPath: `${ev}.socialMedia`, storagePath: `programs.${eventCode}.socialMedia` }],
        save: [
            { scriptStep: 'save', displayPath: `${ev}.join`, storagePath: `programs.${eventCode}.join` },
            { scriptStep: 'save', displayPath: `${ev}.submitCount`, storagePath: `programs.${eventCode}.submitCount` },
            { scriptStep: 'save', displayPath: `${ev}.submitTime`, storagePath: `programs.${eventCode}.submitTime` },
            { scriptStep: 'save', displayPath: `${ev}.saved`, storagePath: `programs.${eventCode}.saved` },
        ],
    };
    return rows[stepId] ?? [{ scriptStep: stepId, displayPath: '—', storagePath: null }];
}

function getValue(obj: any, storagePath: string | null): any {
    if (storagePath == null) return undefined;
    const parts = storagePath.split('.');
    let current: any = obj;
    for (const p of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = current[p];
    }
    return current;
}

function formatDisplayValue(val: any): string {
    if (val === undefined || val === null) return '—';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    try {
        const s = JSON.stringify(val);
        return s.length > 80 ? s.slice(0, 77) + '...' : s;
    } catch {
        return String(val);
    }
}

const THEMES: { id: ThemeId; label: string; subtitle: string }[] = [
    { id: 'light', label: 'Light', subtitle: 'clean, neutral' },
    { id: 'meadow', label: 'Meadow', subtitle: 'warm, natural' },
    { id: 'dark', label: 'Dark', subtitle: 'immersive, elegant' },
];

export default function Home() {
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const { pid, hash, eventCode, aid, ...rest } = router.query;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{ student: any, event: any, prompts: any, pools: any[], signers?: Record<string, string[]> } | null>(null);
    const [scriptDef, setScriptDef] = useState<ScriptDefinition | null>(null);

    // Normalize event code (prefer 'eventCode', fallback to legacy 'aid')
    const activeEventCode = (eventCode || aid) as string;
    const studentPid = pid as string;
    const studentHash = hash as string;

    useEffect(() => {
        if (!router.isReady) return;

        if (!activeEventCode || !studentPid || !studentHash) {
            setError("Missing required URL parameters (pid, hash, eventCode).");
            setLoading(false);
            return;
        }

        async function loadData() {
            try {
                // Fetch student, event, prompts (event + default), and eligibility pools
                const [studentData, eventData, eventPrompts, defaultPrompts, pools, signersList] = await Promise.all([
                    getTableItem('students', studentPid, studentPid, studentHash),
                    getTableItem('events', activeEventCode, studentPid, studentHash),
                    getAllTableItemsFiltered('prompts', 'aid', activeEventCode, studentPid, studentHash),
                    getAllTableItemsFiltered('prompts', 'aid', 'default', studentPid, studentHash),
                    getAllTableItems('pools', studentPid, studentHash),
                    getAllTableItems('signers', studentPid, studentHash),
                ]);

                const eventList = Array.isArray(eventPrompts) ? eventPrompts : [];
                const defaultList = Array.isArray(defaultPrompts) ? defaultPrompts : [];
                const promptsListArray = [...eventList, ...defaultList];
                const poolsArray = Array.isArray(pools) ? pools : [];
                const signersByAid: Record<string, string[]> = {};
                if (Array.isArray(signersList) && !('redirected' in signersList)) {
                    (signersList as { name?: string; aid?: string }[]).forEach((row) => {
                        const aid = row.aid;
                        const name = row.name;
                        if (aid != null && name != null) {
                            if (!signersByAid[aid]) signersByAid[aid] = [];
                            signersByAid[aid].push(name);
                        }
                    });
                }

                setData({ student: studentData, event: eventData, prompts: promptsListArray, pools: poolsArray, signers: signersByAid });

                // Build Script Definition
                let steps: ScriptStep[] = [];
                // Check if event has inline script definition (optional override)
                if (eventData.config && eventData.config.scriptSteps) {
                    steps = getScriptSteps(eventData.config.scriptSteps);
                }
                // Otherwise lookup script by name from 'scripts' table
                else if (eventData.config && eventData.config.scriptName) {
                    const scriptRecord = await getTableItem('scripts', eventData.config.scriptName, studentPid, studentHash);
                    // access 'steps' property from script record
                    if (scriptRecord && scriptRecord.steps) {
                        steps = getScriptSteps(scriptRecord.steps);
                    } else {
                        console.warn(`Script not found or empty for name: ${eventData.config.scriptName}`);
                    }
                }

                if (steps.length > 0) {
                    setScriptDef({ steps: [stepRegistry['introduction'], ...steps] });
                } else {
                    console.warn("No scriptSteps found in event config or scripts table.");
                    setScriptDef({ steps: [] });
                }

                setLoading(false);
            } catch (err: any) {
                console.error("Data load failed", err);
                setError(err.message || "Failed to load registration data.");
                setLoading(false);
            }
        }

        loadData();
    }, [router.isReady, activeEventCode, studentPid, studentHash]);

    // Initial theme from event config (default meadow). In test mode, skip so theme can be chosen on the test config page.
    useEffect(() => {
        if (!data?.event?.config || data?.student?.debug?.registerTest === true) return;
        const raw = data.event.config.registrationTheme;
        const themeId: ThemeId = raw === 'dark' || raw === 'light' || raw === 'meadow' ? raw : 'meadow';
        setTheme(themeId);
    }, [data?.event?.config?.registrationTheme, data?.student?.debug?.registerTest, setTheme]);

    /** Refetch student so phase effect sees up-to-date offeringHistory (e.g. after same-page payment completion). */
    const refetchStudent = useCallback(async () => {
        if (!studentPid || !studentHash) return;
        try {
            const studentData = await getTableItem('students', studentPid, studentPid, studentHash);
            if (studentData && !(studentData as any).redirected) {
                setData((prev) => (prev ? { ...prev, student: studentData } : prev));
            }
        } catch (err) {
            console.error('Refetch student after offering failed', err);
        }
    }, [studentPid, studentHash]);

    // Determine Initial Phase
    const [phase, setPhase] = useState<
        | 'loading'
        | 'testModeConfig'
        | 'join'
        | 'offer'
        | 'stripeCapture'
        | 'debugTable'
        | 'acceptanceThankYouWarm'
        | 'acceptanceThankYouCold'
        | 'offeringCompleteCold'
    >('loading');
    const [stripeCaptureStatus, setStripeCaptureStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
    const [stripeCaptureError, setStripeCaptureError] = useState<string | null>(null);
    /** When phase is offeringCompleteCold: 'warm' = just completed via Stripe callback this session; 'cold' = loaded with existing offering. */
    const [offeringCompleteVariant, setOfferingCompleteVariant] = useState<'warm' | 'cold'>('cold');

    // Test mode config: clear student data options, oath pool eligibility override
    const [testModeClearStudent, setTestModeClearStudent] = useState(false);
    const [testModeClearStudentKeepPrograms, setTestModeClearStudentKeepPrograms] = useState(false);
    const [testModeOathEligibility, setTestModeOathEligibility] = useState<'actual' | 'true' | 'false'>('actual');
    const [testModeConfigAccepted, setTestModeConfigAccepted] = useState(false);

    useEffect(() => {
        if (!data) return;

        const { student, event } = data;

        // Stripe callback: URL has payment_intent.
        // If this PaymentIntent is already recorded in offeringHistory, skip capture and
        // let the normal offer/completion logic run (hasAnyOffering + unpaid subevents).
        // Otherwise, route through the stripeCapture phase and avoid double-processing.
        if (router.query.payment_intent) {
            const rawPi = router.query.payment_intent;
            const paymentIntentId = Array.isArray(rawPi) ? rawPi[0] : rawPi;
            const progForPi = student.programs?.[activeEventCode];
            const historyForPi = progForPi?.offeringHistory || {};
            const alreadyAccounted =
                typeof paymentIntentId === 'string' &&
                Object.values(historyForPi).some(
                    (entry: any) => entry && entry.offeringIntent === paymentIntentId,
                );

            if (!alreadyAccounted) {
                if (
                    phase === 'stripeCapture' ||
                    phase === 'acceptanceThankYouWarm' ||
                    phase === 'acceptanceThankYouCold'
                ) {
                    return;
                }
                setPhase('stripeCapture');
                return;
            }
            // Fall through when alreadyAccounted === true
        }

        // Test mode: show config landing before script (only until user clicks Start Registration Test)
        if (student?.debug?.registerTest === true && !testModeConfigAccepted) {
            setPhase('testModeConfig');
            return;
        }

        // Check if already joined (supplication step complete: join and visibility must both be set)
        const prog = student.programs?.[activeEventCode];
        const hasJoinYes = prog?.join === true || prog?.joinMY === true || prog?.joinVY === true;
        const hasVisibility = typeof prog?.visible === 'boolean';
        const isJoined = hasJoinYes && hasVisibility;
        const accepted = prog?.accepted;
        const offerOnly = event.config?.offerOnly;
        const needAcceptance = event.config?.needAcceptance === true;
        const hasAnyOffering =
            !!prog?.offeringHistory && Object.keys(prog.offeringHistory).length > 0;

        // For nextAndRemaining: only show terminal "offeringCompleteCold" when all subevents are paid.
        const offeringPresentation = event.config?.offeringPresentation as string | undefined;
        const subEventsObj = event.subEvents || {};
        const offeringHistory = prog?.offeringHistory || {};
        const unpaidSubEvents = Object.keys(subEventsObj).filter((name) => !offeringHistory[name]);
        const hasUnpaidSubEvents = unpaidSubEvents.length > 0;

        // If an offering has already been recorded for this event:
        // - when nextAndRemaining and there are unpaid subevents, stay on the offering card
        // - otherwise, show the terminal "offeringCompleteCold" card.
        if (hasAnyOffering) {
            if (offeringPresentation === 'nextAndRemaining' && hasUnpaidSubEvents) {
                // Do not override the just-completed warm card; only redirect to offer
                // when we're not currently showing the warm completion variant.
                if (!(phase === 'offeringCompleteCold' && offeringCompleteVariant === 'warm')) {
                    if (phase !== 'offer') {
                        setPhase('offer');
                    }
                }
            } else {
                if (phase !== 'offeringCompleteCold' && phase !== 'debugTable') {
                    setPhase('offeringCompleteCold');
                    setOfferingCompleteVariant('cold');
                }
            }
            return;
        }

        if (offerOnly) {
            setPhase('offer');
            return;
        }
        // Only transition to offer/acceptance from data when not already in join (so answering visibility + Next is required).
        // Do not overwrite the warm completion screen (just-completed same-page payment) when data is still stale.
        if (
            isJoined &&
            phase !== 'join' &&
            !(phase === 'offeringCompleteCold' && offeringCompleteVariant === 'warm')
        ) {
            if (needAcceptance) {
                if (accepted === true) {
                    setPhase('offer');
                } else if (phase !== 'acceptanceThankYouWarm' && phase !== 'debugTable') {
                    setPhase('acceptanceThankYouCold');
                }
            } else {
                setPhase('offer');
            }
            return;
        }
        setPhase('join');
    }, [data, router.query, activeEventCode, testModeConfigAccepted, phase, offeringCompleteVariant]);

    // Stripe capture phase: after Stripe redirects back with payment_intent in the URL.
    useEffect(() => {
        if (phase !== 'stripeCapture') return;
        if (!data) return;

        const rawPi = router.query.payment_intent;
        const paymentIntentId = Array.isArray(rawPi) ? rawPi[0] : rawPi;
        if (!paymentIntentId || typeof paymentIntentId !== 'string') return;
        // Only run capture once per load; do not loop on error.
        if (stripeCaptureStatus !== 'idle') return;

        const runCapture = async () => {
            try {
                setStripeCaptureStatus('processing');
                setStripeCaptureError(null);

                // Optional: if redirect_status is present and not succeeded, don't attempt completion.
                const redirectStatus = router.query.redirect_status;
                if (redirectStatus && redirectStatus !== 'succeeded') {
                    throw new Error('Stripe reported that the payment was not completed. No charge was finalized.');
                }

                // Load transaction/cart from offering-transactions table.
                const tx = await getTableItemOrNull('offering-transactions', paymentIntentId, studentPid, studentHash);
                if (!tx || (tx as any).redirected) {
                    throw new Error('We could not find your payment record. If you just paid, please wait a moment and refresh, or contact support with your Payment Intent ID.');
                }

                // If backend already marked this as succeeded (e.g. user reloaded callback URL), show cold thank-you.
                if ((tx as any).status === 'succeeded') {
                    setStripeCaptureStatus('success');
                    setOfferingCompleteVariant('cold');
                    setPhase('offeringCompleteCold');
                    return;
                }

                const cart = (tx as any).cart || [];
                const eventCodeForTx = (tx as any).eventCode || activeEventCode;
                const subEventNames = Object.keys(data.event?.subEvents || {});

                await completeOffering(studentPid, studentHash, {
                    paymentIntentId,
                    pid: studentPid,
                    eventCode: eventCodeForTx,
                    cart,
                    subEventNames,
                });

                setStripeCaptureStatus('success');
                setOfferingCompleteVariant('warm');
                setPhase('offeringCompleteCold');
            } catch (err: any) {
                console.error('Stripe capture completion failed', err);
                setStripeCaptureStatus('error');
                setStripeCaptureError(err.message || 'Failed to finalize your offering. Please contact support.');
            }
        };

        runCapture();
    }, [phase, data, router.query.payment_intent, activeEventCode, studentPid, studentHash, stripeCaptureStatus]);

    const handleScriptChange = (path: string, value: any) => {
        if (!data) return;

        const newStudent = JSON.parse(JSON.stringify(data.student));
        const pathFromStudent = path.startsWith('student.') ? path.slice(8) : path;
        const parts = pathFromStudent.split('.');
        let current: any = newStudent;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) current[parts[i]] = {};
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;

        // When visible signature changes: optimistically update displayed signers, then persist and refetch
        const visibleMatch = path.match(/^student\.programs\.([^.]+)\.visible$/);
        if (visibleMatch) {
            const eventCode = visibleMatch[1];
            const name = [newStudent.first, newStudent.last].filter(Boolean).join(' ').trim();
            const event = data.event;
            const whichRetreatsConfig = event?.config?.whichRetreatsConfig;
            const whichRetreats = newStudent.programs?.[eventCode]?.whichRetreats || {};
            const aids: string[] = whichRetreatsConfig
                ? [
                    ...(whichRetreats.mahayana ? [`${eventCode}-my`] : []),
                    ...(whichRetreats.vajrayana1 || whichRetreats.vajrayana2 ? [`${eventCode}-vy`] : []),
                ]
                : [eventCode];
            if (aids.length === 0) aids.push(eventCode);

            const prevSigners = data.signers ?? {};
            const nextSigners = { ...prevSigners };
            for (const aid of aids) {
                const list = [...(nextSigners[aid] ?? [])];
                if (value === true && name && !list.includes(name)) {
                    list.push(name);
                    nextSigners[aid] = list;
                } else if (value === false && name) {
                    nextSigners[aid] = list.filter((n) => n !== name);
                }
            }
            setData({ ...data, student: newStudent, signers: nextSigners });

            (async () => {
                try {
                    for (const aid of aids) {
                        if (value === true) {
                            if (name) {
                                await putTableItem('signers', encodeURIComponent(name), { name, aid }, studentPid, studentHash);
                            }
                        } else {
                            await deleteTableItemWithSortKey('signers', 'name', name, 'aid', aid, studentPid, studentHash);
                        }
                    }
                    const signersList = await getAllTableItems('signers', studentPid, studentHash);
                    const signersByAid: Record<string, string[]> = {};
                    if (Array.isArray(signersList) && !('redirected' in signersList)) {
                        (signersList as { name?: string; aid?: string }[]).forEach((row) => {
                            const a = row.aid;
                            const n = row.name;
                            if (a != null && n != null) {
                                if (!signersByAid[a]) signersByAid[a] = [];
                                signersByAid[a].push(n);
                            }
                        });
                    }
                    setData((prev) => (prev ? { ...prev, signers: signersByAid } : prev));
                } catch (err: any) {
                    console.error('Signers table update failed', err);
                }
            })();
        } else {
            setData({ ...data, student: newStudent });
        }
    };

    const handleJoinComplete = async () => {
        // Optimistic update
        if (!data) return;
        const newStudent = { ...data.student };
        if (!newStudent.programs) newStudent.programs = {};
        if (!newStudent.programs[activeEventCode]) newStudent.programs[activeEventCode] = {};
        newStudent.programs[activeEventCode].join = true;

        // In reality, the 'Join' script should have already saved this via API calls in its last step
        // But we ensure local state reflects it to switch phase
        setData({ ...data, student: newStudent });
        setPhase('offer');
    };

    const handleShowDebugTable = () => {
        setPhase('debugTable');
    };

    const handleTestModeConfigContinue = () => {
        if (!data) return;
        setTestModeConfigAccepted(true);
        let student = data.student;
        if (testModeClearStudent) {
            const keepKeys = ['id', 'first', 'last', 'email', 'debug'];
            student = Object.fromEntries(
                keepKeys.filter((k) => student[k] !== undefined).map((k) => [k, student[k]])
            ) as any;
        } else if (testModeClearStudentKeepPrograms) {
            const keepKeys = ['id', 'first', 'last', 'email', 'debug', 'programs'];
            student = Object.fromEntries(
                keepKeys.filter((k) => student[k] !== undefined).map((k) => [k, student[k]])
            ) as any;
        }
        setData({ ...data, student });
        setPhase('join');
    };

    const handleLastStepNext = async () => {
        if (!data) return;
        const student = JSON.parse(JSON.stringify(data.student));
        student.programs = student.programs || {};
        if (!student.programs[activeEventCode]) student.programs[activeEventCode] = {};
        student.programs[activeEventCode].join = true;
        student.programs[activeEventCode].submitCount = (student.programs[activeEventCode].submitCount ?? 0) + 1;
        student.programs[activeEventCode].submitTime = new Date().toISOString();
        student.programs[activeEventCode].saved = true;

        const needAcceptance = data.event?.config?.needAcceptance === true;
        const isTestMode = data.student?.debug?.registerTest === true;

        if (isTestMode) {
            setData({ ...data, student });
            if (needAcceptance) {
                setPhase('acceptanceThankYouWarm');
            } else {
                setOfferingCompleteVariant('warm');
                setPhase('offeringCompleteCold');
            }
            return;
        }
        try {
            await putTableItem('students', studentPid, student, studentPid, studentHash);
            setData({ ...data, student });
            setPhase(needAcceptance ? 'acceptanceThankYouWarm' : 'offer');
        } catch (err: any) {
            console.error('Save failed on last step', err);
        }
    };

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-reg-page text-reg-error">
                <div className="p-4 border border-reg-error rounded bg-reg-error-bg">
                    <h1 className="text-xl font-bold mb-2">Error</h1>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (loading || phase === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-reg-page text-reg-text">
                <div className="animate-pulse">Loading Registration...</div>
            </div>
        );
    }

    if (!data || !scriptDef) return null;

    const oathEligibilityOverride =
        data.student?.debug?.registerTest === true && testModeOathEligibility !== 'actual'
            ? (testModeOathEligibility === 'true')
            : undefined;

    const context: ScriptContext = {
        student: data.student,
        event: data.event,
        config: data.event.config,
        prompts: data.prompts,
        pools: data.pools,
        signers: data.signers || {},
        pid: studentPid,
        hash: studentHash,
        onComplete: handleJoinComplete,
        onDebugTableRequest: handleShowDebugTable,
        onLastStepNext: handleLastStepNext,
        checkEligibility: (oathEligibilityOverride === undefined)
            ? undefined
            : (poolName: string, studentData: any, currentAid: string, allPoolsData: any[]) => {
                if (poolName === 'oath') return !!oathEligibilityOverride;
                return checkEligibility(poolName, studentData, currentAid, allPoolsData);
            },
    };

    const titleText = promptLookup(context, 'title') || data.event.name || '';
    const titleLines = titleText.split(/<br\s*\/?>/i);

    const eventPool = data.event?.config?.pool;
    const checkEligForEvent = context.checkEligibility ?? checkEligibility;
    const isEligibleForEvent =
        data.student?.debug?.registerTest === true && testModeOathEligibility !== 'actual'
            ? (testModeOathEligibility === 'true')
            : (!eventPool || checkEligForEvent(eventPool, data.student, activeEventCode, data.pools || []));

    const rawEventImage = data.event?.config?.eventImage ?? context.config?.eventImage;
    const eventImageUrl =
        typeof rawEventImage === 'string' && (rawEventImage.startsWith('http://') || rawEventImage.startsWith('https://'))
            ? rawEventImage
            : null;

    return (
        <div className="min-h-screen bg-reg-page text-reg-text font-sans">
            <Head>
                <title>{titleText.replace(/<br\s*\/?>/gi, ' ') || 'Registration'}</title>
            </Head>

            <main className="container mx-auto py-8 px-4">
                <h1 className="text-3xl font-bold mb-8 text-center text-reg-accent">
                    {titleLines.map((line: string, i: number) => (
                        <React.Fragment key={i}>
                            {i > 0 && <br />}
                            {line}
                        </React.Fragment>
                    ))}
                </h1>

                {phase === 'testModeConfig' && data && (
                    <div className="max-w-xl mx-auto space-y-6 p-6 rounded-lg border border-reg-border bg-reg-card-muted">
                        <h2 className="text-xl font-semibold text-reg-accent">Registration Test</h2>
                        <div>
                            <p className="text-reg-muted mb-2">Choose a theme for the registration flow:</p>
                            <div className="flex flex-wrap gap-3">
                                {THEMES.map((t) => (
                                    <label
                                        key={t.id}
                                        className={`flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                            theme === t.id
                                                ? 'border-reg-accent bg-reg-card'
                                                : 'border-reg-border bg-reg-card-muted hover:border-reg-border-light'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="theme"
                                            value={t.id}
                                            checked={theme === t.id}
                                            onChange={() => setTheme(t.id)}
                                            className="sr-only"
                                        />
                                        <span className="font-medium text-reg-text">{t.label}</span>
                                        <span className="text-sm text-reg-muted">{t.subtitle}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-reg-muted text-sm mt-2">
                                Light uses a cool grey page and bright white cards; Meadow uses a warm parchment background and a deeper teal-green accent for a softer, more natural look.
                            </p>
                        </div>
                        <p className="text-reg-muted">
                            The data this test is using comes from student{' '}
                            <span className="font-medium text-reg-text">
                                {[data.student?.first, data.student?.last].filter(Boolean).join(' ') || '(no name)'}
                            </span>
                            .
                        </p>
                        <div className="space-y-4">
                            <label className="flex items-start gap-3 text-reg-muted">
                                <input
                                    type="checkbox"
                                    checked={testModeClearStudent}
                                    onChange={(e) => {
                                        setTestModeClearStudent(e.target.checked);
                                        if (e.target.checked) setTestModeClearStudentKeepPrograms(false);
                                    }}
                                    className="mt-1 rounded text-reg-accent"
                                />
                                <span>Clear ALL student data to impersonate a first encounter student.</span>
                            </label>
                            <label className="flex items-start gap-3 text-reg-muted">
                                <input
                                    type="checkbox"
                                    checked={testModeClearStudentKeepPrograms}
                                    onChange={(e) => {
                                        setTestModeClearStudentKeepPrograms(e.target.checked);
                                        if (e.target.checked) setTestModeClearStudent(false);
                                    }}
                                    className="mt-1 rounded text-reg-accent"
                                />
                                <span>Clear student data, but leave event attendance history.</span>
                            </label>
                            <div>
                                <p className="text-reg-muted mb-2">Test student&apos;s eligibility in the &apos;oath&apos; pool (override for this run):</p>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-reg-muted">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'actual'}
                                            onChange={() => setTestModeOathEligibility('actual')}
                                            className="text-reg-accent"
                                        />
                                        Use actual
                                    </label>
                                    <label className="flex items-center gap-2 text-reg-muted">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'false'}
                                            onChange={() => setTestModeOathEligibility('false')}
                                            className="text-reg-accent"
                                        />
                                        Override: false
                                    </label>
                                    <label className="flex items-center gap-2 text-reg-muted">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'true'}
                                            onChange={() => setTestModeOathEligibility('true')}
                                            className="text-reg-accent"
                                        />
                                        Override: true
                                    </label>
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleTestModeConfigContinue}
                            className="px-4 py-2 rounded bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover"
                        >
                            Start Registration Test
                        </button>
                    </div>
                )}

                {phase === 'join' && !isEligibleForEvent && (
                    <div className="max-w-xl mx-auto p-6 rounded-lg border border-reg-border bg-reg-card-muted">
                        <h2 className="text-xl font-semibold text-reg-accent">
                            {promptLookup(context, 'notEligible') || 'Not eligible'}
                        </h2>
                    </div>
                )}
                {phase === 'join' && isEligibleForEvent && (
                    <ScriptEngine
                        definition={scriptDef}
                        context={context}
                        onChange={handleScriptChange}
                        onComplete={handleJoinComplete}
                    />
                )}

                {(phase === 'acceptanceThankYouWarm' || phase === 'acceptanceThankYouCold' || phase === 'offeringCompleteCold') && (
                    <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text">
                        {eventImageUrl && (
                            <img
                                src={eventImageUrl}
                                alt={data.event?.name ? `Event: ${data.event.name}` : 'Event'}
                                className="w-full h-auto block"
                            />
                        )}
                        <div className="p-6">
                            <div className="text-reg-text">
                                {(() => {
                                    const key =
                                        phase === 'offeringCompleteCold'
                                            ? (offeringCompleteVariant === 'warm' ? 'offeringCompleteWarm' : 'offeringCompleteCold')
                                            : phase === 'acceptanceThankYouWarm'
                                                ? 'applyThankYouWarm'
                                                : 'applyThankYouCold';
                                    let html = promptLookup(context, key) || '';
                                    const title = promptLookup(context, 'title') || '';
                                    const coordEmail =
                                        context.event?.config?.coordEmailAmericas ??
                                        context.event?.config?.coordEmailEurope ??
                                        '';
                                    html = html.replace(/\|\|title\|\|/g, title);
                                    html = html.replace(/\|\|coord-email\|\|/g, coordEmail);
                                    return <span dangerouslySetInnerHTML={{ __html: html }} />;
                                })()}
                            </div>
                            {data?.student?.debug?.registerTest === true && (
                                <div className="mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setPhase('debugTable')}
                                        className="px-4 py-2 rounded bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover"
                                    >
                                        Test Mode Summary
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {phase === 'offer' && (
                    <Offer
                        context={context}
                        onComplete={async () => {
                          await refetchStudent();
                          setOfferingCompleteVariant('warm');
                          setPhase('offeringCompleteCold');
                        }}
                      />
                )}

                {phase === 'stripeCapture' && (
                    <div className="max-w-xl mx-auto p-6 text-reg-text">
                        <p className="mb-2 font-semibold">
                            {promptLookup(context, 'stripeCaptureLoading') || 'Finalizing your offering…'}
                        </p>
                        <p className="text-sm text-reg-muted">
                            {promptLookup(context, 'stripeCaptureLoadingBody') ||
                                'Please wait while we finalize your offering. You can refresh this page if it takes too long.'}
                        </p>
                        {stripeCaptureStatus === 'error' && stripeCaptureError && (
                            <div className="mt-3">
                                {promptLookup(context, 'stripeCaptureErrorIntro') && (
                                    <p className="text-sm text-reg-error mb-1">
                                        {promptLookup(context, 'stripeCaptureErrorIntro')}
                                    </p>
                                )}
                                <p className="text-sm text-reg-error">{stripeCaptureError}</p>
                            </div>
                        )}
                    </div>
                )}

                {phase === 'debugTable' && scriptDef && data && (
                    <div className="max-w-4xl mx-auto">
                        <h2 className="text-xl font-semibold mb-4 text-reg-accent">Test Mode - Data not saved.</h2>
                        <div className="overflow-x-auto rounded border border-reg-border">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-reg-border-light bg-reg-card">
                                        <th className="px-4 py-3 text-reg-accent font-medium">Script step</th>
                                        <th className="px-4 py-3 text-reg-accent font-medium">Data will be stored to</th>
                                        <th className="px-4 py-3 text-reg-accent font-medium">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...scriptDef.steps, { id: 'save' }].flatMap((step) =>
                                        getStepStorageRows(step.id, activeEventCode).map((row, i) => (
                                            <tr key={`${step.id}-${i}`} className="border-b border-reg-border">
                                                <td className="px-4 py-2 text-reg-text">{row.scriptStep}</td>
                                                <td className="px-4 py-2 text-reg-muted font-mono text-sm">{row.displayPath}</td>
                                                <td className="px-4 py-2 text-reg-muted font-mono text-sm max-w-xs truncate" title={formatDisplayValue(getValue(data.student, row.storagePath))}>
                                                    {formatDisplayValue(getValue(data.student, row.storagePath))}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-6">
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 rounded bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover"
                            >
                                Test Again
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
