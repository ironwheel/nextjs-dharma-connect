/**
 * @file packages/sharedFrontend/src/WebSocketProvider.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the WebSocketProvider component for handling WebSocket connections.
 */

import React, { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/router';
import { getWebSocketConnection } from './apiActions';

interface WebSocketContextType {
    status: 'connecting' | 'open' | 'closed';
    lastMessage: any;
    connect: (url: string) => void;
    disconnect: () => void;
    sendMessage: (message: any) => void;
    connectionId: string | null;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
    children: ReactNode;
    resource?: string; // NEW: resource prop
}

/**
 * @function isAuthRoute
 * @description Checks if the current route is an authentication-related route.
 * @param {string} pathname - The current route pathname.
 * @returns {boolean} True if the route is an authentication-related route, false otherwise.
 */
function isAuthRoute(pathname: string): boolean {
    // Define patterns for auth-related routes
    const authRoutePatterns = [
        /^\/login(\/.*)?$/,           // /login, /login/callback, etc.
        /^\/auth(\/.*)?$/,            // /auth, /auth/callback, etc.
        /^\/signin(\/.*)?$/,          // /signin, /signin/callback, etc.
        /^\/signup(\/.*)?$/,          // /signup, /signup/callback, etc.
        /^\/verify(\/.*)?$/,          // /verify, /verify/email, etc.
        /^\/confirm(\/.*)?$/,         // /confirm, /confirm/email, etc.
    ];

    return authRoutePatterns.some(pattern => pattern.test(pathname));
}

/**
 * @component WebSocketProvider
 * @description This component provides a WebSocket connection to its children.
 * @param {WebSocketProviderProps} props - The props for the component.
 * @returns {React.FC} The WebSocketProvider component.
 */
export function WebSocketProvider({ children, resource = 'work-orders' }: WebSocketProviderProps) {
    const router = useRouter();
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
    const [lastMessage, setLastMessage] = useState<any>(null);
    const [connectionId, setConnectionId] = useState<string | null>(null);
    const ws = useRef<WebSocket | null>(null);
    const [isReady, setIsReady] = useState(false);
    const hasConnected = useRef(false); // Guard against duplicate connections in Strict Mode

    // Reconnection state
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // 1 second
    const maxReconnectDelay = 30000; // 30 seconds
    const periodicReconnectIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const periodicReconnectDelay = 60000; // 1 minute

    /**
     * @function connect
     * @description Connects to the WebSocket server.
     * @param {string} url - The URL of the WebSocket server.
     */
    const connect = useCallback((url: string) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            console.log('[WebSocket] Already connected');
            return;
        }

        console.log('[WebSocket] Creating new WebSocket connection to:', url);
        ws.current = new WebSocket(url);
        setStatus('connecting');
        setIsReady(false);

        ws.current.onopen = () => {
            console.log('[WebSocket] Connection opened successfully');
            setStatus('open');
            setIsReady(true);
            // Reset reconnection attempts on successful connection
            reconnectAttemptsRef.current = 0;

            // Clear any pending reconnection timeouts
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }

            // Wait a brief moment to ensure the connection is fully established
            setTimeout(() => {
                if (ws.current?.readyState === WebSocket.OPEN) {
                    // Send a ping message to get the connection ID
                    const pingMessage = { type: 'ping' };
                    console.log('[WebSocket] Sending ping message:', JSON.stringify(pingMessage));
                    ws.current?.send(JSON.stringify(pingMessage));
                } else {
                    console.warn('[WebSocket] Connection not ready for ping, skipping');
                }
            }, 100);
        };

        ws.current.onclose = (event) => {
            console.log('[WebSocket] Connection closed:', event.code, event.reason);
            setStatus('closed');
            setIsReady(false);
            setConnectionId(null);

            // If the connection was closed unexpectedly (not by user), attempt reconnection
            if (event.code !== 1000) { // 1000 is normal closure
                console.log('[WebSocket] Unexpected closure, attempting reconnection...');

                // Trigger error event for components to handle
                window.dispatchEvent(new CustomEvent('websocket-error', {
                    detail: { error: `WebSocket connection closed: ${event.reason || 'Unknown error'}` }
                }));

                // Attempt reconnection with exponential backoff
                attemptReconnection();
            } else {
                // Normal closure - clear any pending reconnection attempts
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }
                reconnectAttemptsRef.current = 0;
            }
        };

        ws.current.onerror = (error) => {
            console.error('[WebSocket] Connection error:', error);
            setStatus('closed');
            setIsReady(false);
            // Trigger a custom error event that components can listen to
            window.dispatchEvent(new CustomEvent('websocket-error', {
                detail: { error: 'WebSocket connection failed' }
            }));
        };

        ws.current.onmessage = (event) => {
            console.log('[WebSocket] Received message:', event.data);
            try {
                const data = JSON.parse(event.data);
                console.log('[WebSocket] Parsed message data:', data);

                // If this is a connection ID response, store it
                if (data.type === 'connectionId') {
                    setConnectionId(data.connectionId);
                    console.log('[WebSocket] Connected with ID:', data.connectionId);
                } else {
                    // Store the last message for components to access
                    console.log('[WebSocket] Storing message:', data);
                    setLastMessage(data);
                }
            } catch (error) {
                console.error('[WebSocket] Failed to parse message:', error);
            }
        };
    }, []);

    /**
     * @function attemptReconnection
     * @description Attempts to reconnect to the WebSocket server with exponential backoff.
     */
    const attemptReconnection = useCallback(async () => {
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            console.log('[WebSocket] Max reconnection attempts reached, stopping automatic reconnection');
            return;
        }

        // Check if we're on an auth route - don't reconnect on auth routes
        if (isAuthRoute(router.pathname)) {
            console.log('[WebSocket] Skipping reconnection on auth route:', router.pathname);
            return;
        }

        reconnectAttemptsRef.current++;

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1) + Math.random() * 1000,
            maxReconnectDelay
        );

        console.log(`[WebSocket] Attempting reconnection ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${Math.round(delay)}ms`);

        reconnectTimeoutRef.current = setTimeout(async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const pid = urlParams.get('pid');
                const hash = urlParams.get('hash');

                if (!pid || !hash) {
                    console.warn('[WebSocket] No pid/hash found for reconnection');
                    return;
                }

                const details = await getWebSocketConnection(resource, pid, hash);
                if ('websocketUrl' in details && details.websocketUrl) {
                    connect(details.websocketUrl);
                } else {
                    console.error('[WebSocket] Invalid connection details during reconnection:', details);
                    // Try again after a delay
                    attemptReconnection();
                }
            } catch (err) {
                console.error('[WebSocket] Reconnection failed:', err);
                // Try again after a delay
                attemptReconnection();
            }
        }, delay);
    }, [connect, resource, router.pathname]);

    /**
     * @function startPeriodicReconnection
     * @description Starts a periodic reconnection attempt.
     */
    const startPeriodicReconnection = useCallback(() => {
        if (periodicReconnectIntervalRef.current) {
            clearInterval(periodicReconnectIntervalRef.current);
        }

        periodicReconnectIntervalRef.current = setInterval(() => {
            // Only attempt periodic reconnection if we're not currently connected
            // and not on an auth route
            if (status === 'closed' && !isAuthRoute(router.pathname)) {
                console.log('[WebSocket] Periodic reconnection check - attempting to reconnect');
                attemptReconnection();
            }
        }, periodicReconnectDelay);
    }, [status, router.pathname, attemptReconnection]);

    /**
     * @function disconnect
     * @description Disconnects from the WebSocket server.
     */
    const disconnect = useCallback(() => {
        console.log('[WebSocket] Disconnecting...');

        // Clear any pending reconnection attempts
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        // Clear periodic reconnection
        if (periodicReconnectIntervalRef.current) {
            clearInterval(periodicReconnectIntervalRef.current);
            periodicReconnectIntervalRef.current = null;
        }

        // Reset reconnection attempts
        reconnectAttemptsRef.current = 0;

        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }
        setStatus('closed');
        setIsReady(false);
        setConnectionId(null);
    }, []);

    /**
     * @function sendMessage
     * @description Sends a message to the WebSocket server.
     * @param {any} message - The message to send.
     */
    const sendMessage = useCallback((message: any) => {
        if (ws.current?.readyState === WebSocket.OPEN && isReady) {
            ws.current.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected or not ready');
        }
    }, [isReady]);

    // Auto-connect on mount if pid/hash are present in URL and not on auth route
    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Guard against duplicate connections in React Strict Mode
        if (hasConnected.current) {
            console.log('[WebSocket] Already attempted connection, skipping duplicate');
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');

        if (pid && hash) {
            // Check if we're on an auth route
            if (isAuthRoute(router.pathname)) {
                console.log('[WebSocket] Skipping auto-connect on auth route:', router.pathname);
                return;
            }

            console.log('[WebSocket] Attempting auto-connect on route:', router.pathname);
            hasConnected.current = true; // Mark that we've attempted connection

            getWebSocketConnection(resource, pid, hash)
                .then((details) => {
                    if ('websocketUrl' in details && details.websocketUrl) {
                        connect(details.websocketUrl);
                    } else {
                        console.error('[WebSocket] Invalid connection details:', details);
                    }
                })
                .catch((err) => {
                    console.error('[WebSocket] Failed to get connection:', err);
                    hasConnected.current = false; // Reset on error to allow retry
                });
        } else {
            console.warn('[WebSocket] No pid/hash found in URL, skipping auto-connect');
        }
        // Only run once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource, router.pathname]);

    // Start periodic reconnection when status becomes closed
    useEffect(() => {
        if (status === 'closed') {
            startPeriodicReconnection();
        } else {
            // Clear periodic reconnection when connected
            if (periodicReconnectIntervalRef.current) {
                clearInterval(periodicReconnectIntervalRef.current);
                periodicReconnectIntervalRef.current = null;
            }
        }
    }, [status, startPeriodicReconnection]);

    // Listen for manual ping requests
    useEffect(() => {
        const handleManualPing = () => {
            if (ws.current?.readyState === WebSocket.OPEN) {
                const pingMessage = { type: 'ping' };
                console.log('[WebSocket] Manual ping triggered:', JSON.stringify(pingMessage));
                ws.current.send(JSON.stringify(pingMessage));
            }
        };

        window.addEventListener('manual-ping', handleManualPing);
        return () => {
            window.removeEventListener('manual-ping', handleManualPing);
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (periodicReconnectIntervalRef.current) {
                clearInterval(periodicReconnectIntervalRef.current);
            }
            if (ws.current) {
                ws.current.close();
            }
        };
    }, []);

    return (
        <WebSocketContext.Provider value={{
            status,
            lastMessage,
            connect,
            disconnect,
            sendMessage,
            connectionId
        }}>
            {children}
        </WebSocketContext.Provider>
    );
}

/**
 * @function useWebSocket
 * @description A custom hook to use the WebSocket context.
 * @returns {WebSocketContextType} The WebSocket context.
 * @throws {Error} If used outside of a WebSocketProvider.
 */
export function useWebSocket() {
    const context = useContext(WebSocketContext);
    if (context === undefined) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
} 