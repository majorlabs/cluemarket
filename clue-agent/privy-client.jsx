// Bridge between the plain-JS Clue site and Privy's React SDK.
// Built to public/privy.js with `npm run build:privy`. Loaded only when a visitor
// chooses Privy sign-in, so it does not slow the normal page.
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLogin } from '@privy-io/react-auth';

const state = { api: null, waiting: null };

function Bridge() {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const ref = useRef({});
  ref.current = { ready, authenticated, logout, getAccessToken };
  const { login } = useLogin({
    onComplete: async () => {
      const w = state.waiting;
      state.waiting = null;
      if (!w) return;
      try { w.resolve(await ref.current.getAccessToken()); } catch (e) { w.reject(e); }
    },
    onError: (error) => {
      const w = state.waiting;
      state.waiting = null;
      if (w) w.reject(new Error(String(error || 'Sign-in was cancelled.')));
    },
  });
  useEffect(() => {
    state.api = {
      ready: () => ref.current.ready,
      // Opens Privy's sign-in. Resolves with a Privy access token.
      async login() {
        if (!ref.current.ready) throw new Error('Privy is still loading. Try again in a moment.');
        if (ref.current.authenticated) return ref.current.getAccessToken();
        return new Promise((resolve, reject) => { state.waiting = { resolve, reject }; login(); });
      },
      async logout() { if (ref.current.authenticated) await ref.current.logout(); },
    };
  }, [login]);
  return null;
}

export function mount(appId) {
  const el = document.createElement('div');
  el.id = 'privy-root';
  document.body.append(el);
  createRoot(el).render(
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: { theme: 'dark', accentColor: '#ff6a2d', logo: '/assets/clue-mark.jpg', showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: 'off' } },
      }}
    >
      <Bridge />
    </PrivyProvider>,
  );
}

// Public entry used by app.js
window.cluePrivy = {
  async init(appId) { if (!document.getElementById('privy-root')) mount(appId); await new Promise((r) => setTimeout(r, 0)); },
  async login() {
    for (let i = 0; i < 100 && !state.api; i++) await new Promise((r) => setTimeout(r, 50));
    if (!state.api) throw new Error('Privy could not start.');
    return state.api.login();
  },
  async logout() { if (state.api) await state.api.logout(); },
};
