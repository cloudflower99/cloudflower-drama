"""Optimize cached poster assets after Notion sync, preserving cache references."""
import json, os, pathlib
from PIL import Image, ImageOps, UnidentifiedImageError

site = pathlib.Path('site')
manifest_path = pathlib.Path('.sync-cache/manifest.json')
data_path = site / 'data.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
data = json.loads(data_path.read_text(encoding='utf-8'))
covers = site / 'covers'
mapping = {}
original_bytes = saved_bytes = count = skipped = 0
paths = {entry.get('image') for entry in data.get('items', []) if entry.get('image')}
paths.update(v.get('path') for v in manifest.get('images', {}).values() if v.get('path'))
for source in sorted(paths):
    relative = pathlib.PurePosixPath(source)
    # Only process simple files directly under site/covers.
    if len(relative.parts) != 2 or relative.parts[0] != 'covers' or relative.name.endswith('.opt.webp'):
        continue
    path = covers / relative.name
    if not path.is_file():
        continue
    target = covers / (path.name + '.opt.webp')
    tmp = covers / (path.name + '.opt.tmp')
    try:
        with Image.open(path) as img:
            # Never flatten animated images or enlarge small images.
            if getattr(img, 'is_animated', False):
                skipped += 1
                continue
            img = ImageOps.exif_transpose(img)
            img.thumbnail((600, 900), Image.Resampling.LANCZOS)
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA' if 'transparency' in img.info or 'A' in img.getbands() else 'RGB')
            img.save(tmp, format='WEBP', quality=80, method=4)
        if tmp.stat().st_size >= path.stat().st_size:
            tmp.unlink()
            skipped += 1
            continue
        with Image.open(tmp) as check:
            check.verify()
        os.replace(tmp, target)
        mapping[source] = 'covers/' + target.name
        original_bytes += path.stat().st_size
        saved_bytes += target.stat().st_size
        count += 1
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        tmp.unlink(missing_ok=True)
        skipped += 1
        print('Keeping original:', relative.name, type(exc).__name__, flush=True)

def replace_paths(value):
    if isinstance(value, list):
        for item in value: replace_paths(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in ('path', 'image') and isinstance(item, str) and item in mapping:
                value[key] = mapping[item]
            else:
                replace_paths(item)

def atomic_json(path, obj):
    tmp = path.with_name(path.name + '.opt.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    os.replace(tmp, path)

replace_paths(data)
replace_paths(manifest)
atomic_json(data_path, data)
atomic_json(manifest_path, manifest)
# Keep original paths available to browsers holding an older cached data.json.
print(f'Optimized {count} covers: {original_bytes} -> {saved_bytes} bytes; skipped {skipped}.', flush=True)
