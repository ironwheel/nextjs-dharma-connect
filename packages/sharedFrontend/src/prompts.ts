// packages/sharedFrontend/src/prompts.ts

// Types for prompts
export interface Prompt {
    prompt: string;
    language: string;
    aid?: string;
    text: string;
    dnt?: boolean;
    lsb?: string;
}

export interface Student {
    writtenLangPref?: string;
    email?: string;
    first?: string;
    last?: string;
    coordEmail?: string;
    debug?: {
        dbgout?: boolean;
        prompt?: boolean;
        localHost?: boolean;
    };
}

export interface Event {
    aid: string;
    config?: {
        aidAlias?: string;
    };
}

// Global variables (these will be set by the consuming apps)
let prompts: Record<string, Record<string, Record<string, string>>> = {}; // eventCode.promptName.language.text
let student: Student = {};
let event: Event = { aid: 'dashboard' };

// Setter functions for the consuming apps to use
export const setPrompts = (newPrompts: Record<string, Record<string, Record<string, string>>>) => {
    prompts = newPrompts;
};

export const setStudent = (newStudent: Student) => {
    student = newStudent;
};

export const setEvent = (newEvent: Event) => {
    event = newEvent;
};

// Function to update language preference
export const updateLanguage = (newLanguage: string) => {
    if (student) {
        student.writtenLangPref = newLanguage;
    }
};

// Debug functions
const dbgOut = () => {
    if (typeof student.debug === 'undefined') {
        return false;
    } else {
        return student.debug.dbgout;
    }
};

const dbgPrompt = () => {
    if (typeof student.debug === 'undefined') {
        return false;
    } else {
        return student.debug.prompt;
    }
};

export const dbgout = (...args: any[]) => {
    if (dbgOut()) {
        console.log(...args);
    }
};

// Main prompt lookup function
export const promptLookup = (prompt: string): string => {

    if (dbgPrompt()) {
        dbgout("PROMPT*** LOOKUP:", prompt);
    }

    if (!prompts) {
        dbgout("PROMPT*** UNDEFINED");
        return "prompts undefined";
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[event.aid]?.[prompt]?.[language]) {
        if (dbgPrompt()) {
            dbgout("PROMPT FOUND:", event.aid, prompt, language);
        }
        return prompts[event.aid][prompt][language];
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPT UNKNOWN:", prompt, language);
    }

    return `${event.aid}-${prompt}-${language}-unknown`;
};

