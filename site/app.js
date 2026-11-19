'use strict';
const grid=document.querySelector('#grid'), count=document.querySelector('#count'), msg=document.querySelector('#message'), more=document.querySelector('#more'), q=document.querySelector('#q'), dateFilter=document.querySelector('#date-filter');
let all=[],filtered=[],shown=0;const size=18;
let reviewRows=[],optionNames=[],reviewByTitle=new Map(),reviewReady=false,optionsReady=false,hasReviewData=false,reviewFetchPending=false,optionsFetched=false,reviewSyncState='loading',reviewRevision=null;
// Keep the last successful public snapshot for offline fallback. Its revision
// travels with the snapshot so quota failures cannot mark old data as current.
const cacheObject=key=>{try{const x=JSON.parse(localStorage.getItem('cloudflower-'+key+'-v1'));return x&&Number.isFinite(x.at)&&x.at<=Date.now()+60000&&Array.isArray(x.value)?x:null}catch{return null}};
const cacheRead=key=>cacheObject(key)?.value||null;
const cacheWrite=(key,value,revision=null)=>{try{localStorage.setItem('cloudflower-'+key+'-v1',JSON.stringify({at:Date.now(),value,revision}));return true}catch{return false}};
async function readJSON(path){
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{const r=await fetch('https://api.cloudofflower.ccwu.cc/'+path,{signal:controller.signal});if(!r.ok){const e=Error('HTTP '+r.status);e.noRetry=r.status<500;throw e}return await r.json()}
  catch(e){if(attempt||e.noRetry)throw e;await new Promise(resolve=>setTimeout(resolve,1000))}
  finally{clearTimeout(timer)}
 }
}
reviewRevision=cacheObject('reviews')?.revision??null;
const savedOptions=cacheRead('options'),savedReviews=cacheRead('reviews');
if(savedOptions){optionNames=savedOptions;optionsReady=true}if(savedReviews){reviewRows=savedReviews;hasReviewData=true;if(optionsReady){reviewReady=true;reviewSyncState='updating'}}

const sortLabel=document.createElement('label');sortLabel.htmlFor='sort-order';sortLabel.textContent='↕️ 排序方式';
const sortOrder=document.createElement('select');sortOrder.id='sort-order';sortOrder.innerHTML='<option value="newest">最新更新</option><option value="rating">评分从高到低</option>';
const sortNotice=document.createElement('span');sortNotice.setAttribute('role','status');
dateFilter.after(sortLabel,sortOrder,sortNotice);
function updateSortNotice(){let status=reviewSyncState==='updating'?'评价为缓存，正在更新':reviewSyncState==='stale'?'评价或剧集列表更新暂不可用':reviewSyncState==='failed'?'评价暂时无法加载，正在重试':' ';sortNotice.textContent=(sortOrder.value==='rating'&&reviewReady?'未评分靠后 · ':'')+status}

