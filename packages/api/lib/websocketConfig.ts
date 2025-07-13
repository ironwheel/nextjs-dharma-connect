// packages/api/lib/websocketConfig.ts
export interface WebSocketConfig {
    resource: string;
    envVar: string;
}

export const websockets: WebSocketConfig[] = [
    {
        resource: 'work-orders',
        envVar: 'AWS_WEBSOCKET_WORKORDERS_API_URL'
    },
    {
        resource: 'students',
        envVar: 'AWS_WEBSOCKET_STUDENTS_API_URL'
    },
];

/**
 * Looks up a websocket config by resource name and returns the related config object
 * @param resource - The resource name to look up (e.g., 'workorders', 'students')
 * @returns The websocket config object
 * @throws Error if the websocket config is not found
 */
export function websocketGetConfig(resource: string): WebSocketConfig & { websocketUrl: string } {
    const cfg = websockets.find((w: WebSocketConfig) => w.resource === resource);
    if (!cfg) {
        throw new Error(`Can't find ${resource} websocket config`);
    }

    // check env var is set
    const websocketUrl = process.env[cfg.envVar];
    if (!websocketUrl) {
        throw new Error(`Environment variable ${cfg.envVar} is not set for ${resource} websocket`);
    }

    return { ...cfg, websocketUrl };
} 