// Aid-specific prompt lookup
export const promptLookupAIDSpecific = (aid: string, aidAlias: string | undefined, prompt: string): string => {
    if (dbgPrompt()) {
        dbgout("PROMPT*** LOOKUP:", prompt);
    }

    if (!prompts) {
        dbgout("PROMPT*** UNDEFINED");
        return "prompts undefined";
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // if there's an aid alias, use it instead
    if (aidAlias) {
        aid = aidAlias;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[aid]?.[prompt]?.[language]) {
        if (dbgPrompt()) {
            dbgout("PROMPT AID FOUND:", aid, prompt, language);
        }
        return prompts[aid][prompt][language];
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPT UNKNOWN:", prompt, language);
    }

    return `${aid}-${prompt}-${language}-unknown`;
};

// HTML prompt lookup
export const promptLookupHTML = (prompt: string): { __html: string } => {
    if (dbgPrompt()) {
        dbgout("PROMPTHTML*** LOOKUP:", prompt);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[event.aid]?.[prompt]?.[language]) {
        let text = prompts[event.aid][prompt][language];
        text = text.replace("||title||", promptLookup("title"));
        text = text.replace("||deadline||", promptLookup("deadline"));
        text = text.replace(/\|\|email\|\|/g, student.email || '');
        if (dbgPrompt()) {
            dbgout("PROMPTHTML FOUND:", event.aid, prompt, language);
        }
        return { __html: text };
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPTHTML UNKNOWN:", prompt, language);
    }
    return { __html: `${event.aid}-${prompt}-${language}-unknown` };
};

// Aid-specific HTML prompt lookup
export const promptLookupHTMLAIDSpecific = (laid: string, prompt: string): { __html: string } => {
    if (dbgPrompt()) {
        dbgout("PROMPTHTML*** LOOKUP:", prompt);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[laid]?.[prompt]?.[language]) {
        let text = prompts[laid][prompt][language];
        text = text.replace("||title||", promptLookup("title"));
        text = text.replace("||deadline||", promptLookup("deadline"));
        text = text.replace(/\|\|email\|\|/g, student.email || '');
        if (dbgPrompt()) {
            dbgout("PROMPTHTML AID FOUND:", laid, prompt, language);
        }
        return { __html: text };
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPTHTML UNKNOWN:", prompt, language);
    }
    return { __html: `${laid}-${prompt}-${language}-unknown` };
};

// Description prompt lookup
export const promptLookupDescription = (prompt: string): { __html: string } | null => {
    if (dbgPrompt()) {
        dbgout("PROMPTDESCRIPTION LOOKUP:", prompt);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.['descriptions']?.[prompt]?.[language]) {
        const text = prompts['descriptions'][prompt][language];
        // the system may have created empty prompts to translate
        if (text.length === 0) {
            return null;
        }
        let processedText = text;
        processedText = processedText.replace("||title||", promptLookup("title"));
        processedText = processedText.replace("||deadline||", promptLookup("deadline"));
        processedText = processedText.replace(/\|\|email\|\|/g, student.email || '');
        if (dbgPrompt()) {
            dbgout("PROMPTDESCRIPTION FOUND:", 'descriptions', prompt, language);
        }
        return { __html: processedText };
    }

    return null;
};

// HTML prompt lookup with arguments
export const promptLookupHTMLWithArgs = (prompt: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[event.aid]?.[prompt]?.[language]) {
        let text = prompts[event.aid][prompt][language];
        if (typeof arg1 !== 'undefined') {
            text = text.replace("||arg1||", arg1);
        }
        if (typeof arg2 !== 'undefined') {
            text = text.replace("||arg2||", arg2);
        }
        if (typeof arg3 !== 'undefined') {
            text = text.replace("||arg3||", arg3);
        }
        return { __html: text };
    }

    return { __html: `${event.aid}-${prompt}-${language}-unknown` };
};

// Aid-specific HTML prompt lookup with arguments
export const promptLookupHTMLWithArgsAIDSpecific = (laid: string, prompt: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // New format: eventCode.promptName.language.text
    if (prompts?.[laid]?.[prompt]?.[language]) {
        let text = prompts[laid][prompt][language];
        if (typeof arg1 !== 'undefined') {
            text = text.replace("||arg1||", arg1);
        }
        if (typeof arg2 !== 'undefined') {
            text = text.replace("||arg2||", arg2);
        }
        if (typeof arg3 !== 'undefined') {
            text = text.replace("||arg3||", arg3);
        }
        return { __html: text };
    }

    return { __html: `${laid}-${prompt}-${language}-unknown` };
};

// New prompt cache system for two-tiered loading
interface PromptCacheItem {
    eventCode: string;
    promptKey: string;
    text: string;
}

// Global variables for the new cache system
let promptCache: Record<string, Record<string, string>> = {}; // {eventCode: {promptKey: text}}
let tier1Loaded = false;
let tier2Loaded = false;
let currentLanguage = "English";

// Setter functions for the new cache system
export const setPromptCache = (newCache: Record<string, Record<string, string>>) => {
    promptCache = newCache;
};

export const setTier1Loaded = (loaded: boolean) => {
    tier1Loaded = loaded;
};

export const setTier2Loaded = (loaded: boolean) => {
    tier2Loaded = loaded;
};

export const setCurrentLanguage = (language: string) => {
    currentLanguage = language;
};

