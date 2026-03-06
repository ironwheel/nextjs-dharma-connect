import React, { useState, useEffect, useRef } from 'react';
import { ScriptDefinition, ScriptStep, ScriptContext } from './types';
import { promptLookup } from './StepComponents';
import { evaluateStepCondition } from './stepConditions';
// Since nested-property is not in sharedFrontend and I didn't add it to package.json, I need to add it or use a utility function.
// I'll stick to 'nested-property' for now and ensure it's installed or replace with lodash.get/set if available.
// "nested-property" was in reg/package.json. I should add it to apps/register/package.json if I use it.
// I'll assume I'll add it.

function getNested(obj: any, path: string) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function setNested(obj: any, path: string, value: any) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return { ...obj }; // Return shallow copy of root to trigger re-renders if simple state
}

interface ScriptEngineProps {
    definition: ScriptDefinition;
    context: ScriptContext;
    onChange: (path: string, value: any) => void;
}

export const ScriptEngine: React.FC<ScriptEngineProps & { onComplete?: () => Promise<void> }> = ({ definition, context, onChange, onComplete }) => {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [history, setHistory] = useState<number[]>([]); // Track history for Back button
    const saveStepRef = useRef<{ save: () => Promise<void> } | null>(null);

    // Helper to find next valid step
    const getNextValidStepIndex = (startIndex: number, direction: 'forward' | 'backward'): number => {
        let index = startIndex;
        const limit = direction === 'forward' ? definition.steps.length : -1;
        const increment = direction === 'forward' ? 1 : -1;

        index += increment;
        while (index !== limit) {
            const step = definition.steps[index];
            const conditionOk = !step.condition || step.condition(context);
            const showWhenOk = !step.showWhen || evaluateStepCondition(step.showWhen, context);
            if (conditionOk && showWhenOk) {
                return index;
            }
            index += increment;
        }
        return -1; // End or Beginning reached
    };

    const handleNext = () => {
        if (validationError) return; // block until step is valid
        const nextIndex = getNextValidStepIndex(effectiveStepIndex, 'forward');
        if (nextIndex !== -1 && nextIndex < definition.steps.length) {
            setHistory([...history, effectiveStepIndex]);
            setCurrentStepIndex(nextIndex);
        }
        // When no next step (isLast), last-step action is handled by the button's onClick (onLastStepNext or onComplete)
    };

    const handleBack = () => {
        if (history.length > 0) {
            const prevIndex = history[history.length - 1];
            setHistory(history.slice(0, -1));
            setCurrentStepIndex(prevIndex);
        }
    };

    // If the current step should be hidden (showWhen/condition false), skip it so we never show an empty step
    const stepShouldBeVisible = (idx: number): boolean => {
        const s = definition.steps[idx];
        if (!s) return false;
        const conditionOk = !s.condition || s.condition(context);
        const showWhenOk = !s.showWhen || evaluateStepCondition(s.showWhen, context);
        return conditionOk && showWhenOk;
    };

    const [effectiveStepIndex, setEffectiveStepIndex] = useState(currentStepIndex);
    useEffect(() => {
        if (stepShouldBeVisible(currentStepIndex)) {
            setEffectiveStepIndex(currentStepIndex);
            return;
        }
        // Current step is hidden (showWhen/condition false): skip to another step so we never show an empty step.
        // Prefer previous valid step (e.g. user clicked Back into a now-hidden step); else next valid.
        const prevIdx = getNextValidStepIndex(currentStepIndex, 'backward');
        if (prevIdx >= 0) {
            setHistory((h) => h.slice(0, -1));
            setCurrentStepIndex(prevIdx);
            setEffectiveStepIndex(prevIdx);
            return;
        }
        const nextIdx = getNextValidStepIndex(currentStepIndex, 'forward');
        if (nextIdx >= 0) {
            setCurrentStepIndex(nextIdx);
            setEffectiveStepIndex(nextIdx);
        }
    }, [currentStepIndex, context.student, definition.steps]);

    const step = definition.steps[effectiveStepIndex];

    if (!step) {
        return <div>No active step.</div>;
    }

    // Resolve field path relative to context.student (strip leading "student." if present)
    const pathFromStudent = step.field?.startsWith('student.') ? step.field.slice(8) : step.field;
    const value = pathFromStudent ? getNested(context.student, pathFromStudent) : undefined;
    const validationError = step.validation ? step.validation(value, context) : null;

    const renderCurrentStep = () => {
        switch (step.type) {
            case 'custom': {
                const CustomComponent = step.component as any;
                if (CustomComponent) {
                    const refProp = step.id === 'save' ? { ref: saveStepRef } : {};
                    return <CustomComponent {...refProp} context={context} value={value} engineOnChange={onChange} />;
                }
                return <div>Custom component missing for {step.id}</div>;
            }

            case 'text':
                return (
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1 text-slate-300">{step.promptKey || step.id}</label>
                        <input
                            type="text"
                            className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white"
                            value={value || ''}
                            onChange={(e) => step.field && onChange(step.field, e.target.value)}
                        />
                    </div>
                );
            case 'checkbox':
                return (
                    <div className="mb-4 flex items-center">
                        <input
                            type="checkbox"
                            className="mr-2 rounded bg-slate-800 border border-slate-700 text-teal-500 focus:ring-teal-500"
                            checked={!!value}
                            onChange={(e) => step.field && onChange(step.field, e.target.checked)}
                        />
                        <label className="text-sm font-medium text-slate-300">{step.promptKey || step.id}</label>
                    </div>
                );
            case 'radio':
                return (
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2 text-slate-300">{step.promptKey || step.id}</label>
                        <div className="flex flex-col gap-2">
                            {step.options?.map((opt) => (
                                <label key={opt.value} className="flex items-center text-slate-300">
                                    <input
                                        type="radio"
                                        name={step.id}
                                        className="mr-2 text-teal-500 focus:ring-teal-500 bg-slate-800 border-slate-700"
                                        checked={value === opt.value}
                                        onChange={() => step.field && onChange(step.field, opt.value)}
                                    />
                                    <span>{opt.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                );
            case 'info':
                return (
                    <div className="mb-4 p-4 bg-slate-800 rounded border border-slate-700 text-slate-300">
                        {/* Placeholder for localized text or simplified logic */}
                        <p>{step.promptKey || step.id}</p>
                    </div>
                );
            default:
                return <div key={step.id}>Unknown step type: {step.type}</div>;
        }
    };

    const isFirst = history.length === 0;
    const isLast = getNextValidStepIndex(effectiveStepIndex, 'forward') === -1;

    const stepTitle = step.promptKey ? promptLookup(context, step.promptKey) : step.id.replace(/([A-Z])/g, ' $1').trim();
    const showStepTitle = step.id !== 'introduction';
    const rawEventImage = context.config?.eventImage;
    const eventImageUrl =
        typeof rawEventImage === 'string' && (rawEventImage.startsWith('http://') || rawEventImage.startsWith('https://'))
            ? rawEventImage
            : null;

    return (
        <div className="script-engine max-w-2xl mx-auto bg-slate-900 text-white rounded-lg shadow-xl border border-slate-800 overflow-hidden">
            {eventImageUrl && (
                <img
                    src={eventImageUrl}
                    alt={context.event?.name ? `Event: ${context.event.name}` : 'Event'}
                    className="w-full h-auto block"
                />
            )}
            <div className="p-6">
            {showStepTitle && <h2 className="text-xl font-semibold mb-6 text-teal-400">{stepTitle}</h2>}

            <div className="step-content min-h-[200px]">
                {renderCurrentStep()}
            </div>
            {validationError && (
                <p className="mt-4 text-amber-400 text-sm" role="alert">{validationError}</p>
            )}

            <div className="mt-8 flex justify-between items-center flex-wrap gap-3">
                <button
                    onClick={handleBack}
                    disabled={isFirst}
                    className={`px-4 py-2 rounded ${isFirst ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-700 text-white hover:bg-slate-600 transition-colors'}`}
                >
                    {promptLookup(context, 'back')}
                </button>
                <span className="text-slate-400 text-sm flex-1 text-center">
                    {promptLookup(context, 'regProgress')
                        .replace(/\|\|currentStep\|\|/g, String(effectiveStepIndex + 1))
                        .replace(/\|\|totalSteps\|\|/g, String(definition.steps.length))}
                </span>
                <div className="flex gap-3">
                    {step.id === 'save' && (
                        <button
                            type="button"
                            onClick={() => (context as any).onCancel?.()}
                            className="px-4 py-2 rounded bg-slate-600 text-white hover:bg-slate-500 transition-colors"
                        >
                            {promptLookup(context, 'cancel')}
                        </button>
                    )}
                    <button
                        onClick={isLast
                            ? async () => { await ((context as any).onLastStepNext ?? (context as any).onComplete)?.(); }
                            : step.id === 'save'
                                ? async () => { await saveStepRef.current?.save(); }
                                : handleNext}
                        disabled={!!validationError}
                        className={`px-6 py-2 rounded font-medium transition-colors shadow-lg ${validationError ? 'bg-slate-600 text-slate-400 cursor-not-allowed shadow-slate-900/20' : 'bg-teal-600 text-white hover:bg-teal-500 shadow-teal-900/20'}`}
                    >
                        {promptLookup(context, 'next')}
                    </button>
                </div>
            </div>
            </div>
        </div>
    );
};
