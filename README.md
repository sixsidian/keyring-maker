# Keyring Maker

Web page that turns typed text into a two-colour 3D-printable keyring (raised lettering on a solid base with a key loop) and downloads it as a .3mf (filament slots set for Bambu Studio), named "Keyring <order number>.3mf" when an order number is entered or passed as `?o=`. Styled in the Maker's Notebook colours of The Custom 3D Print Shop.

- `site/index.html` - the published page (built, self-contained). Cloudflare Workers serves the `site` folder (see `wrangler.jsonc`); every push to `main` deploys.
- `src/worker.js` - stores the keyring preview pictures the shop basket shows (`/preview`, Workers KV namespace keyring-previews).
- `src/` - source: `template.html` (page), `kcore.js` (geometry), `fonts/` (Google Fonts, Open Font License / Apache), `lib/` (opentype.js, clipper-lib, earcut, fflate, three.js).

Features: two styles - keyring or UK number plate (yellow or white plate, black border and lettering, Barlow Condensed SemiBold, up to 12 characters) - 14 fonts, letter height, raised or flush lettering, adjustable base, lettering height, border and hole, loop left/right/top/none, top and rotatable 3D preview, shareable design links (`?t=...&f=...`).

Rebuild after editing `src/`:

    python3 src/build.py