// New prompt lookup function for the cache system
export const promptLookupCache = (eventCode: string, promptName: string): string => {

    if (!promptCache[eventCode]) {
        return `${eventCode}-${promptName}-${currentLanguage}-unknown`;
    }

    const promptKey = `1#${currentLanguage}#${promptName}`;

    const text = promptCache[eventCode][promptKey];

    if (text) {
        return text;
    }

    return `${eventCode}-${promptName}-${currentLanguage}-unknown`;
};

// Aid-specific prompt lookup for the cache system
export const promptLookupCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string): string => {
    const eventCode = aidAlias || aid;
    return promptLookupCache(eventCode, promptName);
};

// HTML prompt lookup for the cache system
export const promptLookupHTMLCache = (eventCode: string, promptName: string): { __html: string } => {
    const text = promptLookupCache(eventCode, promptName);
    let processedText = text;

    // Apply the same replacements as the original function
    processedText = processedText.replace("||title||", promptLookupCache(eventCode, "title"));
    processedText = processedText.replace("||deadline||", promptLookupCache(eventCode, "deadline"));
    processedText = processedText.replace(/\|\|email\|\|/g, student.email || '');

    return { __html: processedText };
};

// Aid-specific HTML prompt lookup for the cache system
export const promptLookupHTMLCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string): { __html: string } => {
    const eventCode = aidAlias || aid;
    return promptLookupHTMLCache(eventCode, promptName);
};

// HTML prompt lookup with arguments for the cache system
export const promptLookupHTMLWithArgsCache = (eventCode: string, promptName: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    const text = promptLookupCache(eventCode, promptName);
    let processedText = text;

    if (typeof arg1 !== 'undefined') {
        processedText = processedText.replace("||arg1||", arg1);
    }
    if (typeof arg2 !== 'undefined') {
        processedText = processedText.replace("||arg2||", arg2);
    }
    if (typeof arg3 !== 'undefined') {
        processedText = processedText.replace("||arg3||", arg3);
    }

    return { __html: processedText };
};

// Aid-specific HTML prompt lookup with arguments for the cache system
export const promptLookupHTMLWithArgsCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    const eventCode = aidAlias || aid;
    return promptLookupHTMLWithArgsCache(eventCode, promptName, arg1, arg2, arg3);
};

// Helper function to convert cache results to the new internal format
export const processPromptCacheResults = (results: any): Record<string, Record<string, Record<string, string>>> => {
    const processed: Record<string, Record<string, Record<string, string>>> = {};

    // Handle different result formats
    if (Array.isArray(results)) {
        // If results is a direct array of items
        for (const item of results) {
            if (item.eventCode && item.promptKey && item.text) {
                const parts = item.promptKey.split('#');
                if (parts.length >= 3) {
                    const tier = parts[0];
                    const language = parts[1];
                    const promptName = parts[2];

                    if (!processed[item.eventCode]) {
                        processed[item.eventCode] = {};
                    }
                    if (!processed[item.eventCode][promptName]) {
                        processed[item.eventCode][promptName] = {};
                    }
                    processed[item.eventCode][promptName][language] = item.text;
                }
            }
        }
    } else if (typeof results === 'object' && results !== null) {
        // If results is an object with eventCode keys
        for (const [eventCode, items] of Object.entries(results)) {
            if (Array.isArray(items)) {
                if (!processed[eventCode]) {
                    processed[eventCode] = {};
                }
                for (const item of items) {
                    if (item.eventCode && item.promptKey && item.text) {
                        const parts = item.promptKey.split('#');
                        if (parts.length >= 3) {
                            const tier = parts[0];
                            const language = parts[1];
                            const promptName = parts[2];

                            if (!processed[eventCode][promptName]) {
                                processed[eventCode][promptName] = {};
                            }
                            if (!processed[eventCode][promptName][language]) {
                                processed[eventCode][promptName][language] = item.text;
                            }
                        }
                    }
                }
            }
        }
    }

    return processed;
}; 