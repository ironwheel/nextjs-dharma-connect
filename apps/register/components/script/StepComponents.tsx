import React, { useState } from 'react';
import { ScriptContext } from './types';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe } from "@fortawesome/free-solid-svg-icons";
import { checkEligibility } from 'sharedFrontend';

// Look up prompt text: event-specific first, then default (language or 'universal'), then
// decorated fallback. Uses student.writtenLangPref for language (default "English").
// Expects context.prompts as array of { prompt, language, text } (or object values treated as list).
export function promptLookup(context: ScriptContext, key: string): string {
    const list = Array.isArray(context.prompts)
        ? context.prompts
        : Object.values(context.prompts || {});
    const language = context.student?.writtenLangPref ?? 'English';
    const eventCode = context.event?.aid ?? '';

    // Special case: event / receiptTitle use title
    if (key === 'event' || key === 'receiptTitle') {
        return promptLookup(context, 'title');
    }

    // Aid-specific: prompt === eventCode + '-' + key, language match
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;
        const promptName = item.prompt;
        const itemLang = item.language;
        const text = item.text;
        if (promptName === eventCode + '-' + key && itemLang === language && typeof text === 'string') {
            return text;
        }
    }

    // Default: prompt === 'default-' + key, language or 'universal'
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;
        const promptName = item.prompt;
        const itemLang = item.language;
        const text = item.text;
        if (promptName === 'default-' + key && (itemLang === language || itemLang === 'universal') && typeof text === 'string') {
            return text;
        }
    }

    return eventCode + '-' + key + '-' + language + '-unknown';
}

