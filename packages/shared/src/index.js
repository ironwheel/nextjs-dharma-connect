/**
 * @file packages/shared/src/index.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Barrel file exporting shared utility functions.
 */
export { TopNavBar, BottomNavBar } from './SharedLayout';

export {
    promptLookup,
    promptLookupHTML,
    promptLookupAIDSpecific,
    promptLookupDescription,
    promptLookupHTMLWithArgs,
    promptLookupHTMLWithArgsAIDSpecific
} from './promptUtils';
export { getFingerprint } from './fingerprint';
export { dbgOut, dbgPrompt, dbgout } from './debugUtils';
export { eligible } from './eligible';
export {
    getPromptsFromDbApi,
    writeProgramError
} from './apiUtils';
export {
    callDbApi,
    sendConfirmationEmail,
    verifyAccess,
    ensureCsrfToken,
    clearCsrfToken
} from './clientApi';
export { ConfirmPage } from './ConfirmPage';
