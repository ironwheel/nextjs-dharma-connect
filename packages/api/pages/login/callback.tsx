// packages/api/pages/login/callback.tsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { api } from 'sharedFrontend';
import { getFingerprint } from 'sharedFrontend';

export default function Callback() {
  const router = useRouter();
  const { token } = router.query;

  useEffect(() => {
    if (!token) return;
    (async () => {
      await api.post('/api/login/callback', '', '', { token, fingerprint: getFingerprint() });
      router.replace('/');
    })();
  }, [token]);

  return <div>Verifying&hellip;</div>;
}