// Helper for inputs (omit label to avoid duplicating step title)
const InputField = ({ label, value, onChange, type = "text", placeholder = "" }: any) => (
    <div className="mb-4">
        {label ? <label className="block text-sm font-medium mb-1 text-slate-300">{label}</label> : null}
        <input
            type={type}
            className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white placeholder-slate-500"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const SelectField = ({ label, value, onChange, options }: any) => (
    <div className="mb-4">
        {label ? <label className="block text-sm font-medium mb-1 text-slate-300">{label}</label> : null}
        <select
            className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">Select...</option>
            {options.map((opt: any) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    </div>
);

// Yes/No radio group bound to a path (path may be "student.x.y" or "x.y")
const RadioYesNo = ({ context, path, label, engineOnChange }: { context: ScriptContext; path: string; label: string; engineOnChange: (path: string, val: any) => void }) => {
    const pathFromStudent = path.startsWith('student.') ? path.slice(8) : path;
    const val = pathFromStudent.split('.').reduce((o: any, k) => o?.[k], context.student);
    const isYes = val === true;
    const isNo = val === false;
    return (
        <div className="mb-4">
            {label ? <label className="block text-sm font-medium mb-2 text-slate-300">{label}</label> : null}
            <div className="flex gap-4">
                <label className="flex items-center text-slate-300">
                    <input type="radio" name={path} checked={isYes} onChange={() => engineOnChange(path, true)} className="mr-2 text-teal-500" />
                    <span>{context.prompts?.yes?.text ?? 'Yes'}</span>
                </label>
                <label className="flex items-center text-slate-300">
                    <input type="radio" name={path} checked={isNo} onChange={() => engineOnChange(path, false)} className="mr-2 text-teal-500" />
                    <span>{context.prompts?.no?.text ?? 'No'}</span>
                </label>
            </div>
        </div>
    );
};

// Checkbox list from event.config[configKey] (e.g. whichRetreatsConfig). Each entry: { prompt, order, retreatRequired?, pool?, key }.
// Option labels are looked up via promptLookup(context, obj.prompt). Section label is optional (step title is shown above).
const CheckboxMap = ({
    context,
    configKey,
    basePath,
    engineOnChange,
    label,
}: {
    context: ScriptContext;
    configKey: string;
    basePath: string; // e.g. student.programs.VTInPerson2025
    engineOnChange: (path: string, val: any) => void;
    label?: string; // optional; when omitted, no duplicate heading (step name is already shown)
}) => {
    const config = context.config?.[configKey] as Record<string, { prompt: string; order?: number; retreatRequired?: string; pool?: string }> | undefined;
    const eventCode = context.event?.aid;
    if (!config) return <div className="text-slate-400 text-sm">No options configured ({configKey})</div>;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const mapName = configKey.replace('Config', '');
    const map = context.student?.programs?.[eventCode]?.[mapName] as Record<string, boolean> | undefined;
    const safeMap = map && typeof map === 'object' ? map : {};
    const entries = Object.entries(config)
        .filter(([, obj]) => {
            if (obj?.pool && eventCode && !checkEligibility(obj.pool, context.student, eventCode, pools)) {
                return false;
            }
            if (obj?.retreatRequired && !whichRetreats[obj.retreatRequired]) return false;
            return true;
        })
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)));
    return (
        <div className="mb-4">
            {label ? <label className="block text-sm font-medium mb-2 text-slate-300">{label}</label> : null}
            <div className="space-y-2 border border-slate-700 rounded p-3 bg-slate-800/50">
                {entries.map(([key, obj]) => (
                    <label key={key} className="flex items-center text-slate-300">
                        <input
                            type="checkbox"
                            checked={!!safeMap[key]}
                            onChange={(e) => engineOnChange(`${basePath}.${mapName}.${key}`, e.target.checked)}
                            className="mr-2 rounded text-teal-500"
                        />
                        <span>{typeof obj?.prompt === 'string' ? promptLookup(context, obj.prompt) : key}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

export const RenderWrittenTranslation: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void, value: any }> = ({ context, engineOnChange }) => {
    const languages = [
        { value: "English", label: "English" },
        { value: "German", label: "Deutsch" },
        { value: "Czech", label: "čeština" },
        { value: "Spanish", label: "Español" },
        { value: "French", label: "Français" },
        { value: "Italian", label: "Italiano" },
        { value: "Dutch", label: "Nederlands" },
        { value: "Portuguese", label: "Português" },
        { value: "Russian", label: "русский" }
    ];

    return (
        <div className="p-4 bg-slate-800/50 rounded border border-slate-700">
            <div className="flex items-center mb-4 text-teal-400">
                <FontAwesomeIcon icon={faGlobe} className="mr-2" />
                <h3 className="text-lg font-medium">{promptLookup(context, 'selectLanguage')}</h3>
            </div>
            <SelectField
                label=""
                value={context.student.writtenLangPref}
                onChange={(val: any) => engineOnChange('student.writtenLangPref', val)}
                options={languages}
            />
        </div>
    );
};

export const RenderJoin: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const s = context.student || {};

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField label="First Name" value={s.first} onChange={(v: any) => engineOnChange('student.first', v)} />
                <InputField label="Last Name" value={s.last} onChange={(v: any) => engineOnChange('student.last', v)} />
            </div>

            <InputField label="Email" value={s.email} onChange={(v: any) => engineOnChange('student.email', v)} type="email" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField label="City" value={s.city} onChange={(v: any) => engineOnChange('student.city', v)} />
                <InputField label="Country" value={s.country} onChange={(v: any) => engineOnChange('student.country', v)} />
                {/* Note: In real app, Country should be a select list probably */}
            </div>

            {(s.country === "United States" || s.country === "Canada") && (
                <InputField label="State/Province" value={s.state} onChange={(v: any) => engineOnChange('student.state', v)} />
            )}
        </div>
    );
};

export const RenderMotivation: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    // Usually binds to student.programs[eventCode].motivation or just student.motivation depending on schema
    // Let's assume event specific motivation: student.programs[eventCode].motivation
    const eventCode = context.event.aid;
    const motivation = context.student.programs?.[eventCode]?.motivation;

    return (
        <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-slate-300">Motivation</label>
            <p className="text-xs text-slate-400 mb-2">Please briefly describe your motivation for attending this event.</p>
            <textarea
                className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white h-32"
                value={motivation || ''}
                onChange={(e) => engineOnChange(`student.programs.${eventCode}.motivation`, e.target.value)}
            />
        </div>
    );
};


