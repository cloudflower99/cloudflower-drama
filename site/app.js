'use strict';
const grid=document.querySelector('#grid'), count=document.querySelector('#count'), msg=document.querySelector('#message'), more=document.querySelector('#more'), q=document.querySelector('#q'), dateFilter=document.querySelector('#date-filter');
let all=[],filtered=[],shown=0;const size=18;
const mobileView=matchMedia('(max-width:600px)'),viewList=document.querySelector('#view-list'),viewGrid=document.querySelector('#view-grid'),viewStorageKey='cloudflower-catalog-view-v1';
let savedView=null;try{savedView=localStorage.getItem(viewStorageKey)}catch{}if(!['list','grid'].includes(savedView))savedView=null;
function setView(mode,persist=false){grid.dataset.view=mode;viewList.setAttribute('aria-pressed',String(mode==='list'));viewGrid.setAttribute('aria-pressed',String(mode==='grid'));if(persist){savedView=mode;try{localStorage.setItem(viewStorageKey,mode)}catch{}}}
function autoView(){if(!savedView)setView(mobileView.matches?'list':'grid')}
viewList.addEventListener('click',()=>setView('list',true));viewGrid.addEventListener('click',()=>setView('grid',true));if(mobileView.addEventListener)mobileView.addEventListener('change',autoView);else if(mobileView.addListener)mobileView.addListener(autoView);setView(savedView||(mobileView.matches?'list':'grid'));

let dateManuallySelected=false,catalogLoaded=false,catalogVersion=null,catalogPending=false;
let reviewRows=[],optionNames=[],reviewByTitle=new Map(),reviewReady=false,optionsReady=false,hasReviewData=false,reviewFetchPending=false,optionsFetched=false,reviewSyncState='loading',reviewRevision=null,optionsLastFetch=0;
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

const sortLabel=document.createElement('label');sortLabel.htmlFor='sort-order';sortLabel.innerHTML='<svg class="filter-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v15m-3-3 3 3 3-3M17 20V5m-3 3 3-3 3 3"/></svg>排序方式';
const sortOrder=document.createElement('select');sortOrder.id='sort-order';sortOrder.innerHTML='<option value="newest">最新更新</option><option value="rating">评分从高到低</option>';
const sortNotice=document.createElement('span');sortNotice.setAttribute('role','status');
const retryReviews=element('button','inline-retry','重试评价');retryReviews.type='button';retryReviews.hidden=true;retryReviews.addEventListener('click',refreshReviews);
dateFilter.after(sortLabel,sortOrder,sortNotice,retryReviews);
function updateSortNotice(){let status=reviewSyncState==='updating'?'评价为缓存，正在更新':reviewSyncState==='stale'?'评价或剧集列表更新暂不可用':reviewSyncState==='failed'?'评价暂时无法加载，正在重试':' ';sortNotice.textContent=(sortOrder.value==='rating'&&reviewReady?'未评分靠后 · ':'')+status;retryReviews.hidden=!['stale','failed'].includes(reviewSyncState);retryReviews.disabled=reviewFetchPending}

