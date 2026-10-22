/**
 * @file apps/unsubscribe/pages/login.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description The shared HTTP client sends rejected requests here. This app has no sign-in step,
 * so there is nothing to do but say the link could not be used.
 */

import Contact from '../components/Contact';

export default function Login() {
    return (
        <main className="page">
            <div className="card">
                <h1>We couldn&apos;t open your email preferences</h1>
                <p>Please try the link in your email again later.</p>
                <Contact />
            </div>
        </main>
    );
}