export const RenderOath: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event.aid;
    const oath = context.student.programs?.[eventCode]?.oath;

    return (
        <div className="p-4 bg-teal-900/20 border border-teal-800 rounded">
            <p className="mb-4 text-slate-300 italic">"I agree to maintain the confidentiality of the teachings..." (Placeholder Oath Text)</p>
            <div className="flex items-center">
                <input
                    type="checkbox"
                    className="mr-2 rounded bg-slate-800 border border-slate-700 text-teal-500 focus:ring-teal-500"
                    checked={!!oath}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.oath`, e.target.checked)}
                />
                <label className="text-sm font-medium text-white">I Agree</label>
            </div>
        </div>
    );
};

// --- Location (country, state/province, city) ---
const COUNTRIES = ["Australia", "Austria", "Belgium", "Brazil", "Czechia", "Canada", "Chile", "China", "Columbia", "Denmark", "France", "Finland", "Germany", "Guatemala", "Hungary", "Iceland", "Ireland", "India", "Israel", "Italy", "Laos", "Mexico", "Nepal", "Netherlands", "New Zealand", "Poland", "Portugal", "Russia", "Spain", "Sweden", "Switzerland", "Taiwan", "Thailand", "Ukraine", "United Kingdom", "United States", "Other"];
const US_STATES = ["Alaska", "Alabama", "Arkansas", "Arizona", "California", "Colorado", "Connecticut", "District of Columbia", "Delaware", "Florida", "Georgia", "Hawaii", "Iowa", "Idaho", "Illinois", "Indiana", "Kansas", "Kentucky", "Louisiana", "Massachusetts", "Maryland", "Maine", "Michigan", "Minnesota", "Missouri", "Mississippi", "Montana", "North Carolina", "North Dakota", "Nebraska", "New Hampshire", "New Jersey", "New Mexico", "Nevada", "New York", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Virginia", "Vermont", "Washington", "Wisconsin", "West Virginia", "Wyoming"];
const CANADA_PROVINCES = ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon"];

export const RenderLocation: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const s = context.student || {};
    const country = s.country;
    const stateProvince = s.stateProvince ?? s.state;
    const city = s.city;

    return (
        <div className="space-y-4">
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-slate-300">{promptLookup(context, 'selectCountry')}</label>
                <select
                    className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white"
                    value={country || ''}
                    onChange={(e) => engineOnChange('student.country', e.target.value)}
                >
                    <option value="">Select country...</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            {(country === 'United States' || country === 'Canada') && (
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1 text-slate-300">{promptLookup(context, 'selectStateProvince')}</label>
                    <select
                        className="w-full p-2 rounded bg-slate-800 border border-slate-700 focus:border-blue-500 text-white"
                        value={stateProvince || ''}
                        onChange={(e) => engineOnChange('student.stateProvince', e.target.value)}
                    >
                        <option value="">Select...</option>
                        {(country === 'United States' ? US_STATES : CANADA_PROVINCES).map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                </div>
            )}
            {country && (
                <InputField label={promptLookup(context, 'enterCity')} value={city} onChange={(v: string) => engineOnChange('student.city', v)} />
            )}
        </div>
    );
};

// --- Which retreats (checkbox map from whichRetreatsConfig) ---
export const RenderWhichRetreats: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const basePath = `student.programs.${eventCode}`;
    return (
        <CheckboxMap context={context} configKey="whichRetreatsConfig" basePath={basePath} engineOnChange={engineOnChange} />
    );
};

// --- Preference necessity (radio group from prefNecConfig; only when one VY retreat selected) ---
function objKeysInc(obj: Record<string, unknown> | undefined, keyPrefix: string): boolean {
    if (!obj || typeof obj !== 'object') return false;
    return Object.entries(obj).some(([k, v]) => k.includes(keyPrefix) && v);
}

export const RenderPreferenceNecessity: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    const hasVY = objKeysInc(whichRetreats, 'vajrayana');
    const hasVY1 = objKeysInc(whichRetreats, 'vajrayana1');
    const hasVY2 = objKeysInc(whichRetreats, 'vajrayana2');
    const oneVY = hasVY && !(hasVY1 && hasVY2);
    if (!oneVY) return <div className="text-slate-400 text-sm">This step applies when you have selected exactly one Vajrayana retreat.</div>;

    const config = context.config?.prefNecConfig as Record<string, { prompt: string; order?: number; pool?: string; radioGroups?: string[] }> | undefined;
    if (!config) return <div className="text-slate-400 text-sm">No prefNecConfig configured.</div>;

    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const entries = Object.entries(config)
        .filter(([, obj]) => !obj?.pool || (eventCode && checkEligibility(obj.pool, context.student, eventCode, pools)))
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)))
        .map(([key, obj]) => ({ key, prompt: obj?.prompt ?? key }));

    const basePath = `student.programs.${eventCode}.prefNec`;
    const prefNec = context.student?.programs?.[eventCode]?.prefNec || {};
    const selectedKey = entries.find((e) => prefNec[e.key])?.key ?? null;

    const handleSelect = (key: string) => {
        const next = Object.fromEntries(entries.map((e) => [e.key, e.key === key]));
        engineOnChange(basePath, next);
    };

    return (
        <div className="mb-4">
            <div className="space-y-2 border border-slate-700 rounded p-3 bg-slate-800/50">
                {entries.map(({ key, prompt }) => (
                    <label key={key} className="flex items-center text-slate-300">
                        <input
                            type="radio"
                            name="prefNec"
                            checked={selectedKey === key}
                            onChange={() => handleSelect(key)}
                            className="mr-2 rounded text-teal-500"
                        />
                        <span>{promptLookup(context, prompt)}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

// --- Vajrayana online series (Yes/No; only when VY retreat selected) ---
export const RenderVyOnlineSeries: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const path = `student.programs.${eventCode}.vyOnlineSeries`;
    return <RadioYesNo context={context} path={path} label={promptLookup(context, 'vyOnlineSeries')} engineOnChange={engineOnChange} />;
};

// --- Mobile phone ---
export const RenderMobilePhone: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const mobile = context.student?.mobilePhone ?? '';
    return (
        <div className="space-y-4">
            <InputField label="" value={mobile} onChange={(v: string) => engineOnChange('student.mobilePhone', v)} />
        </div>
    );
};

// --- In-person teachings ---
export const RenderInPersonTeachings: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    return <RadioYesNo context={context} path={`student.programs.${eventCode}.inPersonTeachings`} label={promptLookup(context, 'inPersonTeachings')} engineOnChange={engineOnChange} />;
};

// --- Interested in setup (setupConfig: "no" mutually exclusive with {setup1, setup2, setup3}; setup1/2/3 can be checked in any combination) ---
export const RenderInterestedInSetup: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const config = context.config?.setupConfig as Record<string, { prompt: string; order?: number; pool?: string; radioGroups?: string[] }> | undefined;
    if (!config) return <div className="text-slate-400 text-sm">No setupConfig configured.</div>;

    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const allEntries = Object.entries(config)
        .filter(([, obj]) => !obj?.pool || (eventCode && checkEligibility(obj.pool, context.student, eventCode, pools)))
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)))
        .map(([key, obj]) => ({ key, prompt: obj?.prompt ?? key, radioGroups: obj?.radioGroups }));

    // The option whose radioGroups lists *other* keys is "no" (mutually exclusive with that group). Others (setup1, setup2, setup3) are the multi group.
    const multiGroupKeys = new Set<string>();
    let exclusiveKey: string | null = null;
    for (const { key, radioGroups } of allEntries) {
        if (Array.isArray(radioGroups) && radioGroups.length > 0 && radioGroups.some((k) => k !== key)) {
            exclusiveKey = key;
            radioGroups.forEach((k) => multiGroupKeys.add(k));
            break;
        }
    }
    const noEntry = exclusiveKey ? allEntries.find((e) => e.key === exclusiveKey) : null;

    const basePath = `student.programs.${eventCode}.setup`;
    const setup = context.student?.programs?.[eventCode]?.setup || {};
    const noChecked = noEntry ? !!setup[noEntry.key] : false;
    const multiChecked = (key: string) => !!setup[key];

    const handleNoChange = (checked: boolean) => {
        if (checked && noEntry) {
            const next = { ...setup, [noEntry.key]: true };
            multiGroupKeys.forEach((k) => delete next[k]);
            engineOnChange(basePath, next);
        } else if (noEntry) {
            const next = { ...setup };
            delete next[noEntry.key];
            engineOnChange(basePath, next);
        }
    };

    const handleMultiChange = (key: string, checked: boolean) => {
        const next = { ...setup };
        if (noEntry) delete next[noEntry.key];
        if (checked) next[key] = true;
        else delete next[key];
        engineOnChange(basePath, next);
    };

    return (
        <div className="mb-4">
            <div className="space-y-2 border border-slate-700 rounded p-3 bg-slate-800/50">
                {allEntries.map((entry) => {
                    if (entry.key === exclusiveKey && noEntry) {
                        return (
                            <label key={entry.key} className="flex items-center text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={noChecked}
                                    onChange={(e) => handleNoChange(e.target.checked)}
                                    className="mr-2 rounded text-teal-500"
                                />
                                <span>{promptLookup(context, noEntry.prompt)}</span>
                            </label>
                        );
                    }
                    if (multiGroupKeys.has(entry.key)) {
                        return (
                            <label key={entry.key} className="flex items-center text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={multiChecked(entry.key)}
                                    onChange={(e) => handleMultiChange(entry.key, e.target.checked)}
                                    className="mr-2 rounded text-teal-500"
                                />
                                <span>{promptLookup(context, entry.prompt)}</span>
                            </label>
                        );
                    }
                    return null;
                })}
            </div>
        </div>
    );
};

// --- Interested in takedown ---
export const RenderInterestedInTakedown: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    return <RadioYesNo context={context} path={`student.programs.${eventCode}.interestedInTakedown`} label="" engineOnChange={engineOnChange} />;
};

// --- Healthcare professional (Yes/No; if Yes, healthcareTraining) ---
export const RenderHealthcareProfessional: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const isPro = context.student?.healthcareProfessional;
    const training = context.student?.healthcareTraining ?? '';

    return (
        <div className="space-y-4">
            <RadioYesNo context={context} path="student.healthcareProfessional" label="" engineOnChange={engineOnChange} />
            {isPro && (
                <InputField label={promptLookup(context, 'healthcareTraining')} value={training} onChange={(v: string) => engineOnChange('student.healthcareTraining', v)} />
            )}
        </div>
    );
};

// --- Service already (Yes/No; if Yes, serviceAlreadyResponse) ---
export const RenderServiceAlready: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const base = `student.programs.${eventCode}`;
    const already = context.student?.programs?.[eventCode]?.serviceAlready;
    const response = context.student?.programs?.[eventCode]?.serviceAlreadyResponse ?? '';

    return (
        <div className="space-y-4">
            <RadioYesNo context={context} path={`${base}.serviceAlready`} label="" engineOnChange={engineOnChange} />
            {already && (
                <InputField label={promptLookup(context, 'serviceAlreadyResponse')} value={response} onChange={(v: string) => engineOnChange(`${base}.serviceAlreadyResponse`, v)} />
            )}
        </div>
    );
};

// --- Service no question (service map; only when serviceAlready is false) ---
export const RenderServiceNoQuestion: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const serviceAlready = context.student?.programs?.[eventCode]?.serviceAlready;
    if (serviceAlready === true) return <div className="text-slate-400 text-sm">Skipped (you indicated you already serve).</div>;
    const basePath = `student.programs.${eventCode}`;
    return (
        <CheckboxMap context={context} configKey="serviceConfig" basePath={basePath} engineOnChange={engineOnChange} />
    );
};

// --- Service contact (checkbox map) ---
export const RenderServiceContact: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const basePath = `student.programs.${eventCode}`;
    return (
        <CheckboxMap context={context} configKey="serviceContactConfig" basePath={basePath} engineOnChange={engineOnChange} />
    );
};

// --- Accessibility (Yes/No; if Yes, accessibilityDetails; respect noAccessibilityDetails) ---
export const RenderAccessibility: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const accessibility = context.student?.accessibility;
    const details = context.student?.accessibilityDetails ?? '';
    const noDetails = context.config?.noAccessibilityDetails;

    return (
        <div className="space-y-4">
            <RadioYesNo context={context} path="student.accessibility" label={promptLookup(context, 'accessibility')} engineOnChange={engineOnChange} />
            {accessibility && !noDetails && (
                <InputField label={promptLookup(context, 'accessibilityDetails')} value={details} onChange={(v: string) => engineOnChange('student.accessibilityDetails', v)} />
            )}
        </div>
    );
};

// --- Supplication (read-only text; retreat-specific). signers from context.signers or empty ---
export const RenderSupplication: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void; titleKey: string; bodyKey: string; retreat?: string }> = ({ context, titleKey, bodyKey, retreat }) => {
    const eventCode = context.event?.aid;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    if (retreat && !objKeysInc(whichRetreats, retreat)) return null;
    const title = promptLookup(context, titleKey);
    const body = promptLookup(context, bodyKey);
    const signers = (context as any).signers ?? [];
    const signerText = signers.length ? '\n\n' + signers.map((s: string) => s + '\n').join('') : '';

    return (
        <div className="p-4 bg-slate-800/50 rounded border border-slate-700">
            <p className="italic text-slate-300 mb-2">{title}</p>
            <textarea readOnly rows={10} className="w-full p-2 rounded bg-slate-800 border border-slate-700 text-white font-mono text-sm" value={body + signerText} />
        </div>
    );
};

export const RenderSupplicationMY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = (props) => (
    <RenderSupplication {...props} titleKey="supplicationTitleMY" bodyKey="supplicationBodyMY" retreat="mahayana" />
);
export const RenderSupplicationVY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = (props) => (
    <RenderSupplication {...props} titleKey="supplicationTitleVY" bodyKey="supplicationBodyVY" retreat="vajrayana" />
);

// --- Join (retreat-specific: joinMY, joinVY) ---
export const RenderJoinMY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => (
    <RadioYesNo context={context} path={`student.programs.${context.event?.aid}.joinMY`} label={promptLookup(context, 'joinMY')} engineOnChange={engineOnChange} />
);
export const RenderJoinVY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => (
    <RadioYesNo context={context} path={`student.programs.${context.event?.aid}.joinVY`} label={promptLookup(context, 'joinVY')} engineOnChange={engineOnChange} />
);

// --- Visible signature ---
export const RenderVisibleSignature: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    return <RadioYesNo context={context} path={`student.programs.${eventCode}.visible`} label={promptLookup(context, 'visible')} engineOnChange={engineOnChange} />;
};

// --- Social media ---
export const RenderSocialMedia: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const checked = !!context.student?.programs?.[eventCode]?.socialMedia;

    return (
        <div className="mb-4">
            <label className="flex items-center text-slate-300">
                <input
                    type="checkbox"
                    className="mr-2 rounded text-teal-500"
                    checked={checked}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.socialMedia`, e.target.checked)}
                />
                <span>{promptLookup(context, 'socialMedia')}</span>
            </label>
        </div>
    );
};

