(() => {
  const preference=matchMedia('(prefers-color-scheme: dark)');
  const saved=()=>{try{return localStorage.getItem('clue-theme')}catch{return null}};
  const apply=theme=>{document.documentElement.dataset.theme=theme;const button=document.getElementById('theme-toggle');if(button){button.textContent=theme==='dark'?'Light mode':'Dark mode';button.setAttribute('aria-label','Switch to '+(theme==='dark'?'light':'dark')+' mode');button.setAttribute('aria-pressed',String(theme==='dark'))}};
  apply(saved()|| (preference.matches?'dark':'light'));
  preference.addEventListener('change',()=>{if(!saved())apply(preference.matches?'dark':'light')});
  window.installClueTheme=()=>{const button=document.createElement('button');button.id='theme-toggle';button.className='theme-button';button.type='button';button.onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('clue-theme',theme)}catch{}apply(theme)};document.getElementById('account-open').before(button);apply(document.documentElement.dataset.theme)};
})();
