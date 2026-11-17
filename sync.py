import os, json, time, re, pathlib, urllib.request, urllib.error, shutil, datetime
TOKEN=os.environ.get('NOTION_TOKEN')
if not TOKEN: raise SystemExit('Missing NOTION_TOKEN repository secret')
ROOT='41a26fd4d86d80e5ac94e79d297e626a'
ARCHIVE='18826fd4d86d82fdb03001c08cafbf5c'
BASE='https://api.notion.com/v1/'
out=pathlib.Path('site'); images=out/'covers'; images.mkdir(exist_ok=True)
cache_dir=pathlib.Path('.sync-cache'); cache_dir.mkdir(exist_ok=True)
cache_file=cache_dir/'manifest.json'
try:
    cache=json.loads(cache_file.read_text(encoding='utf-8')) if cache_file.exists() else {}
    if cache.get('version')!=1: cache={}
except (ValueError,OSError): cache={}
page_cache=cache.get('pages',{}); image_cache=cache.get('images',{})
headers={'Authorization':'Bearer '+TOKEN,'Notion-Version':'2022-06-28'}
last=0

def request(url, headers=None):
    global last
    for attempt in range(6):
        if headers:
            wait=.36-(time.monotonic()-last)
            if wait>0: time.sleep(wait)
            last=time.monotonic()
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),timeout=45) as r: return r.read(),r.headers
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as e:
            if isinstance(e,urllib.error.HTTPError) and e.code not in (429,500,502,503,504): raise
            if attempt==5: raise
            time.sleep(min(2**attempt,30))

def children(block):
    all=[]; cursor=None
    while True:
        url=BASE+'blocks/'+block+'/children?page_size=100'+('&start_cursor='+cursor if cursor else '')
        data=json.loads(request(url,headers)[0]); all.extend(data['results'])
        if not data.get('has_more'): return all
        cursor=data['next_cursor']

def text(b):
    return ''.join(t.get('plain_text','') for t in b.get(b['type'],{}).get('rich_text',[]))

def image(block):
    old=image_cache.get(block['id'],{}); old_path=out/old.get('path','__missing__')
    if old.get('stamp')==block.get('last_edited_time') and old_path.is_file(): return old['path']
    obj=block['image']; kind=obj.get('type'); src=obj.get(kind,{}).get('url')
    if not src or not src.startswith('https://'): return ''
    try:
        body,h=request(src); typ=h.get_content_type(); ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}.get(typ)
        if body.startswith(b'\xff\xd8\xff'): ext='jpg'
        elif body.startswith(b'\x89PNG\r\n\x1a\n'): ext='png'
        elif body.startswith((b'GIF87a',b'GIF89a')): ext='gif'
        elif body[:4]==b'RIFF' and body[8:12]==b'WEBP': ext='webp'
        if not ext or len(body)>15000000: raise ValueError('unsupported image: '+typ+' ('+str(len(body))+' bytes)')
        name=block['id']+'.'+ext; (images/name).write_bytes(body); path='covers/'+name; image_cache[block['id']]={'stamp':block.get('last_edited_time'),'path':path}; return path
    except Exception as e:
        print('Warning: cover unavailable for block',block['id'],type(e).__name__,str(e)[:100]); return old.get('path','') if old_path.is_file() else ''