const norm=x=>(x||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function rebuildScores(){
  const titles=all.map(x=>x.title), ts=titles.map(norm), opts=optionNames.map(norm), grouped=new Map();
  for(const r of reviewRows){if(!grouped.has(r.drama))grouped.set(r.drama,[]);grouped.get(r.drama).push(r)}
  reviewByTitle.clear();
  for(let i=0;i<titles.length;i++){
    const n=ts[i],exact=opts.map((v,j)=>v===n?j:-1).filter(j=>j>=0);
    const possible=exact.length?exact:opts.map((v,j)=>v.length>=4&&n.startsWith(v)&&ts.filter(t=>t.startsWith(v)).length===1&&opts.filter(t=>t.startsWith(v)).length===1?j:-1).filter(j=>j>=0);
    if(possible.length!==1)continue;
    const option=optionNames[possible[0]],reviews=(grouped.get(option)||[]).slice().sort((a,b)=>(b.time||'').localeCompare(a.time||''));
    const rated=reviews.filter(r=>r.rating>=1&&r.rating<=5);
    reviewByTitle.set(titles[i],{option,reviews,count:rated.length,score:rated.length?rated.reduce((sum,r)=>sum+r.rating,0)/rated.length:null,average:rated.length?(rated.reduce((sum,r)=>sum+r.rating,0)/rated.length).toFixed(1):null});
  }
}
async function refreshReviews(){
  if(reviewFetchPending)return;reviewFetchPending=true;
  const get=readJSON;
  try{
    const [opts,version]=await Promise.allSettled([optionsFetched?Promise.resolve(null):get('options'),get('version')]);
    if(opts.status==='fulfilled'&&opts.value&&Array.isArray(opts.value.options)){optionNames=opts.value.options;optionsReady=optionsFetched=true;cacheWrite('options',optionNames)}
    let state=version.status==='fulfilled'?version.value:null;
    if(!state||!state.ready||!hasReviewData||reviewRevision!==String(state.revision)){
      let data=await get('reviews');if(!Array.isArray(data.reviews))throw Error('reviews');reviewRows=data.reviews;hasReviewData=true;
      reviewRevision=data.ready?String(data.revision):null;cacheWrite('reviews',reviewRows,reviewRevision);
      state=data;
    }
    reviewSyncState=state.stale||!state.ready||opts.status==='rejected'?'stale':'fresh';
    if(optionsReady&&hasReviewData){reviewReady=true;rebuildScores()}if(all.length)filter(true);updateSortNotice();
  }catch{if(optionsReady&&hasReviewData){reviewReady=true;rebuildScores()}reviewSyncState=reviewReady?'stale':'failed';if(all.length)filter(true);updateSortNotice()}finally{reviewFetchPending=false}
}
updateSortNotice();refreshReviews();setInterval(()=>{if(!document.hidden)refreshReviews()},15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshReviews()});window.addEventListener('online',refreshReviews);
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e}
function dramaUrl(title,option){const q=new URLSearchParams({title});if(option)q.set('drama',option);return 'drama.html?'+q.toString()}
function reviewPanel(data,title){
  const section=element('section','card-reviews');section.setAttribute('aria-label','本剧最新评价');
  const head=element('div','review-head');head.append(element('strong','', '💬 最新短评'));
  const link=element('a','review-link',data.reviews.length?'去评价页 ↗':'写第一条评价 ↗');link.textContent=data.reviews.length?'查看全部评价 ↗':'写第一条评价 ↗';link.href=dramaUrl(title,data.option);head.append(link);section.append(head);
  const latest=data.reviews.filter(r=>r.content&&r.content.trim()).slice(0,3);
  if(!latest.length){section.append(element('p','review-empty','还没有短评，欢迎分享你的感受。'));return section}
  for(const r of latest){const row=element('div','review-snippet'),meta=element('div','review-meta');meta.append(element('span','review-author',r.author||'匿名观众'));if(r.rating)meta.append(element('span','review-stars','★'.repeat(r.rating)+'☆'.repeat(5-r.rating)));if(r.time){const time=element('time','review-time');time.dateTime=r.time;time.textContent=new Date(r.time).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});meta.append(time)}const chars=Array.from(r.content.trim());row.append(meta,element('p','review-text',chars.length>120?chars.slice(0,120).join('')+'…':chars.join('')));section.append(row)}return section
}
function render(keep=0){grid.replaceChildren();shown=0;do{append()}while(shown<Math.min(keep,filtered.length))}
function append(){for(const x of filtered.slice(shown,shown+size)){let card=element('article','card'),cover=element('div','cover');if(x.image){let img=document.createElement('img');img.src=x.image;img.alt=x.title+' 海报';img.loading='lazy';cover.append(img)}card.append(cover);let body=element('div','cardbody');let review=reviewByTitle.get(x.title),heading=element('h3'),titleLink=element('a','drama-title-link',x.title);titleLink.href=dramaUrl(x.title,review?.option);titleLink.setAttribute('aria-label',x.title+' 的全部评价');heading.append(titleLink);body.append(element('p','date',x.date||'日期未注明'),heading);if(reviewReady&&review){let score=review.average?`★ ${review.average} / 5 · ${review.count} 条评分`:'☆ 暂无评分';body.append(element('p','rating rating-live',score))}if(x.description){body.append(element('p','summary',x.description.replace(/\n{2,}/g,'\n')))}let links=element('div','links');for(const [name,url] of Object.entries(x.links||{})){try{if(new URL(url).protocol!=='https:')continue}catch{continue}let a=element('a','',name+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a)}body.append(links);if(reviewReady&&review)body.append(reviewPanel(review,x.title));else if(!reviewReady)body.append(element('p','review-empty',reviewSyncState==='failed'?'短评暂时无法加载，正在重试。':'短评正在加载…'));card.append(body);grid.append(card)}shown=Math.min(shown+size,filtered.length);more.hidden=shown>=filtered.length;count.textContent=`${filtered.length} 部剧集`;msg.hidden=filtered.length>0;msg.textContent='没有找到相关剧集，试试其他关键词或日期。'}
function filter(preserve=false){let keep=preserve?shown:0,s=q.value.trim().toLocaleLowerCase();filtered=all.filter(x=>(!s||x.title.toLocaleLowerCase().includes(s))&&(s||!dateFilter||dateFilter.value==='all'||(x.date||'undated')===dateFilter.value));if(sortOrder.value==='rating'&&reviewReady)filtered.sort((a,b)=>{let x=reviewByTitle.get(a.title)?.score,y=reviewByTitle.get(b.title)?.score;return x==null?(y==null?0:1):y==null?-1:y-x});render(keep)}
document.querySelector('#search-form').addEventListener('submit',e=>{e.preventDefault();filter()});q.addEventListener('input',filter);if(dateFilter)dateFilter.addEventListener('change',()=>{q.value='';filter()});more.addEventListener('click',append);sortOrder.addEventListener('change',()=>{updateSortNotice();filter()});
fetch('data.json').then(r=>{if(!r.ok)throw Error('load');return r.json()}).then(data=>{all=data.items;rebuildScores();const dates=[...new Set(all.map(x=>x.date||'undated'))];dates.sort((a,b)=>a==='undated'?1:b==='undated'?-1:b.localeCompare(a));if(dateFilter){for(const date of dates){let opt=element('option','',date==='undated'?'日期未注明':date);opt.value=date;dateFilter.append(opt)}dateFilter.value=dates[0]||'all'};document.querySelector('#updated').textContent='最近同步：'+new Date(data.generated).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});filter()}).catch(()=>{count.textContent='';msg.hidden=false;msg.textContent='目录暂时无法加载，请稍后重试。'});
