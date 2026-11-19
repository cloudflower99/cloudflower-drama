'use strict';
(()=>{
 const key='cloudflower-theme',media=matchMedia('(prefers-color-scheme: dark)');
 const saved=()=>{try{let s=localStorage.getItem(key);return s==='dark'||s==='light'?s:null}catch{return null}};
 function apply(theme){document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;const b=document.querySelector('#theme-toggle');if(b){b.textContent=theme==='dark'?'☀️ 日间':'🌙 夜间';b.setAttribute('aria-label',theme==='dark'?'切换到日间模式':'切换到夜间模式');b.setAttribute('aria-pressed',String(theme==='dark'))}}
 apply(saved()||(media.matches?'dark':'light'));
 document.addEventListener('DOMContentLoaded',()=>{apply(saved()||(media.matches?'dark':'light'));document.querySelector('#theme-toggle')?.addEventListener('click',()=>{let t=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,t)}catch{}apply(t)})},{once:true});
 media.addEventListener?.('change',()=>{if(!saved())apply(media.matches?'dark':'light')});window.addEventListener('storage',e=>{if(e.key===key)apply(saved()||(media.matches?'dark':'light'))});
})();
