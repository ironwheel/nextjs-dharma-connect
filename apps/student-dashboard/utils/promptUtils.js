/**
 * @file utils/promptUtils.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Provides utility functions for looking up and formatting localized prompt strings
 * from a provided array of prompt objects.
 */

/**
 * Looks up a prompt string based on its key, language, and application ID (aid).
 * It first checks for an AID-specific prompt, then a default prompt.
 *
 * @function promptLookup
 * @param {Array<object>} promptsArray - The array of prompt objects. Each object should have 'prompt' (string, e.g., "aid-key"), 'language' (string), and 'text' (string) properties.
 * @param {string} promptKey - The key of the prompt to look up (without the 'aid-' or 'default-' prefix).
 * @param {string} language - The desired language for the prompt (e.g., "English", "Spanish").
 * @param {string} aid - The application/area ID for context-specific prompts (e.g., "dashboard", "specificFeature").
 * @param {function} [debugFn=() => false] - A function that returns true if debug logging for prompts is active.
 * @param {function} [loggerFn=console.log] - The function to use for logging debug messages if debugFn returns true.
 * @returns {string} The localized prompt text, or an "unknown" placeholder string if not found.
 */
export const promptLookup = (promptsArray, promptKey, language, aid, debugFn = () => false, loggerFn = console.log) => {
    if (debugFn()) {
        loggerFn(`PROMPT LOOKUP: key='${promptKey}', lang='${language}', aid='${aid}'`);
    }

    if (!promptsArray || promptsArray.length === 0) {
        if (debugFn()) {
            loggerFn("PROMPT WARNING: Prompts array is undefined or empty during lookup for key:", promptKey);
        }
        return `${aid}-${promptKey}-${language}-promptsUndefined`;
    }

    const fullAidPromptKey = `${aid}-${promptKey}`;
    const defaultPromptKey = `default-${promptKey}`;

    // AID-specific prompt
    for (let i = 0; i < promptsArray.length; i++) {
        const p = promptsArray[i];
        if (p.prompt === fullAidPromptKey && p.language === language) {
            if (debugFn()) {
                loggerFn(`PROMPT AID MATCH: Found '${fullAidPromptKey}' for lang '${language}': "${p.text}"`);
            }
            return p.text;
        }
    }

    // Default prompt (language-specific or universal)
    for (let i = 0; i < promptsArray.length; i++) {
        const p = promptsArray[i];
        if (p.prompt === defaultPromptKey && (p.language === language || p.language === 'universal')) {
            if (debugFn()) {
                loggerFn(`PROMPT DEFAULT MATCH: Found '${defaultPromptKey}' for lang '${language}' (or universal): "${p.text}"`);
            }
            return p.text;
        }
    }

    if (debugFn()) {
        loggerFn(`PROMPT UNKNOWN: No match found for key='${promptKey}', lang='${language}', aid='${aid}'`);
    }
    return `${aid}-${promptKey}-${language}-unknown`;
};

/**
 * Looks up a prompt string for a specific AID (and optional AID alias) and formats it for HTML output.
 * This is a convenience wrapper around promptLookup.
 *
 * @function promptLookupAIDSpecific
 * @param {Array<object>} promptsArray - The array of prompt objects.
 * @param {string} key - The key of the prompt (without aid prefix).
 * @param {string} language - The desired language.
 * @param {string} targetAid - The primary AID to search for.
 * @param {string} [aidAlias] - An alias AID to also check if the primary AID prompt is not found.
 * @param {function} [debugFn] - Debug logging function.
 * @param {function} [loggerFn] - Logger function.
 * @returns {string} The localized prompt text.
 */
export const promptLookupAIDSpecific = (promptsArray, key, language, targetAid, aidAlias, debugFn, loggerFn) => {
    let text = promptLookup(promptsArray, key, language, targetAid, debugFn, loggerFn);
    // If not found with targetAid and an alias is provided, try with alias
    if (text.endsWith('-unknown') && aidAlias && aidAlias !== targetAid) {
        if (debugFn) debugFn(`PROMPT AID_SPECIFIC: Trying alias AID '${aidAlias}' for key '${key}'`);
        text = promptLookup(promptsArray, key, language, aidAlias, debugFn, loggerFn);
    }
    return text;
}

