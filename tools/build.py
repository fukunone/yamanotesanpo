"""index.html と css/js を1つのファイルにまとめる。
dist/yamanote-sanpo.html … そのまま開ける単体ファイル
dist/artifact.html       … 共有ページ用（<html>等の枠なし）"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')
def inline_css(m): return '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '\n</style>'
def inline_js(m): return '<script>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '\n</script>'
out = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, src)
out = re.sub(r'<script src="(js/[^"]+)"></script>', inline_js, out)
dist = root / 'dist'; dist.mkdir(exist_ok=True)
(dist / 'yamanote-sanpo.html').write_text(out, encoding='utf-8')
head = re.search(r'<head>(.*?)</head>', out, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', out, re.S).group(1)
keep = '\n'.join(l for l in head.splitlines() if l.startswith(('<title', '<link', '<style')) or not l.startswith('<'))
art = keep + '\n' + body
(dist / 'artifact.html').write_text(art, encoding='utf-8')
print('built', len(out), len(art))
