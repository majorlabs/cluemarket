// Bridge between the plain-JS Clue site and Privy's React SDK.
// Built to public/privy.js with `npm run build:privy`. Loaded only when a visitor
// chooses Privy sign-in, so it does not slow the normal page.
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLogin, useWallets } from '@privy-io/react-auth';

const state = { api: null, waiting: null };

function Bridge() {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const ref = useRef({});
  ref.current = { ready, authenticated, logout, getAccessToken, wallets };
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
      authenticated: () => ref.current.authenticated,
      // The user's own wallet (the one made for them, else one they connected), as a standard provider that signs.
      async wallet() {
        // After a page reload Privy restores the sign-in first and connects the wallet a moment later, so wait for it.
        const pick = () => ref.current.wallets.find((x) => x.walletClientType === 'privy') || ref.current.wallets[0];
        const end = Date.now() + 15000;
        while (!pick() && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
        const w = pick();
        if (!w) throw new Error('Your wallet is still loading. Wait a few seconds and try again.');
        try { await w.switchChain(137); } catch { /* signing does not depend on it */ }
        return { provider: await w.getEthereumProvider(), address: w.address };
      },
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
        loginMethods: ['email', 'google', 'wallet'],
        appearance: { theme: 'dark', accentColor: '#ff6a2d', logo: '/assets/clue-mark-on-dark.svg', showWalletLoginFirst: false },
        // People who sign in with just an email get a wallet made for them. Anyone who already has one is left alone.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
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
    // Privy takes a few seconds to start the first time. Wait for it instead of failing.
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !(state.api && state.api.ready())) await new Promise((r) => setTimeout(r, 100));
    if (!(state.api && state.api.ready())) throw new Error('Privy is taking too long to start. Check your connection and try again.');
    return state.api.login();
  },
  async logout() { if (state.api) await state.api.logout(); },
  // Waits for Privy to restore the person's sign-in, then returns their wallet. Used when setting up trading.
  async provider() {
    const until = (test, ms) => new Promise((resolve) => { const end = Date.now() + ms; const tick = () => (test() || Date.now() > end ? resolve(test()) : setTimeout(tick, 150)); tick(); });
    if (!(await until(() => state.api && state.api.ready(), 25000))) throw new Error('Privy is taking too long to start. Check your connection and try again.');
    if (!(await until(() => state.api.authenticated(), 8000))) throw new Error('Sign in again to set up trading.');
    return state.api.wallet();
  },
};
