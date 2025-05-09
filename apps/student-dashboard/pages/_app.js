/**
 * @file pages/_app.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Global App component for Next.js. Imports global styles and themes.
 */

// Import the chosen Bootswatch theme CSS
//import 'bootswatch/dist/flatly/bootstrap.min.css';
import 'bootstrap/dist/css/bootstrap.min.css';

// Import your custom global styles AFTER the theme import
import '../styles/globals.css'; // Your general global styles
import '../styles/App.css'; // Your component-specific styles

// Import PDF viewer styles (keep these)
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

/**
 * Custom App component to apply global styles and layout.
 * @param {object} props - Component props.
 * @param {React.ComponentType} props.Component - The active page component.
 * @param {object} props.pageProps - Props passed to the page component.
 * @returns {React.Component} The wrapped application component.
 */
function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

export default MyApp;
