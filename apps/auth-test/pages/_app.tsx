/**
 * @file apps/auth-test/pages/_app.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description The main App component for the auth-test application.
 */

import type { AppProps } from 'next/app'
import '../styles/globals.css'
import { WebSocketProvider } from 'sharedFrontend'

/**
 * @component App
 * @description The main App component for the auth-test application.
 * @param {AppProps} props - The props for the component.
 * @returns {React.FC} The App component.
 */
export default function App({ Component, pageProps }: AppProps) {
    return (
        <WebSocketProvider>
            <Component {...pageProps} />
        </WebSocketProvider>
    )
}