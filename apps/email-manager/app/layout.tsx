import React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'react-toastify/dist/ReactToastify.css'
import { ToastContainer } from 'react-toastify'
import { WebSocketProvider } from '../context/WebSocketProvider'

const inter = Inter({ subsets: ['latin'] })

const WEBSOCKET_API_URL = process.env.NEXT_PUBLIC_WEBSOCKET_API_URL || 'wss://3zvne1dk16.execute-api.us-east-1.amazonaws.com/prod'

export const metadata: Metadata = {
    title: 'Email Manager',
    description: 'Manage email campaigns and work orders',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className={inter.className}>
                <WebSocketProvider url={WEBSOCKET_API_URL}>
                    {children}
                    <ToastContainer position="bottom-right" theme="dark" />
                </WebSocketProvider>
            </body>
        </html>
    )
} 