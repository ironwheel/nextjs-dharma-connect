import { checkEligibility } from 'sharedFrontend';
import type { ScriptContext } from '../components/script/types';

/** True when every subevent is complete and at least one has an embeddedVideoList. */
export function isVideoDashboardEvent(event: { subEvents?: Record<string, unknown> } | null | undefined): boolean {
    const subEvents = event?.subEvents;
    if (!subEvents || typeof subEvents !== 'object') return false;

    const entries = Object.values(subEvents);
    if (entries.length === 0) return false;

    let hasEmbeddedVideoList = false;
    for (const subEvent of entries) {
        if (!subEvent || typeof subEvent !== 'object') return false;
        if ((subEvent as { eventComplete?: boolean }).eventComplete !== true) return false;
        if (typeof (subEvent as { embeddedVideoList?: unknown }).embeddedVideoList !== 'undefined') {
            hasEmbeddedVideoList = true;
        }
    }
    return hasEmbeddedVideoList;
}

/** True when every subevent is complete and none has an embeddedVideoList. */
export function isAllSubeventsCompleteNoVideos(event: { subEvents?: Record<string, unknown> } | null | undefined): boolean {
    const subEvents = event?.subEvents;
    if (!subEvents || typeof subEvents !== 'object') return false;

    const entries = Object.values(subEvents);
    if (entries.length === 0) return false;

    for (const subEvent of entries) {
        if (!subEvent || typeof subEvent !== 'object') return false;
        if ((subEvent as { eventComplete?: boolean }).eventComplete !== true) return false;
        if (typeof (subEvent as { embeddedVideoList?: unknown }).embeddedVideoList !== 'undefined') {
            return false;
        }
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
