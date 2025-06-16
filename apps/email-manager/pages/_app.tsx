import { WebSocketProvider } from '../context/WebSocketProvider';

const WEBSOCKET_API_URL = process.env.NEXT_PUBLIC_WEBSOCKET_API_URL || 'wss://3zvne1dk16.execute-api.us-east-1.amazonaws.com/prod';

function MyApp({ Component, pageProps }) {
    return (
        <WebSocketProvider url={WEBSOCKET_API_URL}>
            <Component {...pageProps} />
        </WebSocketProvider>
    );
}

export default MyApp; 