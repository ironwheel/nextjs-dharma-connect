"use client";
import { useEffect, useRef, useState, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export function useWebSocket(url: string) {
    const ws = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<WebSocketStatus>('connecting');
    const [lastMessage, setLastMessage] = useState<any>(null);
    const [error, setError] = useState<any>(null);
    const [connectionId, setConnectionId] = useState<string | null>(null);

    const connect = useCallback(() => {
        ws.current = new WebSocket(url);
        setStatus('connecting');

        ws.current.onopen = () => {
            setStatus('open');
            // Send a ping message to get the connection ID
            ws.current?.send(JSON.stringify({ type: 'ping' }));
        };
        ws.current.onclose = () => {
            setStatus('closed');
            setConnectionId(null);
        };
        ws.current.onerror = (e) => {
            setStatus('error');
            setError(e);
            setConnectionId(null);
        };
        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // If this is a connection ID response, store it
                if (data.type === 'connectionId') {
                    setConnectionId(data.connectionId);
                }
                setLastMessage(data);
            } catch (e) {
                setLastMessage(event.data);
            }
        };
    }, [url]);

    useEffect(() => {
        connect();
        return () => {
            ws.current?.close();
        };
    }, [connect]);

    // Optional: Reconnect on close
    useEffect(() => {
        if (status === 'closed') {
            const timeout = setTimeout(() => connect(), 3000);
            return () => clearTimeout(timeout);
        }
    }, [status, connect]);

    const send = useCallback((data: any) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(data));
        }
    }, []);

    return { status, lastMessage, send, error, connectionId };
} 