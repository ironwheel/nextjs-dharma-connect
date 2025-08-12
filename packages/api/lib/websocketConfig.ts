/**
 * @file packages/api/lib/websocketConfig.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the configuration for the WebSockets used in the application.
 */

export interface WebSocketConfig {
    resource: string;
    envVar: string;
}

export const websockets: WebSocketConfig[] = [
    {
        resource: 'work-orders',
        envVar: 'AWS_WEBSOCKET_API_URL'
    },
    {
        resource: 'students',
        envVar: 'AWS_WEBSOCKET_API_URL'
    },
];

/**
 * @function websocketGetConfig
 * @description Looks up a websocket config by resource name and returns the related config object.
 * @param {string} resource - The resource name to look up (e.g., 'workorders', 'students').
 * @returns {WebSocketConfig & { websocketUrl: string }} The websocket config object.
 * @throws {Error} If the websocket config is not found.
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