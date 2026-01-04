import '../styles/globals.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import type { AppProps } from 'next/app';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Head from 'next/head';

function MyApp({ Component, pageProps }: AppProps) {
    return (
        <>
            <Head>
                <link rel="icon" href="/checkmark.svg" type="image/svg+xml" />
                <title>Refund Approval</title>
            </Head>
            <Component {...pageProps} />
            <ToastContainer />
        </>
    );
}

export default MyApp;
