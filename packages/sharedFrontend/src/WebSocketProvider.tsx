import React, { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from 'react';
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

export function WebSocketProvider({ children, resource = 'work-orders' }: WebSocketProviderProps) {
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
    const [lastMessage, setLastMessage] = useState<any>(null);
    const [connectionId, setConnectionId] = useState<string | null>(null);
    const ws = useRef<WebSocket | null>(null);
    const [isReady, setIsReady] = useState(false);

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

            // If the connection was closed unexpectedly (not by user), trigger error
            if (event.code !== 1000) { // 1000 is normal closure
                window.dispatchEvent(new CustomEvent('websocket-error', {
                    detail: { error: `WebSocket connection closed: ${event.reason || 'Unknown error'}` }
                }));
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

    const disconnect = useCallback(() => {
        console.log('[WebSocket] Disconnecting...');
        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }
        setStatus('closed');
        setIsReady(false);
        setConnectionId(null);
    }, []);

    const sendMessage = useCallback((message: any) => {
        if (ws.current?.readyState === WebSocket.OPEN && isReady) {
            ws.current.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected or not ready');
        }
    }, [isReady]);

    // Auto-connect on mount if pid/hash are present in URL
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
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
                });
        } else {
            console.warn('[WebSocket] No pid/hash found in URL, skipping auto-connect');
        }
        // Only run once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource]);

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

export function useWebSocket() {
    const context = useContext(WebSocketContext);
    if (context === undefined) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
} 