/**
 * @file packages/sharedFrontend/src/prompts.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the prompts used in the application.
 */

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

/**
 * @function setPrompts
 * @description Sets the prompts for the application.
 * @param {Record<string, Record<string, Record<string, string>>>} newPrompts - The new prompts.
 */
export const setPrompts = (newPrompts: Record<string, Record<string, Record<string, string>>>) => {
    prompts = newPrompts;
};

/**
 * @function setStudent
 * @description Sets the student for the application.
 * @param {Student} newStudent - The new student.
 */
export const setStudent = (newStudent: Student) => {
    student = newStudent;
};

/**
 * @function setEvent
 * @description Sets the event for the application.
 * @param {Event} newEvent - The new event.
 */
export const setEvent = (newEvent: Event) => {
    event = newEvent;
};

/**
 * @function updateLanguage
 * @description Updates the language preference for the student.
 * @param {string} newLanguage - The new language.
 */
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

/**
 * @function dbgout
 * @description Logs a debug message to the console if debugging is enabled.
 * @param {any[]} args - The arguments to log.
 */
export const dbgout = (...args: any[]) => {
    if (dbgOut()) {
        console.log(...args);
    }
};

/**
 * @function promptLookup
 * @description Looks up a prompt in the prompts object.
 * @param {string} prompt - The name of the prompt to look up.
 * @returns {string} The text of the prompt.
 */
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

/**
 * @function promptLookupAIDSpecific
 * @description Looks up an AID-specific prompt in the prompts object.
 * @param {string} aid - The AID of the event.
 * @param {string | undefined} aidAlias - The alias for the AID.
 * @param {string} prompt - The name of the prompt to look up.
 * @returns {string} The text of the prompt.
 */
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

/**
 * @function promptLookupHTML
 * @description Looks up an HTML prompt in the prompts object.
 * @param {string} prompt - The name of the prompt to look up.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
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

/**
 * @function promptLookupHTMLAIDSpecific
 * @description Looks up an AID-specific HTML prompt in the prompts object.
 * @param {string} laid - The AID of the event.
 * @param {string} prompt - The name of the prompt to look up.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
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

/**
 * @function promptLookupDescription
 * @description Looks up a description prompt in the prompts object.
 * @param {string} prompt - The name of the prompt to look up.
 * @returns {{ __html: string } | null} An object with an __html property containing the HTML text of the prompt, or null if the prompt is not found.
 */
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

/**
 * @function promptLookupHTMLWithArgs
 * @description Looks up an HTML prompt in the prompts object and replaces placeholders with arguments.
 * @param {string} prompt - The name of the prompt to look up.
 * @param {string} arg1 - The first argument.
 * @param {string} arg2 - The second argument.
 * @param {string} arg3 - The third argument.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
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

/**
 * @function promptLookupHTMLWithArgsAIDSpecific
 * @description Looks up an AID-specific HTML prompt in the prompts object and replaces placeholders with arguments.
 * @param {string} laid - The AID of the event.
 * @param {string} prompt - The name of the prompt to look up.
 * @param {string} arg1 - The first argument.
 * @param {string} arg2 - The second argument.
 * @param {string} arg3 - The third argument.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
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

/**
 * @function setPromptCache
 * @description Sets the prompt cache.
 * @param {Record<string, Record<string, string>>} newCache - The new prompt cache.
 */
export const setPromptCache = (newCache: Record<string, Record<string, string>>) => {
    promptCache = newCache;
};

/**
 * @function setTier1Loaded
 * @description Sets the tier 1 loaded flag.
 * @param {boolean} loaded - The new value for the flag.
 */
export const setTier1Loaded = (loaded: boolean) => {
    tier1Loaded = loaded;
};

/**
 * @function setTier2Loaded
 * @description Sets the tier 2 loaded flag.
 * @param {boolean} loaded - The new value for the flag.
 */
export const setTier2Loaded = (loaded: boolean) => {
    tier2Loaded = loaded;
};

/**
 * @function setCurrentLanguage
 * @description Sets the current language.
 * @param {string} language - The new language.
 */
export const setCurrentLanguage = (language: string) => {
    currentLanguage = language;
};

/**
 * @function promptLookupCache
 * @description Looks up a prompt in the prompt cache.
 * @param {string} eventCode - The event code.
 * @param {string} promptName - The name of the prompt to look up.
 * @returns {string} The text of the prompt.
 */
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

/**
 * @function promptLookupCacheAIDSpecific
 * @description Looks up an AID-specific prompt in the prompt cache.
 * @param {string} aid - The AID of the event.
 * @param {string | undefined} aidAlias - The alias for the AID.
 * @param {string} promptName - The name of the prompt to look up.
 * @returns {string} The text of the prompt.
 */
export const promptLookupCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string): string => {
    const eventCode = aidAlias || aid;
    return promptLookupCache(eventCode, promptName);
};

/**
 * @function promptLookupHTMLCache
 * @description Looks up an HTML prompt in the prompt cache.
 * @param {string} eventCode - The event code.
 * @param {string} promptName - The name of the prompt to look up.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
export const promptLookupHTMLCache = (eventCode: string, promptName: string): { __html: string } => {
    const text = promptLookupCache(eventCode, promptName);
    let processedText = text;

    // Apply the same replacements as the original function
    processedText = processedText.replace("||title||", promptLookupCache(eventCode, "title"));
    processedText = processedText.replace("||deadline||", promptLookupCache(eventCode, "deadline"));
    processedText = processedText.replace(/\|\|email\|\|/g, student.email || '');

    return { __html: processedText };
};

/**
 * @function promptLookupHTMLCacheAIDSpecific
 * @description Looks up an AID-specific HTML prompt in the prompt cache.
 * @param {string} aid - The AID of the event.
 * @param {string | undefined} aidAlias - The alias for the AID.
 * @param {string} promptName - The name of the prompt to look up.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
export const promptLookupHTMLCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string): { __html: string } => {
    const eventCode = aidAlias || aid;
    return promptLookupHTMLCache(eventCode, promptName);
};

/**
 * @function promptLookupHTMLWithArgsCache
 * @description Looks up an HTML prompt in the prompt cache and replaces placeholders with arguments.
 * @param {string} eventCode - The event code.
 * @param {string} promptName - The name of the prompt to look up.
 * @param {string} arg1 - The first argument.
 * @param {string} arg2 - The second argument.
 * @param {string} arg3 - The third argument.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
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

/**
 * @function promptLookupHTMLWithArgsCacheAIDSpecific
 * @description Looks up an AID-specific HTML prompt in the prompt cache and replaces placeholders with arguments.
 * @param {string} aid - The AID of the event.
 * @param {string | undefined} aidAlias - The alias for the AID.
 * @param {string} promptName - The name of the prompt to look up.
 * @param {string} arg1 - The first argument.
 * @param {string} arg2 - The second argument.
 * @param {string} arg3 - The third argument.
 * @returns {{ __html: string }} An object with an __html property containing the HTML text of the prompt.
 */
export const promptLookupHTMLWithArgsCacheAIDSpecific = (aid: string, aidAlias: string | undefined, promptName: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    const eventCode = aidAlias || aid;
    return promptLookupHTMLWithArgsCache(eventCode, promptName, arg1, arg2, arg3);
};

/**
 * @function processPromptCacheResults
 * @description Converts cache results to the new internal format.
 * @param {any} results - The results to convert.
 * @returns {Record<string, Record<string, Record<string, string>>>} The converted results.
 */
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