import React from 'react'
import type { AppProps } from 'next/app'
import { Inter } from 'next/font/google'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'react-toastify/dist/ReactToastify.css'
import { ToastContainer } from 'react-toastify'
import '../styles/globals.css'
// Keeps the page from crashing when the browser translates it
import '../components/translateGuard'

const inter = Inter({ subsets: ['latin'] })

export default function App({ Component, pageProps }: AppProps) {
    return (
        <div className={inter.className}>
            <Component {...pageProps} />
            <ToastContainer position="bottom-right" theme="dark" />
        </div>
    )
} 