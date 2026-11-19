'use strict';
(()=>{
 const $=s=>document.querySelector(s),make=$('#make-poster'),dialog=$('#poster-dialog'),preview=$('#poster-preview'),hint=$('#poster-hint'),share=$('#poster-share'),save=$('#poster-save');
 let item=null,blob=null,blobUrl=null,file=null;
 function setItem(x){if(x&&x.title){item=x;make.hidden=false}}
 window.addEventListener('cloudflower:drama',e=>setItem(e.detail));setItem(window.cloudflowerDrama);
 function rounded(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();c.fill()}
 function splitTitle(title){let last=-1;for(const m of title.matchAll(/[\u3400-\u9fff]/g))last=m.index;if(last<0)return [title,''];const tail=title.slice(last+1),m=/\s+(?=[A-Za-z])/.exec(tail);if(!m)return [title,''];const n=last+1+m.index;return [title.slice(0,n).trim(),title.slice(n).trim()]}
 function lines(c,text,width,max){const out=[];let line='';const chars=Array.from((text||'').replace(/\s+/g,' ').trim());for(let i=0;i<chars.length;i++){const next=line+chars[i];if(c.measureText(next).width>width&&line){out.push(line.trim());line=chars[i];if(out.length===max){let t=out[max-1];while(t&&c.measureText(t+'…').width>width)t=t.slice(0,-1);out[max-1]=t+'…';return out}}else line=next}if(line&&out.length<max)out.push(line.trim());return out}
 function drawLines(c,text,x,y,width,max,spacing){for(const line of lines(c,text,width,max)){c.fillText(line,x,y);y+=spacing}return y}
 function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();let timer=setTimeout(()=>{image.src='';reject(Error('图片加载超时'))},15000);image.crossOrigin='anonymous';image.onload=()=>{clearTimeout(timer);resolve(image)};image.onerror=()=>{clearTimeout(timer);reject(Error('海报加载失败'))};image.src=url})}
 function createBlob(canvas){return new Promise((resolve,reject)=>{try{canvas.toBlob(x=>x?resolve(x):reject(Error('图片生成失败')),'image/png')}catch(e){reject(e)}})}
 async function drawPoster(drama){
  let image=drama.image?await loadImage(drama.image):null;
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1550;const c=canvas.getContext('2d');
  const bg=c.createLinearGradient(0,0,1080,1550);bg.addColorStop(0,'#edf4ff');bg.addColorStop(1,'#f3efff');c.fillStyle=bg;c.fillRect(0,0,1080,1550);
  c.fillStyle='#fff';rounded(c,54,48,972,1454,32);
  c.fillStyle='#6b83c3';c.font='bold 25px system-ui, sans-serif';c.fillText('☁  在云的背面种花',98,112);c.fillStyle='#9aa8cb';c.textAlign='right';c.font='22px system-ui, sans-serif';c.fillText(drama.date||'剧集分享',982,112);c.textAlign='left';
  c.fillStyle='#f0f3fc';rounded(c,98,150,884,760,24);
  if(image){const scale=Math.min(884/image.naturalWidth,760/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;c.drawImage(image,98+(884-w)/2,150+(760-h)/2,w,h)}else{c.fillStyle='#9baacc';c.textAlign='center';c.font='30px system-ui, sans-serif';c.fillText('☁ 暂无海报',540,540);c.textAlign='left'}
  const [cn,en]=splitTitle(drama.title);let y=968;c.fillStyle='#273552';c.font='bold 49px system-ui, sans-serif';y=drawLines(c,cn,98,y,884,2,62);
  if(en){c.fillStyle='#7585a8';c.font='italic 28px system-ui, sans-serif';y=drawLines(c,en,98,y+4,884,2,38)}
  y+=30;c.fillStyle='#5d6f91';c.font='28px system-ui, sans-serif';drawLines(c,drama.description||'暂无简介',98,y,884,3,43);
  c.fillStyle='#e4eaf7';c.fillRect(98,1392,884,2);c.fillStyle='#7d8fb6';c.font='23px system-ui, sans-serif';c.fillText('在云的背面种花 · 剧集分享',98,1440);c.textAlign='right';c.fillText(location.host,982,1440);
  return createBlob(canvas);
 }
 make.addEventListener('click',async()=>{
  if(!item)return;make.disabled=true;const old=make.textContent;make.textContent='图片生成中…';
  try{
   const next=await drawPoster(item);if(blobUrl)URL.revokeObjectURL(blobUrl);blob=next;blobUrl=URL.createObjectURL(blob);preview.src=blobUrl;
   file=new File([blob],'cloudflower-drama.png',{type:'image/png'});
   let canShare=false;try{canShare=!!(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]}))}catch{}share.hidden=!canShare;save.hidden=false;hint.textContent='可以保存图片；手机也可以长按图片保存。';
   if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
  }catch(e){hint.textContent='图片暂时无法生成，请检查网络后重试。';preview.removeAttribute('src');share.hidden=true;save.hidden=true;if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','')}
  finally{make.disabled=false;make.textContent=old}
 });
 share.addEventListener('click',async()=>{try{await navigator.share({files:[file],title:item.title})}catch(e){if(e.name!=='AbortError')hint.textContent='分享未成功，可以保存或长按图片。'}});
 save.addEventListener('click',()=>{if(!blobUrl||!file)return;const a=document.createElement('a');a.href=blobUrl;a.download=file.name;document.body.append(a);a.click();a.remove();hint.textContent='如果没有自动保存，请长按图片保存。'});
 $('#poster-close').addEventListener('click',()=>{if(dialog.close)dialog.close();else dialog.removeAttribute('open');save.hidden=false});
})();
