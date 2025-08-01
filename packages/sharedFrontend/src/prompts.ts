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
let prompts: Prompt[] = [];
let student: Student = {};
let event: Event = { aid: 'dashboard' };

// Setter functions for the consuming apps to use
export const setPrompts = (newPrompts: Prompt[]) => {
    prompts = newPrompts;
};

export const setStudent = (newStudent: Student) => {
    student = newStudent;
};

export const setEvent = (newEvent: Event) => {
    event = newEvent;
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

    // aid-specific
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith(event.aid)) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPT AID:", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === (event.aid + '-' + prompt) && prompts[i]['language'] === language) {
            if (dbgPrompt()) {
                dbgout("PROMPT AID RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
            }
            return prompts[i]['text'];
        }
    }

    // default
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith('default')) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPT DEFAULT:", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === ('default-' + prompt) && ((prompts[i]['language'] === language) || (prompts[i]['language'] === 'universal'))) {
            if (dbgPrompt()) {
                dbgout("PROMPT DEFAULT RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
            }
            return prompts[i]['text'];
        }
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPT UNKNOWN:", prompt, language);
    }

    return event.aid + "-" + prompt + "-" + language + "-unknown";
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

    // aid-specific
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith(aid)) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPT AID:", i, prompts[i]['prompt'], prompts[i]['prompt'] === (aid + '-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === (aid + '-' + prompt) && prompts[i]['language'] === language) {
            if (dbgPrompt()) {
                dbgout("PROMPT AID RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === (aid + '-' + prompt), prompts[i]['language'], language);
            }
            return prompts[i]['text'];
        }
    }

    // default
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith('default')) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPT DEFAULT:", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === ('default-' + prompt) && ((prompts[i]['language'] === language) || (prompts[i]['language'] === 'universal'))) {
            if (dbgPrompt()) {
                dbgout("PROMPT DEFAULT RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
            }
            return prompts[i]['text'];
        }
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPT UNKNOWN:", prompt, language);
    }

    return aid + "-" + prompt + "-" + language + "-unknown";
};

// HTML prompt lookup
export const promptLookupHTML = (prompt: string): { __html: string } => {
    if (dbgPrompt()) {
        dbgout("PROMPTHTML*** LOOKUP:", prompt, prompts.length);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // aid specific
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith(event.aid)) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPTHTML AID:", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === (event.aid + '-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
            text = text.replace("||title||", promptLookup("title"));
            text = text.replace("||deadline||", promptLookup("deadline"));
            text = text.replace(/\|\|email\|\|/g, student.email || '');
            if (dbgPrompt()) {
                dbgout("PROMPTHTML AID RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
            }
            return { __html: text };
        }
    }

    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith('default')) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPTHTML DEFAULT:", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === ('default-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
            text = text.replace("||title||", promptLookup("title"));
            text = text.replace("||deadline||", promptLookup("deadline"));
            text = text.replace(/\|\|coord-email\|\|/g, student.coordEmail || '');
            text = text.replace(/\|\|email\|\|/g, student.email || '');
            if (dbgPrompt()) {
                dbgout("PROMPTHTML DEFAULT RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
            }
            return { __html: text };
        }
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPTHTML UNKNOWN:", prompt, language);
    }
    return { __html: event.aid + "-" + prompt + "-" + language + "-unknown" };
};

// Aid-specific HTML prompt lookup
export const promptLookupHTMLAIDSpecific = (laid: string, prompt: string): { __html: string } => {
    if (dbgPrompt()) {
        dbgout("PROMPTHTML*** LOOKUP:", prompt, prompts.length);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // aid specific
    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith(laid)) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPTHTML AID:", i, prompts[i]['prompt'], prompts[i]['prompt'] === (laid + '-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === (laid + '-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
            text = text.replace("||title||", promptLookup("title"));
            text = text.replace("||deadline||", promptLookup("deadline"));
            text = text.replace(/\|\|email\|\|/g, student.email || '');
            if (dbgPrompt()) {
                dbgout("PROMPTHTML AID RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === (laid + '-' + prompt), prompts[i]['language'], language);
            }
            return { __html: text };
        }
    }

    for (let i = 0; i < prompts.length; i++) {
        if (!prompts[i]['prompt'].startsWith('default')) {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPTHTML DEFAULT:", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === ('default-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
            text = text.replace("||title||", promptLookup("title"));
            text = text.replace("||deadline||", promptLookup("deadline"));
            text = text.replace(/\|\|coord-email\|\|/g, student.coordEmail || '');
            text = text.replace(/\|\|email\|\|/g, student.email || '');
            if (dbgPrompt()) {
                dbgout("PROMPTHTML DEFAULT RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === ('default-' + prompt), prompts[i]['language'], language);
            }
            return { __html: text };
        }
    }

    // unknown
    if (dbgPrompt()) {
        dbgout("PROMPTHTML UNKNOWN:", prompt, language);
    }
    return { __html: laid + "-" + prompt + "-" + language + "-unknown" };
};

// Description prompt lookup
export const promptLookupDescription = (prompt: string): { __html: string } | null => {
    if (dbgPrompt()) {
        dbgout("PROMPTDESCRIPTION LOOKUP:", prompt, prompts.length);
    }

    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    // descriptions specific
    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]['aid'] !== 'descriptions') {
            continue;
        }
        if (dbgPrompt()) {
            dbgout("PROMPTDESCRIPTION AID:", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
        }
        if (prompts[i]['prompt'] === ('descriptions-' + prompt) && prompts[i]['language'] === language) {
            // the system may have created empty prompts to translate
            if (prompts[i]['text'].length === 0) {
                return null;
            }
            let text = prompts[i]['text'];
            text = text.replace("||title||", promptLookup("title"));
            text = text.replace("||deadline||", promptLookup("deadline"));
            text = text.replace(/\|\|email\|\|/g, student.email || '');
            if (dbgPrompt()) {
                dbgout("PROMPTDESCRIPTION AID RETURNING :", i, prompts[i]['prompt'], prompts[i]['prompt'] === (event.aid + '-' + prompt), prompts[i]['language'], language);
            }
            return { __html: text };
        }
    }

    return null;
};

// HTML prompt lookup with arguments
export const promptLookupHTMLWithArgs = (prompt: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]['prompt'] === (event.aid + '-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
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
    }

    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]['prompt'] === ('default-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
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
    }

    return { __html: event.aid + "-" + prompt + "-" + language + "-unknown" };
};

// Aid-specific HTML prompt lookup with arguments
export const promptLookupHTMLWithArgsAIDSpecific = (laid: string, prompt: string, arg1?: string, arg2?: string, arg3?: string): { __html: string } => {
    let language = "English";
    if (typeof student.writtenLangPref !== 'undefined') {
        language = student.writtenLangPref;
    }

    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]['prompt'] === (laid + '-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
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
    }

    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]['prompt'] === ('default-' + prompt) && prompts[i]['language'] === language) {
            let text = prompts[i]['text'];
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
    }

    return { __html: laid + "-" + prompt + "-" + language + "-unknown" };
}; 