/**
 * @file packages/sharedFrontend/src/index.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description This file exports all the modules from the sharedFrontend package.
 */

export * from './httpClient';
export * from './fingerprint';
export * from './apiActions';
export * from './eligible';
export * from './layout';
export * from './prompts';
export { default as AuthVerification } from './AuthVerification';
export { WebSocketProvider, useWebSocket } from './WebSocketProvider';