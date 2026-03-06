import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getTableItem, getAllTableItemsFiltered, getAllTableItems, putTableItem, deleteTableItemWithSortKey, checkEligibility } from 'sharedFrontend';
import { ScriptEngine } from '../components/script/ScriptEngine';
import { promptLookup } from '../components/script/StepComponents';
import { getScriptSteps, stepRegistry } from '../config/stepRegistry';
import { ScriptDefinition, ScriptContext, ScriptStep } from '../components/script/types';
import { Offer } from '../components/Offer';

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
        save: [{ scriptStep: 'save', displayPath: `${ev} (metadata: join, submitCount, submitTime, saved)`, storagePath: null }],
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

export default function Home() {
    const router = useRouter();
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

    // Determine Initial Phase
    const [phase, setPhase] = useState<'loading' | 'testModeConfig' | 'join' | 'offer' | 'stripeCapture' | 'debugTable'>('loading');

    // Test mode config: clear student data options, oath pool eligibility override
    const [testModeClearStudent, setTestModeClearStudent] = useState(false);
    const [testModeClearStudentKeepPrograms, setTestModeClearStudentKeepPrograms] = useState(false);
    const [testModeOathEligibility, setTestModeOathEligibility] = useState<'actual' | 'true' | 'false'>('actual');
    const [testModeConfigAccepted, setTestModeConfigAccepted] = useState(false);

    useEffect(() => {
        if (!data) return;

        const { student, event } = data;

        // Check for payment intent (Stripe Callback)
        if (router.query.payment_intent) {
            setPhase('stripeCapture');
            return;
        }

        // Test mode: show config landing before script (only until user clicks Start Registration Test)
        if (student?.debug?.registerTest === true && !testModeConfigAccepted) {
            setPhase('testModeConfig');
            return;
        }

        // Check if already joined
        const prog = student.programs?.[activeEventCode];
        const isJoined = prog?.join;
        const offerOnly = event.config?.offerOnly;

        if (offerOnly || isJoined) {
            setPhase('offer');
        } else {
            setPhase('join');
        }

    }, [data, router.query, activeEventCode, testModeConfigAccepted]);

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
        if (data.student?.debug?.registerTest === true) {
            setPhase('debugTable');
            return;
        }
        try {
            const student = JSON.parse(JSON.stringify(data.student));
            student.programs = student.programs || {};
            if (!student.programs[activeEventCode]) student.programs[activeEventCode] = {};
            student.programs[activeEventCode].join = true;
            student.programs[activeEventCode].submitCount = (student.programs[activeEventCode].submitCount ?? 0) + 1;
            student.programs[activeEventCode].submitTime = new Date().toISOString();
            student.programs[activeEventCode].saved = true;
            await putTableItem('students', studentPid, student, studentPid, studentHash);
            setData({ ...data, student });
            setPhase('offer');
        } catch (err: any) {
            console.error('Save failed on last step', err);
        }
    };

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-red-400">
                <div className="p-4 border border-red-800 rounded bg-red-900/10">
                    <h1 className="text-xl font-bold mb-2">Error</h1>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (loading || phase === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
                <div className="animate-pulse">Loading Registration...</div>
            </div>
        );
    }

    if (!data || !scriptDef) return null;

    const oathEligibilityOverride =
        phase === 'join' && data.student?.debug?.registerTest && testModeOathEligibility !== 'actual'
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
    const isEligibleForEvent = !eventPool || checkEligForEvent(eventPool, data.student, activeEventCode, data.pools || []);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Head>
                <title>{titleText.replace(/<br\s*\/?>/gi, ' ') || 'Registration'}</title>
            </Head>

            <main className="container mx-auto py-8 px-4">
                <h1 className="text-3xl font-bold mb-8 text-center text-teal-400">
                    {titleLines.map((line, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <br />}
                            {line}
                        </React.Fragment>
                    ))}
                </h1>

                {phase === 'testModeConfig' && data && (
                    <div className="max-w-xl mx-auto space-y-6 p-6 rounded-lg border border-slate-700 bg-slate-800/50">
                        <h2 className="text-xl font-semibold text-teal-400">Registration Test</h2>
                        <p className="text-slate-300">
                            The data this test is using comes from student{' '}
                            <span className="font-medium text-white">
                                {[data.student?.first, data.student?.last].filter(Boolean).join(' ') || '(no name)'}
                            </span>
                            .
                        </p>
                        <div className="space-y-4">
                            <label className="flex items-start gap-3 text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={testModeClearStudent}
                                    onChange={(e) => {
                                        setTestModeClearStudent(e.target.checked);
                                        if (e.target.checked) setTestModeClearStudentKeepPrograms(false);
                                    }}
                                    className="mt-1 rounded text-teal-500"
                                />
                                <span>Clear ALL student data to impersonate a first encounter student.</span>
                            </label>
                            <label className="flex items-start gap-3 text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={testModeClearStudentKeepPrograms}
                                    onChange={(e) => {
                                        setTestModeClearStudentKeepPrograms(e.target.checked);
                                        if (e.target.checked) setTestModeClearStudent(false);
                                    }}
                                    className="mt-1 rounded text-teal-500"
                                />
                                <span>Clear student data, but leave event attendance history.</span>
                            </label>
                            <div>
                                <p className="text-slate-300 mb-2">Test student&apos;s eligibility in the &apos;oath&apos; pool (override for this run):</p>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-slate-300">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'actual'}
                                            onChange={() => setTestModeOathEligibility('actual')}
                                            className="text-teal-500"
                                        />
                                        Use actual
                                    </label>
                                    <label className="flex items-center gap-2 text-slate-300">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'false'}
                                            onChange={() => setTestModeOathEligibility('false')}
                                            className="text-teal-500"
                                        />
                                        Override: false
                                    </label>
                                    <label className="flex items-center gap-2 text-slate-300">
                                        <input
                                            type="radio"
                                            name="oathEligibility"
                                            checked={testModeOathEligibility === 'true'}
                                            onChange={() => setTestModeOathEligibility('true')}
                                            className="text-teal-500"
                                        />
                                        Override: true
                                    </label>
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleTestModeConfigContinue}
                            className="px-4 py-2 rounded bg-teal-600 text-white hover:bg-teal-500"
                        >
                            Start Registration Test
                        </button>
                    </div>
                )}

                {phase === 'join' && !isEligibleForEvent && (
                    <div className="max-w-xl mx-auto p-6 rounded-lg border border-slate-700 bg-slate-800/50">
                        <h2 className="text-xl font-semibold text-teal-400">
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

                {phase === 'offer' && (
                    <Offer context={context} onComplete={() => console.log("Offer complete")} />
                )}

                {phase === 'stripeCapture' && (
                    <div>Stripe Capture... (Loading...)</div>
                    // Logic to capture stripe intent would go here or in Offer component
                )}

                {phase === 'debugTable' && scriptDef && data && (
                    <div className="max-w-4xl mx-auto">
                        <h2 className="text-xl font-semibold mb-4 text-teal-400">Test Mode - Data not saved.</h2>
                        <div className="overflow-x-auto rounded border border-slate-700">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-slate-600 bg-slate-800/80">
                                        <th className="px-4 py-3 text-teal-400 font-medium">Script step</th>
                                        <th className="px-4 py-3 text-teal-400 font-medium">Data will be stored to</th>
                                        <th className="px-4 py-3 text-teal-400 font-medium">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scriptDef.steps.flatMap((step) =>
                                        getStepStorageRows(step.id, activeEventCode).map((row, i) => (
                                            <tr key={`${step.id}-${i}`} className="border-b border-slate-700/80">
                                                <td className="px-4 py-2 text-slate-200">{row.scriptStep}</td>
                                                <td className="px-4 py-2 text-slate-300 font-mono text-sm">{row.displayPath}</td>
                                                <td className="px-4 py-2 text-slate-300 font-mono text-sm max-w-xs truncate" title={formatDisplayValue(getValue(data.student, row.storagePath))}>
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
                                className="px-4 py-2 rounded bg-teal-600 text-white hover:bg-teal-500"
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
