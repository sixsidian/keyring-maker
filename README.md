# Name Keyring Maker

Web page that turns typed text into a two-colour 3D-printable keyring (raised lettering on a solid base with a key loop) and downloads it as a .3mf (filament slots set for Bambu Studio) or a single .stl.

- `site/index.html` - the published page (built, self-contained). Cloudflare Workers serves the `site` folder (see `wrangler.jsonc`); every push to `main` deploys.
- `src/` - source: `template.html` (page), `kcore.js` (geometry), `fonts/` (Google Fonts, Open Font License / Apache), `lib/` (opentype.js, clipper-lib, earcut, fflate, three.js).

Features: 14 fonts, letter height, raised or flush lettering, adjustable base, lettering height, border and hole, loop left/right/top/none, top and rotatable 3D preview, shareable design links (`?t=...&f=...`).

Rebuild after editing `src/`:

    python3 src/build.py
