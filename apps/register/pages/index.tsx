import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { api, getTableItem, getAllTableItemsFiltered, getAllTableItems } from 'sharedFrontend';
import { ScriptEngine } from '../components/script/ScriptEngine';
import { promptLookup } from '../components/script/StepComponents';
import { getScriptSteps } from '../config/stepRegistry';
import { ScriptDefinition, ScriptContext, ScriptStep } from '../components/script/types';
import { Offer } from '../components/Offer';

export default function Home() {
    const router = useRouter();
    const { pid, hash, eventCode, aid, ...rest } = router.query;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{ student: any, event: any, prompts: any, pools: any[] } | null>(null);
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
                const [studentData, eventData, eventPrompts, defaultPrompts, pools] = await Promise.all([
                    getTableItem('students', studentPid, studentPid, studentHash),
                    getTableItem('events', activeEventCode, studentPid, studentHash),
                    getAllTableItemsFiltered('prompts', 'aid', activeEventCode, studentPid, studentHash),
                    getAllTableItemsFiltered('prompts', 'aid', 'default', studentPid, studentHash),
                    getAllTableItems('pools', studentPid, studentHash),
                ]);

                const eventList = Array.isArray(eventPrompts) ? eventPrompts : [];
                const defaultList = Array.isArray(defaultPrompts) ? defaultPrompts : [];
                const promptsListArray = [...eventList, ...defaultList];
                const poolsArray = Array.isArray(pools) ? pools : [];

                setData({ student: studentData, event: eventData, prompts: promptsListArray, pools: poolsArray });

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
                    setScriptDef({ steps });
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
    const [phase, setPhase] = useState<'loading' | 'join' | 'offer' | 'stripeCapture'>('loading');

    useEffect(() => {
        if (!data) return;

        const { student, event } = data;

        // Check for payment intent (Stripe Callback)
        if (router.query.payment_intent) {
            setPhase('stripeCapture');
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

    }, [data, router.query, activeEventCode]);

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
        setData({ ...data, student: newStudent });
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

    const context: ScriptContext = {
        student: data.student,
        event: data.event,
        config: data.event.config,
        prompts: data.prompts,
        pools: data.pools,
        pid: studentPid,
        hash: studentHash,
        onComplete: handleJoinComplete,
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Head>
                <title>{promptLookup(context, 'title') || data.event.name || 'Registration'}</title>
            </Head>

            <main className="container mx-auto py-8 px-4">
                <h1 className="text-3xl font-bold mb-8 text-center text-teal-400">{promptLookup(context, 'title') || data.event.name}</h1>

                {phase === 'join' && (
                    <ScriptEngine
                        definition={scriptDef}
                        context={context}
                        onChange={handleScriptChange}
                        // We need to pass a way for the script to trigger completion
                        // The ScriptEngine might handle 'save' step which triggers this
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
            </main>
        </div>
    );
}