def parse_group(group, default_date=''):
    columns=children(group['id']); blocks=[]
    for col in columns:
        if col['type']=='column': blocks.extend(children(col['id']))
    title=next((text(b).strip() for b in blocks if b['type'] in ('heading_1','heading_2','heading_3')), '')
    if not title: return None
    paras=[b for b in blocks if b['type']=='paragraph']; date=default_date; rating=''; description=[]; links={}
    for b in paras:
        s=text(b).strip(); matches=re.search(r'(?:更新日期|视频发布日期)\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日',s)
        if matches: date='%04d-%02d-%02d'%tuple(map(int,matches.groups()));continue
        if '观众评分' in s: rating=s;continue
        for t in b.get('paragraph',{}).get('rich_text',[]):
            u=t.get('href') or ((t.get('text') or {}).get('link') or {}).get('url')
            label=t.get('plain_text','')
            if u and label in ('百度网盘','夸克网盘','迅雷网盘') and u.startswith('https://'): links[label]=u
        if s and not s.startswith('📥'): description.append(s)
    img=next((b for b in blocks if b['type']=='image'),None)
    return {'title':title,'date':date,'rating':rating,'description':'\n\n'.join(description),'links':links,'image':image(img) if img else '', 'added_at': group.get('created_time','') if group.get('created_time','') >= '2026-11-17T03:40:00Z' else ''}

def parse_page(page, default_date=''):
    records=[]
    for group in children(page):
        if group['type']=='column_list':
            item=parse_group(group,default_date)
            if item: records.append(item)
    return records

def stale(ts, now):
    try: return now-datetime.datetime.fromisoformat(ts)>=datetime.timedelta(hours=24)
    except (ValueError,TypeError): return True

def covers_exist(entries):
    return all(not e.get('image') or (out/e['image']).is_file() for e in entries)

now=datetime.datetime.now(datetime.timezone.utc)
home_groups=cache.get('home_groups',{}); updated_home={}; home=[]
for group in children(ROOT):
    if group['type']!='column_list': continue
    old=home_groups.get(group['id'],{}); entry=old.get('entry')
    refresh=(not entry or old.get('source_stamp')!=group.get('last_edited_time') or stale(old.get('refreshed_at',''),now) or not covers_exist([entry]))
    if refresh:
        entry=parse_group(group)
        if not entry: raise SystemExit('Cannot parse home resource; refusing to publish incomplete catalog: '+group['id'])
        updated_home[group['id']]={'source_stamp':group.get('last_edited_time'),'refreshed_at':now.isoformat(),'entry':entry}
        print('Home:',entry['title'],'refreshed',flush=True)
    else:
        updated_home[group['id']]=old
        print('Home:',entry['title'],'cached',flush=True)
    home.append(entry)
archive_pages=[x for x in children(ARCHIVE) if x['type']=='child_page' and re.match(r'^\d{4}-\d{2}-\d{2} 剧集$', x['child_page']['title'])]
if len(archive_pages)<50: raise SystemExit('Archive looks incomplete: fewer than 50 daily pages; refusing to publish.')
items=home[:]; updated_pages={}
for p in archive_pages:
    day=p['child_page']['title'][:10]; old=page_cache.get(p['id'],{}); entries=old.get('entries',[])
    needs_refresh=(not entries or old.get('day')!=day or old.get('source_stamp')!=p.get('last_edited_time') or stale(old.get('refreshed_at',''),now) or not covers_exist(entries))
    if needs_refresh:
        entries=parse_page(p['id'],day)
        if not entries: raise SystemExit('No entries found in '+day+'; refusing to publish.')
        updated_pages[p['id']]={'day':day,'source_stamp':p.get('last_edited_time'),'refreshed_at':now.isoformat(),'entries':entries}
        print(day,len(entries),'refreshed',flush=True)
    else:
        updated_pages[p['id']]=old
        print(day,len(entries),'cached',flush=True)
    items.extend(entries)
if len(items)<350: raise SystemExit('Too few shows; refusing to publish incomplete catalog.')
# New additions sort first within their resource date; historical order is preserved.
items.sort(key=lambda x:(x['date'],x.get('added_at','')),reverse=True)
(out/'data.json').write_text(json.dumps({'generated':now.isoformat(),'items':items},ensure_ascii=False),encoding='utf-8')
tmp=cache_file.with_suffix('.tmp'); tmp.write_text(json.dumps({'version':1,'pages':updated_pages,'images':image_cache,'home_groups':updated_home},ensure_ascii=False),encoding='utf-8');tmp.replace(cache_file)
print('Built',len(items),'shows')