/**
 * Looks up a prompt string and prepares it for HTML rendering by replacing common placeholders.
 *
 * @function promptLookupHTML
 * @param {Array<object>} promptsArray - The array of prompt objects.
 * @param {string} promptKey - The key of the prompt.
 * @param {string} language - The desired language.
 * @param {string} aid - The application ID.
 * @param {object} [student={}] - Student data for placeholder replacement (e.g., student.email, student.first, student.last).
 * @param {object} [eventDetails={}] - Event details for placeholder replacement (e.g., eventDetails.title, eventDetails.deadline, eventDetails.coordEmail).
 * @param {function} [debugFn] - Debug logging function.
 * @param {function} [loggerFn] - Logger function.
 * @returns {{ __html: string }} Object suitable for dangerouslySetInnerHTML.
 */
export const promptLookupHTML = (promptsArray, promptKey, language, aid, student = {}, eventDetails = {}, debugFn, loggerFn) => {
    let text = promptLookup(promptsArray, promptKey, language, aid, debugFn, loggerFn);

    // Perform placeholder replacements
    if (eventDetails.title) text = text.replace(/\|\|title\|\|/g, eventDetails.title);
    if (eventDetails.deadline) text = text.replace(/\|\|deadline\|\|/g, eventDetails.deadline);
    if (student.email) text = text.replace(/\|\|email\|\|/g, student.email);
    if (student.first && student.last) text = text.replace(/\|\|name\|\|/g, `${student.first} ${student.last}`);
    if (eventDetails.coordEmail) text = text.replace(/\|\|coord-email\|\|/g, eventDetails.coordEmail);
    // Add more specific replacements as needed, e.g., for ||arg1||, ||arg2||, etc.
    // If using args, consider a more generic replacement mechanism or specific functions.

    return { __html: text };
};


/**
 * Looks up a description prompt, typically used for longer text sections.
 * Assumes description prompts are prefixed with 'descriptions-' (e.g., "descriptions-aid-subEventKey").
 *
 * @function promptLookupDescription
 * @param {Array<object>} promptsArray - The array of prompt objects.
 * @param {string} fullDescriptionKey - The full key of the description prompt (e.g., "descriptions-dashboard-intro").
 * @param {string} language - The desired language.
 * @param {string} aidForContext - The AID used for general placeholder context if needed (though fullDescriptionKey should be specific).
 * @param {object} [student={}] - Student data for placeholder replacement.
 * @param {object} [eventDetails={}] - Event details for placeholder replacement.
 * @param {function} [debugFn] - Debug logging function.
 * @param {function} [loggerFn] - Logger function.
 * @returns {{ __html: string } | null} Object for dangerouslySetInnerHTML, or null if prompt is empty or not found.
 */
export const promptLookupDescription = (promptsArray, fullDescriptionKey, language, aidForContext, student = {}, eventDetails = {}, debugFn, loggerFn) => {
    if (debugFn) debugFn(`PROMPT DESCRIPTION LOOKUP: key='${fullDescriptionKey}', lang='${language}'`);

    if (!promptsArray) {
        if (debugFn) debugFn("PROMPT DESCRIPTION WARNING: Prompts array is undefined.");
        return null;
    }

    // Descriptions are directly sought by their full key and language.
    // The 'aid' for descriptions is usually 'descriptions' itself in the prompt object,
    // but the fullDescriptionKey already includes the specific event context.
    for (let i = 0; i < promptsArray.length; i++) {
        const p = promptsArray[i];
        if (p.prompt === fullDescriptionKey && p.language === language) {
            if (p.text.length === 0) { // Intentionally empty prompt
                if (debugFn) debugFn(`PROMPT DESCRIPTION: Found empty prompt for '${fullDescriptionKey}'`);
                return null;
            }
            let text = p.text;
            // Perform placeholder replacements
            if (eventDetails.title) text = text.replace(/\|\|title\|\|/g, eventDetails.title);
            if (eventDetails.deadline) text = text.replace(/\|\|deadline\|\|/g, eventDetails.deadline);
            if (student.email) text = text.replace(/\|\|email\|\|/g, student.email);
            if (student.first && student.last) text = text.replace(/\|\|name\|\|/g, `${student.first} ${student.last}`);
            if (eventDetails.coordEmail) text = text.replace(/\|\|coord-email\|\|/g, eventDetails.coordEmail);

            if (debugFn) debugFn(`PROMPT DESCRIPTION RETURNING: Found '${fullDescriptionKey}', text: "${text}"`);
            return { __html: text };
        }
    }

    if (debugFn) debugFn(`PROMPT DESCRIPTION UNKNOWN: No match for key='${fullDescriptionKey}', lang='${language}'`);
    return null; // Or a placeholder like { __html: `${fullDescriptionKey}-${language}-unknown` } if preferred
};


