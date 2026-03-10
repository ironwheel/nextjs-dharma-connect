import React, { useState } from 'react';
import { ScriptContext } from './types';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe } from "@fortawesome/free-solid-svg-icons";
import { checkEligibility } from 'sharedFrontend';

/** Use context.checkEligibility when provided (e.g. test mode oath override), otherwise sharedFrontend checkEligibility. */
function getCheckEligibility(context: ScriptContext) {
    return context.checkEligibility ?? checkEligibility;
}

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

// Helper: is the current student in a given eligibility pool for the active event?
export function isInPool(context: ScriptContext, poolName: string): boolean {
    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const eventCode = context.event?.aid ?? '';
    const checkElig = getCheckEligibility(context);
    if (!eventCode || typeof checkElig !== 'function') return false;
    return checkElig(poolName, context.student, eventCode, pools);
}

// Helper for inputs (omit label to avoid duplicating step title)
const InputField = ({ label, value, onChange, type = "text", placeholder = "" }: any) => (
    <div className="mb-4">
        {label ? <label className="block text-sm font-medium mb-1 text-reg-muted">{label}</label> : null}
        <input
            type={type}
            className="w-full p-2 rounded bg-reg-input border border-reg-border focus:border-reg-focus-ring text-reg-text placeholder-reg"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const SelectField = ({ label, value, onChange, options }: any) => (
    <div className="mb-4">
        {label ? <label className="block text-sm font-medium mb-1 text-reg-muted">{label}</label> : null}
        <select
            className="w-full p-2 rounded bg-reg-input border border-reg-border focus:border-reg-focus-ring text-reg-text"
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
        <div className="mb-2">
            {label ? <label className="block text-sm font-medium mb-1 text-reg-muted">{label}</label> : null}
            <div className="flex gap-4 items-center">
                <label className="flex items-center text-reg-muted">
                    <input type="radio" name={path} checked={isYes} onChange={() => engineOnChange(path, true)} className="mr-2 text-reg-accent" />
                    <span>{promptLookup(context, 'yes') || 'Yes'}</span>
                </label>
                <label className="flex items-center text-reg-muted">
                    <input type="radio" name={path} checked={isNo} onChange={() => engineOnChange(path, false)} className="mr-2 text-reg-accent" />
                    <span>{promptLookup(context, 'no') || 'No'}</span>
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
    if (!config) return <div className="text-reg-muted text-sm">No options configured ({configKey})</div>;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const mapName = configKey.replace('Config', '');
    const map = context.student?.programs?.[eventCode]?.[mapName] as Record<string, boolean> | undefined;
    const safeMap = map && typeof map === 'object' ? map : {};
    const checkElig = getCheckEligibility(context);
    const entries = Object.entries(config)
        .filter(([, obj]) => {
            if (obj?.pool && eventCode && !checkElig(obj.pool, context.student, eventCode, pools)) {
                return false;
            }
            if (obj?.retreatRequired && !whichRetreats[obj.retreatRequired]) return false;
            return true;
        })
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)));
    return (
        <div className="mb-4">
            {label ? <label className="block text-sm font-medium mb-2 text-reg-muted">{label}</label> : null}
            <div className="space-y-2 border border-reg-border rounded p-3 bg-reg-card-muted">
                {entries.map(([key, obj]) => (
                    <label key={key} className="flex items-center text-reg-muted">
                        <input
                            type="checkbox"
                            checked={!!safeMap[key]}
                            onChange={(e) => engineOnChange(`${basePath}.${mapName}.${key}`, e.target.checked)}
                            className="mr-2 rounded text-reg-accent"
                        />
                        <span>{typeof obj?.prompt === 'string' ? promptLookup(context, obj.prompt) : key}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

// Exclusive checkbox list: at most one option can be checked at a time (but none is allowed).
const ExclusiveCheckboxMap = ({
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
    label?: string;
}) => {
    const config = context.config?.[configKey] as Record<string, { prompt: string; order?: number; retreatRequired?: string; pool?: string }> | undefined;
    const eventCode = context.event?.aid;
    if (!config) return <div className="text-reg-muted text-sm">No options configured ({configKey})</div>;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const mapName = configKey.replace('Config', '');
    const map = context.student?.programs?.[eventCode]?.[mapName] as Record<string, boolean> | undefined;
    const safeMap = map && typeof map === 'object' ? map : {};
    const checkElig = getCheckEligibility(context);
    const entries = Object.entries(config)
        .filter(([, obj]) => {
            if (obj?.pool && eventCode && !checkElig(obj.pool, context.student, eventCode, pools)) {
                return false;
            }
            if (obj?.retreatRequired && !whichRetreats[obj.retreatRequired]) return false;
            return true;
        })
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)));

    const selectedKey = entries.find(([key]) => safeMap[key])?.[0] ?? null;

    const toggle = (key: string, checked: boolean) => {
        const next: Record<string, boolean> = {};
        if (checked) {
            // set only this key true
            next[key] = true;
        }
        engineOnChange(`${basePath}.${mapName}`, next);
    };

    return (
        <div className="mb-4">
            {label ? <label className="block text-sm font-medium mb-2 text-reg-muted">{label}</label> : null}
            <div className="space-y-2 border border-reg-border rounded p-3 bg-reg-card-muted">
                {entries.map(([key, obj]) => (
                    <label key={key} className="flex items-center text-reg-muted">
                        <input
                            type="checkbox"
                            checked={selectedKey === key}
                            onChange={(e) => toggle(key, e.target.checked)}
                            className="mr-2 rounded text-reg-accent"
                        />
                        <span>{typeof obj?.prompt === 'string' ? promptLookup(context, obj.prompt) : key}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

// --- Introduction (first step; prompt 'introduction' with HTML; macros: ||title||, ||coord-email-href||, ||coord-email||) ---
// Use ||coord-email-href|| in href (e.g. <a href="||coord-email-href||">) and ||coord-email|| for link text.
export const RenderIntroduction: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context }) => {
    let text = promptLookup(context, 'introduction') || '';
    const title = promptLookup(context, 'title') || '';
    const coordEmail = context.event?.config?.coordEmailAmericas ?? '';
    const coordEmailHref = coordEmail ? `mailto:${coordEmail.replace(/"/g, '&quot;').replace(/&/g, '&amp;')}` : '';
    const coordEmailText = coordEmail ? coordEmail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    text = text.replace(/\|\|title\|\|/g, title);
    text = text.replace(/\|\|coord-email-href\|\|/g, coordEmailHref);
    text = text.replace(/\|\|coord-email\|\|/g, coordEmailText);
    return (
        <div
            className="prose prose-invert max-w-none text-reg-text introduction-html"
            dangerouslySetInnerHTML={{ __html: text }}
        />
    );
};

export const RenderWrittenTranslation: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void, value: any }> = ({ context, engineOnChange, value }) => {
    const languages = [
        { value: "English", label: "English" },
        { value: "Chinese", label: "中文" },
        { value: "Czech", label: "čeština" },
        { value: "German", label: "Deutsch" },
        { value: "Spanish", label: "Español" },
        { value: "French", label: "Français" },
        { value: "Italian", label: "Italiano" },
        { value: "Dutch", label: "Nederlands" },
        { value: "Portuguese", label: "Português" },
        { value: "Russian", label: "русский" }
    ];

    return (
        <div className="p-4 bg-reg-card-muted rounded border border-reg-border">
            <div className="flex items-center mb-4 text-reg-accent">
                <FontAwesomeIcon icon={faGlobe} className="mr-2" />
                <h3 className="text-lg font-medium">{promptLookup(context, 'selectLanguage')}</h3>
            </div>
            <SelectField
                label=""
                value={value ?? context.student.writtenLangPref ?? 'English'}
                onChange={(val: any) => engineOnChange('student.writtenLangPref', val)}
                options={languages}
            />
        </div>
    );
};

export const RenderSpokenTranslation: React.FC<{ context: ScriptContext, engineOnChange: (path: string, val: any) => void, value: any }> = ({ context, engineOnChange, value }) => {
    const languages = [
        { value: "English", label: "English" },
        { value: "Chinese", label: "中文" },
        { value: "Czech", label: "čeština" },
        { value: "German", label: "Deutsch" },
        { value: "Spanish", label: "Español" },
        { value: "French", label: "Français" },
        { value: "Italian", label: "Italiano" },
        { value: "Dutch", label: "Nederlands" },
        { value: "Portuguese", label: "Português" },
        { value: "Russian", label: "русский" }
    ];

    return (
        <div className="p-4 bg-reg-card-muted rounded border border-reg-border">
            <div className="flex items-center mb-4 text-reg-accent">
                <FontAwesomeIcon icon={faGlobe} className="mr-2" />
                <h3 className="text-lg font-medium">{promptLookup(context, 'selectLanguage')}</h3>
            </div>
            <SelectField
                label=""
                value={value ?? context.student.spokenLangPref ?? 'English'}
                onChange={(val: any) => engineOnChange('student.spokenLangPref', val)}
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
            <textarea
                className="w-full p-2 rounded bg-reg-input border border-reg-border focus:border-reg-focus-ring text-reg-text h-32"
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
        <div className="p-4 bg-reg-card-muted border border-reg-border rounded">
            <p className="mb-4 text-reg-muted italic">"I agree to maintain the confidentiality of the teachings..." (Placeholder Oath Text)</p>
            <div className="flex items-center">
                <input
                    type="checkbox"
                    className="mr-2 rounded bg-reg-input border border-reg-border text-reg-accent focus:ring-reg-focus-ring"
                    checked={!!oath}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.oath`, e.target.checked)}
                />
                <label className="text-sm font-medium text-reg-text">I Agree</label>
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
                <label className="block text-sm font-medium mb-1 text-reg-muted">{promptLookup(context, 'selectCountry')}</label>
                <select
                    className="w-full p-2 rounded bg-reg-input border border-reg-border focus:border-reg-focus-ring text-reg-text"
                    value={country || ''}
                    onChange={(e) => engineOnChange('student.country', e.target.value)}
                >
                    <option value="">Select country...</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            {(country === 'United States' || country === 'Canada') && (
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1 text-reg-muted">{promptLookup(context, 'selectStateProvince')}</label>
                    <select
                        className="w-full p-2 rounded bg-reg-input border border-reg-border focus:border-reg-focus-ring text-reg-text"
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
    if (!oneVY) return <div className="text-reg-muted text-sm">This step applies when you have selected exactly one Vajrayana retreat.</div>;

    const config = context.config?.prefNecConfig as Record<string, { prompt: string; order?: number; pool?: string; radioGroups?: string[] }> | undefined;
    if (!config) return <div className="text-reg-muted text-sm">No prefNecConfig configured.</div>;

    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const checkElig = getCheckEligibility(context);
    const entries = Object.entries(config)
        .filter(([, obj]) => !obj?.pool || (eventCode && checkElig(obj.pool, context.student, eventCode, pools)))
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
            <div className="space-y-2 border border-reg-border rounded p-3 bg-reg-card-muted">
                {entries.map(({ key, prompt }) => (
                    <label key={key} className="flex items-center text-reg-muted">
                        <input
                            type="radio"
                            name="prefNec"
                            checked={selectedKey === key}
                            onChange={() => handleSelect(key)}
                            className="mr-2 rounded text-reg-accent"
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
    return <RadioYesNo context={context} path={path} label="" engineOnChange={engineOnChange} />;
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

// --- In-person teachings (stored at student root; applies to all events) ---
// Step title from promptKey only; no duplicate label above Yes/No
export const RenderInPersonTeachings: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => (
    <RadioYesNo context={context} path="student.inPersonTeachings" label="" engineOnChange={engineOnChange} />
);

// --- Interested in setup (setupConfig: "no" mutually exclusive with {setup1, setup2, setup3}; setup1/2/3 can be checked in any combination) ---
export const RenderInterestedInSetup: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const config = context.config?.setupConfig as Record<string, { prompt: string; order?: number; pool?: string; radioGroups?: string[] }> | undefined;
    if (!config) return <div className="text-reg-muted text-sm">No setupConfig configured.</div>;

    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const checkElig = getCheckEligibility(context);
    const allEntries = Object.entries(config)
        .filter(([, obj]) => !obj?.pool || (eventCode && checkElig(obj.pool, context.student, eventCode, pools)))
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
            <div className="space-y-2 border border-reg-border rounded p-3 bg-reg-card-muted">
                {allEntries.map((entry) => {
                    if (entry.key === exclusiveKey && noEntry) {
                        return (
                            <label key={entry.key} className="flex items-center text-reg-muted">
                                <input
                                    type="checkbox"
                                    checked={noChecked}
                                    onChange={(e) => handleNoChange(e.target.checked)}
                                    className="mr-2 rounded text-reg-accent"
                                />
                                <span>{promptLookup(context, noEntry.prompt)}</span>
                            </label>
                        );
                    }
                    if (multiGroupKeys.has(entry.key)) {
                        return (
                            <label key={entry.key} className="flex items-center text-reg-muted">
                                <input
                                    type="checkbox"
                                    checked={multiChecked(entry.key)}
                                    onChange={(e) => handleMultiChange(entry.key, e.target.checked)}
                                    className="mr-2 rounded text-reg-accent"
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

// --- Share email (Yes/No) ---
export const RenderShareEmail: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    return <RadioYesNo context={context} path={`student.programs.${eventCode}.shareEmail`} label="" engineOnChange={engineOnChange} />;
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

// --- Service no question (service map; only when serviceAlready is false). "happy" is mutually exclusive; other options can be combined. ---
export const RenderServiceNoQuestion: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const serviceAlready = context.student?.programs?.[eventCode]?.serviceAlready;
    if (serviceAlready === true) return <div className="text-reg-muted text-sm">Skipped (you indicated you already serve).</div>;

    const config = context.config?.serviceConfig as Record<string, { prompt: string; order?: number; retreatRequired?: string; pool?: string }> | undefined;
    if (!config) return <div className="text-reg-muted text-sm">No options configured (serviceConfig)</div>;

    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    const pools = Array.isArray((context as any).pools) ? (context as any).pools : [];
    const basePath = `student.programs.${eventCode}`;
    const mapName = 'service';
    const map = context.student?.programs?.[eventCode]?.[mapName] as Record<string, boolean> | undefined;
    const safeMap = map && typeof map === 'object' ? map : {};
    const checkElig = getCheckEligibility(context);

    const entries = Object.entries(config)
        .filter(([, obj]) => {
            if (obj?.pool && eventCode && !checkElig(obj.pool, context.student, eventCode, pools)) {
                return false;
            }
            if (obj?.retreatRequired && !whichRetreats[obj.retreatRequired]) return false;
            return true;
        })
        .sort((a, b) => ((a[1]?.order ?? 0) - (b[1]?.order ?? 0)));

    const happyKey = 'happy';
    const happyChecked = !!safeMap[happyKey];

    const toggleHappy = (checked: boolean) => {
        const next: Record<string, boolean> = {};
        if (checked) {
            next[happyKey] = true;
        }
        // when happy is (re)selected, clear all other flags
        engineOnChange(`${basePath}.${mapName}`, next);
    };

    const toggleOther = (key: string, checked: boolean) => {
        const next: Record<string, boolean> = { ...safeMap };
        // any non-happy selection clears happy
        delete next[happyKey];
        if (checked) next[key] = true;
        else delete next[key];
        engineOnChange(`${basePath}.${mapName}`, next);
    };

    return (
        <div className="mb-4">
            <div className="space-y-2 border border-reg-border rounded p-3 bg-reg-card-muted">
                {entries.map(([key, obj]) => {
                    const isHappy = key === happyKey;
                    const checked = !!safeMap[key];
                    const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
                        isHappy ? toggleHappy(e.target.checked) : toggleOther(key, e.target.checked);
                    return (
                        <label key={key} className="flex items-center text-reg-muted">
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={onChange}
                                className="mr-2 rounded text-reg-accent"
                            />
                            <span>{typeof obj?.prompt === 'string' ? promptLookup(context, obj.prompt) : key}</span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

// --- Service contact (checkbox map) ---
export const RenderServiceContact: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const basePath = `student.programs.${eventCode}`;
    return (
        <ExclusiveCheckboxMap context={context} configKey="serviceContactConfig" basePath={basePath} engineOnChange={engineOnChange} />
    );
};

// --- Accessibility (Yes/No; if Yes, accessibilityDetails; respect noAccessibilityDetails) ---
export const RenderAccessibility: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const accessibility = context.student?.accessibility;
    const details = context.student?.accessibilityDetails ?? '';
    const noDetails = context.config?.noAccessibilityDetails;

    return (
        <div className="space-y-4">
            <RadioYesNo context={context} path="student.accessibility" label="" engineOnChange={engineOnChange} />
            {accessibility && !noDetails && (
                <InputField label={promptLookup(context, 'accessibilityDetails')} value={details} onChange={(v: string) => engineOnChange('student.accessibilityDetails', v)} />
            )}
        </div>
    );
};

// --- Supplication: body text + all current signers appended at bottom; list updates when user adds/removes name via visible question ---
export const RenderSupplication: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void; titleKey: string; bodyKey: string; retreat?: string; joinKey: string }> = ({ context, bodyKey, retreat, joinKey, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const whichRetreats = context.student?.programs?.[eventCode]?.whichRetreats || {};
    if (retreat && !objKeysInc(whichRetreats, retreat)) return null;
    const body = promptLookup(context, bodyKey);
    const signersByAid = context.signers ?? {};
    const aidKey = eventCode
        ? eventCode + (retreat === 'mahayana' ? '-my' : retreat === 'vajrayana' ? '-vy' : '')
        : '';
    const signers: string[] = aidKey ? (signersByAid[aidKey] ?? []) : [];
    const signerText = signers.length ? '\n\n' + signers.map((s: string) => s + '\n').join('') : '';

    const programsForEvent = eventCode ? context.student?.programs?.[eventCode] || {} : {};
    const joinPath = eventCode ? `student.programs.${eventCode}.${joinKey}` : '';
    const visiblePath = eventCode ? `student.programs.${eventCode}.visible` : '';
    const joinVal = eventCode ? programsForEvent?.[joinKey] : undefined;

    return (
        <div className="p-4 bg-reg-card-muted rounded border border-reg-border space-y-4">
            <textarea
                readOnly
                rows={10}
                className="w-full p-3 rounded bg-reg-panel border border-reg-border text-reg-text text-sm leading-relaxed"
                value={body + signerText}
            />
            {eventCode && (
                <div>
                    <RadioYesNo
                        context={context}
                        path={joinPath}
                        label={promptLookup(context, joinKey)}
                        engineOnChange={engineOnChange}
                    />
                </div>
            )}
            {eventCode && joinVal === true && (
                <div>
                    <RadioYesNo
                        context={context}
                        path={visiblePath}
                        label={promptLookup(context, 'visible')}
                        engineOnChange={engineOnChange}
                    />
                </div>
            )}
        </div>
    );
};

export const RenderSupplicationMY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = (props) => (
    <RenderSupplication {...props} titleKey="supplicationTitleMY" bodyKey="supplicationBodyMY" retreat="mahayana" joinKey="joinMY" />
);
export const RenderSupplicationVY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = (props) => (
    <RenderSupplication {...props} titleKey="supplicationTitleVY" bodyKey="supplicationBodyVY" retreat="vajrayana" joinKey="joinVY" />
);
export const RenderSupplicationGeneric: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = (props) => (
    <RenderSupplication {...props} titleKey="supplicationTitle" bodyKey="supplicationBody" joinKey="join" />
);

// --- Join (retreat-specific: joinMY, joinVY) ---
// (Now handled inside RenderSupplication; these remain defined but are hidden via step conditions.)
export const RenderJoinMY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => (
    <RadioYesNo context={context} path={`student.programs.${context.event?.aid}.joinMY`} label={promptLookup(context, 'joinMY')} engineOnChange={engineOnChange} />
);
export const RenderJoinVY: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => (
    <RadioYesNo context={context} path={`student.programs.${context.event?.aid}.joinVY`} label={promptLookup(context, 'joinVY')} engineOnChange={engineOnChange} />
);

// --- Visible signature ---
// (Now handled inside RenderSupplication; this export remains for compatibility if referenced elsewhere.)
export const RenderVisibleSignature: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    return <RadioYesNo context={context} path={`student.programs.${eventCode}.visible`} label={promptLookup(context, 'visible')} engineOnChange={engineOnChange} />;
};

// --- Social media (title from promptKey; checkbox shows agree prompt; agreeRequired validation) ---
export const RenderSocialMedia: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const checked = !!context.student?.programs?.[eventCode]?.socialMedia;

    return (
        <div className="mb-2">
            <label className="flex items-center text-reg-muted">
                <input
                    type="checkbox"
                    className="mr-2 rounded text-reg-accent"
                    checked={checked}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.socialMedia`, e.target.checked)}
                />
                <span>{promptLookup(context, 'agree')}</span>
            </label>
        </div>
    );
};

// --- Series commitment (same pattern as socialMedia; promptKey seriesCommitment) ---
export const RenderSeriesCommitment: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const checked = !!context.student?.programs?.[eventCode]?.seriesCommitment;

    return (
        <div className="mb-2">
            <label className="flex items-center text-reg-muted">
                <input
                    type="checkbox"
                    className="mr-2 rounded text-reg-accent"
                    checked={checked}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.seriesCommitment`, e.target.checked)}
                />
                <span>{promptLookup(context, 'agree')}</span>
            </label>
        </div>
    );
};

// --- Abhisheka commitment (same pattern as seriesCommitment; promptKey abhishekaCommitment) ---
export const RenderAbhishekaCommitment: React.FC<{ context: ScriptContext; engineOnChange: (path: string, val: any) => void }> = ({ context, engineOnChange }) => {
    const eventCode = context.event?.aid;
    const checked = !!context.student?.programs?.[eventCode]?.abhishekaCommitment;

    return (
        <div className="mb-2">
            <label className="flex items-center text-reg-muted">
                <input
                    type="checkbox"
                    className="mr-2 rounded text-reg-accent"
                    checked={checked}
                    onChange={(e) => engineOnChange(`student.programs.${eventCode}.abhishekaCommitment`, e.target.checked)}
                />
                <span>{promptLookup(context, 'agree')}</span>
            </label>
        </div>
    );
};

// --- Save (persist student and call onComplete from context). Title from mustSave; Cancel/Save in engine footer. ---
export const RenderSave = React.forwardRef<
    { save: () => Promise<void> },
    { context: ScriptContext; engineOnChange: (path: string, val: any) => void }
>(({ context }, ref) => {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onComplete = (context as any).onComplete;
    const pid = (context as any).pid;
    const hash = (context as any).hash;

    const handleSave = async () => {
        if ((context as any).student?.debug?.registerTest === true) {
            (context as any).onDebugTableRequest?.();
            return;
        }
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

    React.useImperativeHandle(ref, () => ({ save: handleSave }));

    if (error) {
        return <p className="text-reg-error text-sm">{error}</p>;
    }
    return null;
});
RenderSave.displayName = 'RenderSave';
