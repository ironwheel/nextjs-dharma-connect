/**
 * Display order for a sub-event's embeddedVideoList when entries are tagged with
 * `retreats` (whichRetreatsConfig keys). Entries are grouped by their earliest retreat's
 * `order`, keeping their stored order within a group. Untagged entries come first.
 * The stored list is not changed: each item carries its original index, which is what
 * default prompt names (e.g. `${subEvent}Video${index + 1}Title`) are built from.
 */
export function orderVideoEntriesByRetreat<T = any>(
    entries: T[] | undefined | null,
    whichRetreatsConfig?: Record<string, { order?: string | number }> | null
): Array<{ entry: T; index: number }> {
    if (!Array.isArray(entries)) return [];
    const config = whichRetreatsConfig || {};
    const rank = (entry: any): number => {
        const retreats = entry?.retreats;
        if (!Array.isArray(retreats) || retreats.length === 0) return -Infinity;
        const orders = retreats
            .map((key: string) => Number(config[key]?.order))
            .filter((order: number) => Number.isFinite(order));
        return orders.length > 0 ? Math.min(...orders) : Infinity;
    };
    return entries
        .map((entry, index) => ({ entry, index, rank: rank(entry) }))
        .sort((a, b) => (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1) || a.index - b.index)
        .map(({ entry, index }) => ({ entry, index }));
}
