import type { AppProps } from 'next/app'
import '../styles/globals.css'
import { WebSocketProvider } from 'sharedFrontend'

export default function App({ Component, pageProps }: AppProps) {
    return (
        <WebSocketProvider>
            <Component {...pageProps} />
        </WebSocketProvider>
    )
} 