/**
 * Looks up a prompt and replaces generic ||argN|| placeholders.
 *
 * @function promptLookupHTMLWithArgs
 * @param {Array<object>} promptsArray - The array of prompt objects.
 * @param {string} promptKey - The key of the prompt.
 * @param {string} language - The desired language.
 * @param {string} aid - The application ID.
 * @param {string} [arg1] - Value for ||arg1||.
 * @param {string} [arg2] - Value for ||arg2||.
 * @param {string} [arg3] - Value for ||arg3||.
 * @param {object} [student={}] - Student data for other common placeholders.
 * @param {object} [eventDetails={}] - Event details for other common placeholders.
 * @param {function} [debugFn] - Debug logging function.
 * @param {function} [loggerFn] - Logger function.
 * @returns {{ __html: string }} Object suitable for dangerouslySetInnerHTML.
 */
export const promptLookupHTMLWithArgs = (promptsArray, promptKey, language, aid, arg1, arg2, arg3, student = {}, eventDetails = {}, debugFn, loggerFn) => {
    let text = promptLookup(promptsArray, promptKey, language, aid, debugFn, loggerFn);

    // Common placeholders
    if (eventDetails.title) text = text.replace(/\|\|title\|\|/g, eventDetails.title);
    if (student.email) text = text.replace(/\|\|email\|\|/g, student.email);

    // Argument placeholders
    if (typeof arg1 !== 'undefined') text = text.replace(/\|\|arg1\|\|/g, arg1);
    if (typeof arg2 !== 'undefined') text = text.replace(/\|\|arg2\|\|/g, arg2);
    if (typeof arg3 !== 'undefined') text = text.replace(/\|\|arg3\|\|/g, arg3);

    return { __html: text };
};

/**
 * Looks up a prompt for a specific AID (and optional alias) and replaces generic ||argN|| placeholders.
 *
 * @function promptLookupHTMLWithArgsAIDSpecific
 * @param {Array<object>} promptsArray - The array of prompt objects.
 * @param {string} key - The key of the prompt.
 * @param {string} language - The desired language.
 * @param {string} targetAid - The primary AID to search for.
 * @param {string} [aidAlias] - An alias AID.
 * @param {string} [arg1] - Value for ||arg1||.
 * @param {string} [arg2] - Value for ||arg2||.
 * @param {string} [arg3] - Value for ||arg3||.
 * @param {object} [student={}] - Student data.
 * @param {object} [eventDetails={}] - Event details.
 * @param {function} [debugFn] - Debug function.
 * @param {function} [loggerFn] - Logger function.
 * @returns {{ __html: string }} Object suitable for dangerouslySetInnerHTML.
 */
export const promptLookupHTMLWithArgsAIDSpecific = (promptsArray, key, language, targetAid, aidAlias, arg1, arg2, arg3, student = {}, eventDetails = {}, debugFn, loggerFn) => {
    let text = promptLookupAIDSpecific(promptsArray, key, language, targetAid, aidAlias, debugFn, loggerFn);

    // Common placeholders
    if (eventDetails.title) text = text.replace(/\|\|title\|\|/g, eventDetails.title);
    if (student.email) text = text.replace(/\|\|email\|\|/g, student.email);

    // Argument placeholders
    if (typeof arg1 !== 'undefined') text = text.replace(/\|\|arg1\|\|/g, arg1);
    if (typeof arg2 !== 'undefined') text = text.replace(/\|\|arg2\|\|/g, arg2);
    if (typeof arg3 !== 'undefined') text = text.replace(/\|\|arg3\|\|/g, arg3);

    return { __html: text };
};