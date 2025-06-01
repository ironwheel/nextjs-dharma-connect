/**
 * @file utils/debugUtils.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Provides utility functions for conditional debugging output,
 * typically based on a student's debug settings.
 */

/**
 * Determines if general debug output should be enabled.
 * This checks if the student object is provided and has the necessary debug flags set.
 * @function dbgOut
 * @param {object} [student] - The student object, optionally containing a debug configuration (`student.debug.dbgout`).
 * @returns {boolean} True if debug output is enabled, false otherwise.
 */
export const dbgOut = (student) => !!(student && student.debug && student.debug.dbgout);

/**
 * Determines if prompt-specific debug output should be enabled.
 * This checks if the student object is provided and has the necessary debug flags set.
 * @function dbgPrompt
 * @param {object} [student] - The student object, optionally containing a debug configuration (`student.debug.prompt`).
 * @returns {boolean} True if prompt debug output is enabled, false otherwise.
 */
export const dbgPrompt = (student) => !!(student && student.debug && student.debug.prompt);

/**
 * Logs messages to the console if general debugging is enabled for the student.
 * @function dbgout
 * @param {object} [student] - The student object used to determine if debugging is enabled.
 * @param {...any} args - Messages or objects to log to the console.
 */
export const dbgout = (student, ...args) => {
    if (dbgOut(student)) {
        console.log(...args);
    }
}; 