// --- Save (persist student and call onComplete from context) ---
export const RenderSave: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context }) => {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onComplete = (context as any).onComplete;
    const pid = (context as any).pid;
    const hash = (context as any).hash;

    const handleSave = async () => {
        if (!pid || !hash || !onComplete) {
            setError('Missing save configuration (pid, hash, or onComplete).');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const { putTableItem } = await import('sharedFrontend');
            const student = context.student;
            student.programs = student.programs || {};
            const eventCode = context.event?.aid;
            if (!student.programs[eventCode]) student.programs[eventCode] = {};
            student.programs[eventCode].join = true;
            student.programs[eventCode].submitCount = (student.programs[eventCode].submitCount ?? 0) + 1;
            student.programs[eventCode].submitTime = new Date().toISOString();
            student.programs[eventCode].saved = true;
            await putTableItem('students', pid, student, pid, hash);
            onComplete();
        } catch (e: any) {
            setError(e?.message || 'Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        if ((context as any).onCancel) (context as any).onCancel();
    };

    return (
        <div className="p-4 border border-slate-700 rounded bg-slate-800/50">
            <p className="mb-4 text-slate-300 font-medium">{promptLookup(context, 'mustSave')}</p>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50 mr-4">
                {saving ? 'Saving...' : (context.prompts?.enter?.text ?? 'Submit')}
            </button>
            <button type="button" onClick={handleCancel} className="px-4 py-2 rounded bg-slate-600 text-white hover:bg-slate-500">
                {promptLookup(context, 'cancel')}
            </button>
            {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
        </div>
    );
};
