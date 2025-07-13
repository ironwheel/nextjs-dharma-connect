// packages/api/pages/login.tsx
import { useState } from 'react';
import { api } from 'sharedFrontend';
import { getFingerprint } from 'sharedFrontend';

export default function Login() {
  const [email, setEmail] = useState('');
  const handleSend = async () => {
    await api.post('/api/login', { email, fingerprint: getFingerprint() });
    alert('Check your email for the link.');
  };
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Login</h1>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      <button onClick={handleSend}>Send Magic Link</button>
    </div>
  );
}