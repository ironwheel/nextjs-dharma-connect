import { checkEligibility } from 'sharedFrontend';
import type { ScriptContext } from '../components/script/types';

/**
 * A subevent has recordings once either media list is present. Audio uses the same
 * availability model as video, so a complete event whose only recordings are audio is as
 * finished as one with video, and must reach the same offering flow.
 *
 * The exported names below keep "video" because "video dashboard" is the established name
 * for this flow — it is also baked into the videoIntroduction step and the
 * offeringCompleteVideoDashboard prompt key, which are data. What they test is recordings
 * of either kind.
 */
function hasRecordings(subEvent: object): boolean {
    const media = subEvent as { embeddedVideoList?: unknown; embeddedAudioList?: unknown };
    return typeof media.embeddedVideoList !== 'undefined'
        || typeof media.embeddedAudioList !== 'undefined';
}

/** True when every subevent is complete and at least one has recordings (video or audio). */
export function isVideoDashboardEvent(event: { subEvents?: Record<string, unknown> } | null | undefined): boolean {
    const subEvents = event?.subEvents;
    if (!subEvents || typeof subEvents !== 'object') return false;

    const entries = Object.values(subEvents);
    if (entries.length === 0) return false;

    let anyRecordings = false;
    for (const subEvent of entries) {
        if (!subEvent || typeof subEvent !== 'object') return false;
        if ((subEvent as { eventComplete?: boolean }).eventComplete !== true) return false;
        if (hasRecordings(subEvent)) anyRecordings = true;
    }
    return anyRecordings;
}

/** True when every subevent is complete and none has recordings (video or audio). */
export function isAllSubeventsCompleteNoVideos(event: { subEvents?: Record<string, unknown> } | null | undefined): boolean {
    const subEvents = event?.subEvents;
    if (!subEvents || typeof subEvents !== 'object') return false;

    const entries = Object.values(subEvents);
    if (entries.length === 0) return false;

    for (const subEvent of entries) {
        if (!subEvent || typeof subEvent !== 'object') return false;
        if ((subEvent as { eventComplete?: boolean }).eventComplete !== true) return false;
        if (hasRecordings(subEvent)) return false;
    }
    return true;
}

/** True when the registration flow should open with the videoIntroduction step. */
export function shouldShowVideoIntroduction(context: ScriptContext): boolean {
    if (!isVideoDashboardEvent(context.event)) return false;

    const eventCode = context.event?.aid;
    if (!eventCode) return false;

    const prog = context.student?.programs?.[eventCode];
    if (prog?.join === true) return false;

    const eventPool = context.event?.config?.pool;
    const checkElig = context.checkEligibility ?? checkEligibility;
    return !eventPool || checkElig(eventPool, context.student, eventCode, context.pools || [], context.event);
}
