"use client";
import React, { createContext, useContext, ReactNode } from 'react';
import { useWebSocket, WebSocketStatus } from '../hooks/useWebSocket';

interface WebSocketContextType {
    status: WebSocketStatus;
    lastMessage: any;
    send: (data: any) => void;
    error: any;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function useWebSocketContext() {
    const ctx = useContext(WebSocketContext);
    if (!ctx) throw new Error('useWebSocketContext must be used within a WebSocketProvider');
    return ctx;
}

interface WebSocketProviderProps {
    url: string;
    children: ReactNode;
}

export function WebSocketProvider({ url, children }: WebSocketProviderProps) {
    const ws = useWebSocket(url);
    return (
        <WebSocketContext.Provider value={ws}>
            {children}
        </WebSocketContext.Provider>
    );
} 