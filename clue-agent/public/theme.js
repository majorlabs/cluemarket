(() => {
  const preference=matchMedia('(prefers-color-scheme: dark)');
  const saved=()=>{try{return localStorage.getItem('clue-theme')}catch{return null}};
  const apply=theme=>{document.documentElement.dataset.theme=theme;const button=document.getElementById('theme-toggle');if(button){button.innerHTML=theme==='dark'?'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>':'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z"/></svg>';button.setAttribute('aria-label','Switch to '+(theme==='dark'?'light':'dark')+' mode');button.setAttribute('aria-pressed',String(theme==='dark'))}};
  apply(saved()||'light');
  
  window.installClueTheme=()=>{const button=document.createElement('button');button.id='theme-toggle';button.className='theme-button';button.type='button';button.onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('clue-theme',theme)}catch{}apply(theme)};document.getElementById('account-open').before(button);apply(document.documentElement.dataset.theme)};
})();
