"""Builds site/index.html: one self-contained page with the fonts and libraries embedded."""
import base64, json, pathlib
src = pathlib.Path(__file__).parent; root = src.parent
t = (src / 'template.html').read_text()
fonts = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((src / 'fonts').glob('*.ttf'))}
t = t.replace('/*KCORE*/', (src / 'kcore.js').read_text()).replace('/*FONTS*/', json.dumps(fonts))
libs = {'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js': 'opentype.min.js',
        'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js': 'clipper.js',
        'https://cdn.jsdelivr.net/npm/earcut@2.2.4/dist/earcut.min.js': 'earcut.min.js',
        'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js': 'fflate.umd.js'}
for url, f in libs.items():
    tag = f'<script src="{url}"></script>'
    assert tag in t, tag
    t = t.replace(tag, '<script>\n' + (src / 'lib' / f).read_text().replace('</script', '<\\/script') + '\n</script>')
(root / 'site' / 'index.html').write_text(t)
print(f'site/index.html {len(t)//1024} KB')