const norm=x=>(x||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function rebuildScores(){
  const titles=all.map(x=>x.title), ts=titles.map(norm), opts=optionNames.map(norm), grouped=new Map(), exact=new Map(), prefixes=new Map();
  for(const r of reviewRows){if(!grouped.has(r.drama))grouped.set(r.drama,[]);grouped.get(r.drama).push(r)}
  // Compute prefix uniqueness once per option, not repeatedly for every title.
  for(let j=0;j<opts.length;j++){
    const v=opts[j];if(!exact.has(v))exact.set(v,[]);exact.get(v).push(j);
    if(v.length<4)continue;
    let match=-1,count=0;for(let i=0;i<ts.length;i++)if(ts[i].startsWith(v)){match=i;if(++count>1)break}
    if(count!==1)continue;
    let optionCount=0;for(const o of opts)if(o.startsWith(v)&&++optionCount>1)break;
    if(optionCount===1){if(!prefixes.has(match))prefixes.set(match,[]);prefixes.get(match).push(j)}
  }
  reviewByTitle.clear();
  for(let i=0;i<titles.length;i++){
    const direct=exact.get(ts[i])||[],possible=direct.length?direct:(prefixes.get(i)||[]);
    if(possible.length!==1)continue;
    const option=optionNames[possible[0]],reviews=(grouped.get(option)||[]).slice().sort((a,b)=>(b.time||'').localeCompare(a.time||''));
    const rated=reviews.filter(r=>r.rating>=1&&r.rating<=5),total=rated.reduce((sum,r)=>sum+r.rating,0);
    reviewByTitle.set(titles[i],{option,reviews,count:rated.length,score:rated.length?total/rated.length:null,average:rated.length?(total/rated.length).toFixed(1):null});
  }
}
async function refreshReviews(){
  if(reviewFetchPending)return;reviewFetchPending=true;retryReviews.disabled=true;
  const get=readJSON,previousState=reviewSyncState;let changed=false;
  try{
    const [opts,version]=await Promise.allSettled([optionsFetched&&Date.now()-optionsLastFetch<60000?Promise.resolve(null):get('options'),get('version')]);
    if(opts.status==='fulfilled'&&opts.value&&Array.isArray(opts.value.options)){optionNames=opts.value.options;optionsReady=optionsFetched=true;optionsLastFetch=Date.now();cacheWrite('options',optionNames);changed=true}
    let state=version.status==='fulfilled'?version.value:null;
    if(!state||!state.ready||!hasReviewData||reviewRevision!==String(state.revision)){
      let data=await get('reviews');if(!Array.isArray(data.reviews))throw Error('reviews');reviewRows=data.reviews;hasReviewData=true;changed=true;
      reviewRevision=data.ready?String(data.revision):null;cacheWrite('reviews',reviewRows,reviewRevision);
      state=data;
    }
    reviewSyncState=state.stale||!state.ready||opts.status==='rejected'?'stale':'fresh';
    if(optionsReady&&hasReviewData){reviewReady=true;if(changed)rebuildScores()}if(all.length&&(changed||previousState!==reviewSyncState))filter(true);
  }catch{if(optionsReady&&hasReviewData){reviewReady=true;if(changed)rebuildScores()}reviewSyncState=reviewReady?'stale':'failed';if(all.length&&(changed||previousState!==reviewSyncState))filter(true)}finally{reviewFetchPending=false;updateSortNotice()}
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
  for(const r of latest){const row=element('div','review-snippet'),meta=element('div','review-meta');meta.append(element('span','review-author',r.author||'匿名观众'));if(r.rating)meta.append(element('span','review-stars','★'.repeat(r.rating)+'☆'.repeat(5-r.rating)));if(r.time){const time=element('time','review-time');time.dateTime=r.time;time.textContent=new Date(r.time).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});meta.append(time)}const chars=Array.from(r.content.trim());row.append(meta,element('p','review-text',chars.length>120?chars.slice(0,120).join('')+'…':chars.join('')));if(r.id)row.append(CloudLikes.button('review',r.id));section.append(row)}return section
}
function render(keep=0){grid.replaceChildren();shown=0;do{append()}while(shown<Math.min(keep,filtered.length))}
function splitTitle(title){
 const lastChinese=Math.max(...Array.from(title.matchAll(/[\u3400-\u9fff]/g),m=>m.index),-1);
 if(lastChinese<0)return [title,''];
 const tail=title.slice(lastChinese+1),boundary=/\s+(?=[A-Za-z])/.exec(tail);
 if(!boundary)return [title,''];
 const at=lastChinese+1+boundary.index;return [title.slice(0,at).trim(),title.slice(at).trim()];
}
function append(){
 let cardIndex=0;
 for(const x of filtered.slice(shown,shown+size)){
  const review=reviewByTitle.get(x.title),url=dramaUrl(x.title,review?.option),card=element('article','card'),posterLink=element('a','poster-link'),cover=element('div','cover');
  posterLink.href=url;posterLink.setAttribute('aria-label','查看 '+x.title+' 的详情和评价');
  if(x.image){const img=document.createElement('img');img.alt=x.title+' 海报';img.loading=shown===0&&cardIndex<2?'eager':'lazy';img.decoding='async';img.addEventListener('load',()=>cover.classList.toggle('portrait',img.naturalHeight>img.naturalWidth));if(shown===0&&cardIndex===0)img.fetchPriority='high';let fallback=!!x.thumbnail&&x.thumbnail!==x.image;img.addEventListener('error',()=>{if(fallback){fallback=false;img.src=x.image}else{img.remove();cover.append(element('span','poster-empty','☁ 暂无海报'))}});img.src=x.thumbnail||x.image;cover.append(img)}else cover.append(element('span','poster-empty','☁ 暂无海报'));
  posterLink.append(cover);card.append(posterLink);
  const body=element('div','cardbody'),heading=element('h3'),titleLink=element('a','drama-title-link');titleLink.href=url;titleLink.setAttribute('aria-label',x.title+' 的全部评价');titleLink.title=x.title;const [mainTitle,englishTitle]=splitTitle(x.title);titleLink.append(element('span','title-main',mainTitle),element('span','title-en',englishTitle));heading.append(titleLink);body.append(element('p','date',x.date||'日期未注明'),heading);
  body.append(element('p','card-summary',(x.description||'暂无简介').replace(/\s+/g,' ').trim()));
  const stats=element('div','card-stats');stats.append(CloudLikes.button('drama',x.title));
  if(reviewReady&&review){const score=review.average?`★ ${review.average} / 5 · ${review.count} 条评分`:'☆ 暂无评分';stats.append(element('p','rating rating-live',score))}body.append(stats);
  const links=element('div','card-links');for(const [name,raw] of Object.entries(x.links||{})){try{const dest=new URL(raw);if(dest.protocol!=='https:')continue;const link=element('a','',name+' ↗');link.href=dest.href;link.target='_blank';link.rel='noopener noreferrer';links.append(link)}catch{}}if(links.childElementCount)body.append(links);

  if(reviewReady&&review)body.append(reviewPanel(review,x.title));else body.append(element('p','review-empty',reviewReady?(optionsFetched?'暂未匹配评价入口':'评价信息更新中…'):reviewSyncState==='failed'?'短评暂时无法加载，请重试。':'短评正在加载…'));
  card.append(body);grid.append(card);cardIndex++
 }
 shown=Math.min(shown+size,filtered.length);more.hidden=shown>=filtered.length;count.textContent=`${filtered.length} 部剧集`;msg.hidden=filtered.length>0;msg.textContent='没有找到相关剧集，试试其他关键词或日期。'
}
function filter(preserve=false){let keep=preserve?shown:0,s=q.value.trim().toLocaleLowerCase();filtered=all.filter(x=>(!s||x.title.toLocaleLowerCase().includes(s))&&(s||!dateFilter||dateFilter.value==='all'||(x.date||'undated')===dateFilter.value));if(sortOrder.value==='rating'&&reviewReady)filtered.sort((a,b)=>{let x=reviewByTitle.get(a.title)?.score,y=reviewByTitle.get(b.title)?.score;return x==null?(y==null?0:1):y==null?-1:y-x});render(keep)}
document.querySelector('#search-form').addEventListener('submit',e=>{e.preventDefault();filter()});q.addEventListener('input',filter);if(dateFilter)dateFilter.addEventListener('change',()=>{dateManuallySelected=true;q.value='';filter()});more.addEventListener('click',append);sortOrder.addEventListener('change',()=>{updateSortNotice();filter()});
const retryCatalog=element('button','inline-retry catalog-retry','重试加载目录');retryCatalog.type='button';retryCatalog.hidden=true;msg.after(retryCatalog);retryCatalog.addEventListener('click',loadCatalog);
function applyCatalog(items,version){
  const previousDate=dateFilter.value;if(catalogVersion&&catalogVersion!==version)optionsFetched=false;all=items;catalogVersion=version;catalogLoaded=true;rebuildScores();
  const dates=[...new Set(all.map(x=>x.date||'undated'))].sort((a,b)=>a==='undated'?1:b==='undated'?-1:b.localeCompare(a));
  dateFilter.replaceChildren();const allDates=element('option','','全部日期');allDates.value='all';dateFilter.append(allDates);
  for(const date of dates){const opt=element('option','',date==='undated'?'日期未注明':date);opt.value=date;dateFilter.append(opt)}
  dateFilter.value=dateManuallySelected&&(previousDate==='all'||dates.includes(previousDate))?previousDate:(dates[0]||'all');
  document.querySelector('#updated').textContent='最近同步：'+new Date(version).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  filter(true);
}
async function loadCatalog(){
 if(catalogPending)return;catalogPending=true;retryCatalog.hidden=true;
 if(!catalogLoaded){msg.hidden=false;msg.textContent='目录正在加载…'}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  // Revalidate and vary the URL periodically, avoiding stale browser/CDN copies.
  const r=await fetch('data.json?v='+Math.floor(Date.now()/30000),{cache:'no-store',signal:controller.signal});
  if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();
  if(!Array.isArray(data.items)||!data.generated)throw Error('invalid catalog');
  if(catalogVersion&&data.generated<catalogVersion){catalogStatus.textContent='服务器数据较旧，显示上次同步的内容。';return}
  if(data.generated===catalogVersion){catalogStatus.textContent='';return}
  applyCatalog(data.items,data.generated);cacheWrite('catalog',all,catalogVersion);
  catalogStatus.textContent='';
 }catch{
  if(catalogLoaded){catalogStatus.textContent='目录更新暂不可用，显示已有内容。';retryCatalog.hidden=false}
  else{count.textContent='';msg.hidden=false;msg.textContent='目录暂时无法加载，请检查网络后重试。';retryCatalog.hidden=false}
 }finally{clearTimeout(timer);catalogPending=false}
}
const catalogStatus=element('span','catalog-status');catalogStatus.setAttribute('role','status');retryCatalog.before(catalogStatus);
const savedCatalog=cacheObject('catalog');
let bootstrap=null;try{bootstrap=JSON.parse(document.querySelector('#catalog-bootstrap')?.textContent||'null')}catch{}
const validSnapshot=x=>x&&Array.isArray(x.items)&&typeof x.generated==='string'&&!Number.isNaN(Date.parse(x.generated));
const savedSnapshot=savedCatalog?{items:savedCatalog.value,generated:savedCatalog.revision}:null;
const initial=validSnapshot(bootstrap)&&(!validSnapshot(savedSnapshot)||bootstrap.generated>=savedSnapshot.generated)?bootstrap:savedSnapshot;
if(validSnapshot(initial))applyCatalog(initial.items,initial.generated);
loadCatalog();setInterval(()=>{if(!document.hidden)loadCatalog()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadCatalog()});window.addEventListener('online',loadCatalog);
