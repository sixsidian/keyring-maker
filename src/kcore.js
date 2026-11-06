// Keyring geometry core: text -> 2D regions -> watertight meshes -> 3MF / STL.
// Works in the browser (globals) and in Node (require) for testing.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.KCore = factory;
})(this, function (ClipperLib, earcut, fflate) {
  const S = 1000; // clipper integer units per mm
  const SPEC = { border: 1.6, close: 2.0, base: 2.4, raised: 0.6, loopWall: 2.1, loopR: 4.2, holeR: 2.1, loopClose: 1.0, inlayInset: 0.4, bridgeH: 3.0 };
  const CT = ClipperLib.ClipType, PT = ClipperLib.PolyType, PFT = ClipperLib.PolyFillType;

  // ---------- path helpers ----------
  function flattenCommands(cmds, tol) {
    // opentype path commands (y down) -> array of closed point rings (y up), in mm
    const rings = []; let ring = null, cx = 0, cy = 0, sx = 0, sy = 0;
    const push = (x, y) => ring.push([x, -y]);
    for (const c of cmds) {
      if (c.type === 'M') { if (ring && ring.length > 2) rings.push(ring); ring = []; cx = sx = c.x; cy = sy = c.y; push(cx, cy); }
      else if (c.type === 'L') { cx = c.x; cy = c.y; push(cx, cy); }
      else if (c.type === 'Q') {
        const n = Math.max(2, Math.ceil(Math.hypot(c.x1 - cx, c.y1 - cy, c.x - c.x1, c.y - c.y1) / tol));
        for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y); }
        cx = c.x; cy = c.y;
      } else if (c.type === 'C') {
        const len = Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
        const n = Math.max(2, Math.ceil(len / tol));
        for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t;
          push(u*u*u*cx + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x, u*u*u*cy + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y); }
        cx = c.x; cy = c.y;
      } else if (c.type === 'Z') { if (ring && ring.length > 2) rings.push(ring); ring = null; cx = sx; cy = sy; }
    }
    if (ring && ring.length > 2) rings.push(ring);
    return rings;
  }
  const toClip = rings => rings.map(r => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
  const translate = (paths, dx, dy) => paths.map(p => p.map(q => ({ X: q.X + Math.round(dx * S), Y: q.Y + Math.round(dy * S) })));

  function boolOp(type, subj, clip, fill) {
    const c = new ClipperLib.Clipper(); const out = [];
    c.AddPaths(subj, PT.ptSubject, true); if (clip && clip.length) c.AddPaths(clip, PT.ptClip, true);
    c.Execute(type, out, fill ?? PFT.pftNonZero, fill ?? PFT.pftNonZero); return out;
  }
  const union = (a, b, fill) => boolOp(CT.ctUnion, a.concat(b || []), null, fill);
  const diff = (a, b) => boolOp(CT.ctDifference, a, b);
  const inter = (a, b) => boolOp(CT.ctIntersection, a, b);
  function offset(paths, mm) {
    if (!paths.length) return [];
    const o = new ClipperLib.ClipperOffset(2, 0.01 * S); const out = [];
    o.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon); o.Execute(out, mm * S); return out;
  }
  function circle(cx, cy, r, n = 96) { const p = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; p.push({ X: Math.round((cx + r * Math.cos(a)) * S), Y: Math.round((cy + r * Math.sin(a)) * S) }); } return [p]; }
  const rect = (x0, y0, x1, y1) => [[{ X: x0*S|0, Y: y0*S|0 }, { X: x1*S|0, Y: y0*S|0 }, { X: x1*S|0, Y: y1*S|0 }, { X: x0*S|0, Y: y1*S|0 }]];
  function bounds(paths) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of paths) for (const q of p) { if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X; if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y; }
    return { x0: x0 / S, y0: y0 / S, x1: x1 / S, y1: y1 / S };
  }
  const clean = paths => ClipperLib.Clipper.CleanPolygons(paths, 0.005 * S).filter(p => p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > 0.01 * S * S);
  const area = paths => paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (S * S);
  const outerCount = paths => paths.filter(p => ClipperLib.Clipper.Area(p) > 0).length;

  function minDist(a, b) { // a,b: arrays of [x,y]
    let best = Infinity;
    for (const p of a) for (const q of b) { const d = (p[0]-q[0])**2 + (p[1]-q[1])**2; if (d < best) best = d; }
    return Math.sqrt(best);
  }

  // ---------- text layout ----------
  function capHeightUnits(font) {
    const g = font.charToGlyph('H'); const bb = g.getBoundingBox();
    return (bb && bb.y2 > 0) ? bb.y2 : font.unitsPerEm * 0.7;
  }
  function layoutText(font, text, capMM, tighten) {
    const fontSize = capMM * font.unitsPerEm / capHeightUnits(font); // mm per em
    const tol = fontSize * 0.004;
    const glyphs = [];
    let i = 0;
    font.forEachGlyph(text, 0, 0, fontSize, { kerning: true }, function (glyph, gx, gy, gs) {
      const rings = flattenCommands(glyph.getPath(gx, gy, gs).commands, tol);
      glyphs.push({ ch: text[i] ?? '', rings, dx: 0 }); i++;
    });
    if (tighten) {
      const target = fontSize * 0.05; let shift = 0; let recent = [];
      const sample = (pts, max) => { const step = Math.max(1, Math.ceil(pts.length / max)); return pts.filter((_, i) => i % step === 0); };
      for (let k = 0; k < glyphs.length; k++) {
        const g = glyphs[k]; g.dx = shift;
        if (!g.rings.length) { recent = []; continue; }
        const prev = glyphs[k - 1];
        const sep = !prev || /\s/.test(prev.ch) || /\s/.test(g.ch);
        const base = sample(g.rings.flat(), 400);
        const pts = () => base.map(([x, y]) => [x + g.dx, y]);
        if (!sep && recent.length) {
          const placed = recent.flat();
          for (let it = 0; it < 12; it++) {
            const d = minDist(pts(), placed);
            if (d <= target * 1.05) break;
            g.dx -= (d - target); shift = g.dx;
          }
        }
        recent.push(pts()); if (recent.length > 2) recent.shift();
      }
    }
    let paths = [];
    for (const g of glyphs) paths = paths.concat(translate(toClip(g.rings), g.dx, 0));
    return union(paths, [], PFT.pftNonZero);
  }

  // ---------- 2D design ----------
  function design(font, text, o) {
    o = Object.assign({ cap: 9, tight: true, border: SPEC.border, loop: 'left', hole: SPEC.holeR * 2 }, o || {});
    const T = layoutText(font, text, o.cap, o.tight);
    if (!T.length) return null;
    const tb = bounds(T);
    let body = offset(T, o.border);
    body = offset(offset(body, SPEC.close), -SPEC.close);
    // gold bridge so separate words stay joined in one piece
    const midY = (tb.y0 + tb.y1) / 2;
    body = union(body, rect(tb.x0, midY - SPEC.bridgeH / 2, tb.x1, midY + SPEC.bridgeH / 2));
    const bb = bounds(body);
    const holeR = o.hole / 2, loopR = holeR + SPEC.loopWall;
    let cx = null, cy = null;
    if (o.loop === 'left') { cx = bb.x0 - 1.0; cy = (bb.y0 + bb.y1) / 2; }
    else if (o.loop === 'right') { cx = bb.x1 + 1.0; cy = (bb.y0 + bb.y1) / 2; }
    else if (o.loop === 'top') { cx = (bb.x0 + bb.x1) / 2; cy = bb.y1 + 1.0; }
    if (cx !== null) {
      body = union(body, circle(cx, cy, loopR));
      body = offset(offset(body, SPEC.loopClose), -SPEC.loopClose);
      body = diff(body, circle(cx, cy, holeR));
    }
    const separate = p => clean(offset(offset(p, -0.01), 0.01)); // split zero-width contacts so meshes stay watertight
    body = separate(clean(body));
    const inlay = separate(clean(inter(T, offset(body, -SPEC.inlayInset))));
    const b = bounds(body);
    // thin-stroke check: parts of the lettering under 0.8mm wide
    // thin-stroke check: a lettering piece that vanishes when eroded 0.4mm has strokes under 0.8mm
    let thin = 0; const tree = polyTreeOf(inlay);
    const visit = node => { for (const ch of node.Childs()) { if (!ch.IsHole()) {
      const piece = [ch.Contour(), ...ch.Childs().map(h => h.Contour())];
      if (!offset(piece, -0.4).length) thin++;
      for (const h of ch.Childs()) visit(h); } } };
    visit(tree);
    return { body, inlay, bounds: b, width: b.x1 - b.x0, height: b.y1 - b.y0, pieces: outerCount(body), thinArea: thin, loop: cx === null ? null : { cx, cy }, opts: o };
  }

  function polyTreeOf(paths) {
    const c = new ClipperLib.Clipper(); const pt = new ClipperLib.PolyTree();
    c.AddPaths(paths, PT.ptSubject, true); c.Execute(CT.ctUnion, pt, PFT.pftNonZero, PFT.pftNonZero); return pt;
  }

  // ---------- meshing ----------
  // Rings stay in clipper integer units so shared edges match exactly; vertices are de-duplicated by position.
  function pointInRing(x, y, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i].X, yi = r[i].Y, xj = r[j].X, yj = r[j].Y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].X * r[i].Y - r[i].X * r[j].Y; return a / 2; };
  // Group a set of non-crossing rings into filled regions by nesting depth (even depth = solid, odd = hole).
  function groups(rings) {
    const rs = rings.map(r => ({ r, depth: 0, parent: -1, area: Math.abs(ringArea(r)) }));
    rs.forEach((a, i) => {
      // test a point just inside the edge midpoint is unreliable; use a vertex (rings never share vertices here)
      const p = a.r[0];
      let best = -1;
      rs.forEach((b, j) => { if (i !== j && b.area > a.area && pointInRing(p.X + 0.5, p.Y + 0.25, b.r)) { a.depth++; if (best < 0 || b.area < rs[best].area) best = j; } });
      a.parent = best;
    });
    const out = [];
    rs.forEach((a, i) => { if (a.depth % 2 === 0) out.push({ outer: a.r, holes: rs.filter(h => h.parent === i && h.depth % 2 === 1).map(h => h.r) }); });
    for (const g of out) {
      if (ringArea(g.outer) < 0) g.outer = g.outer.slice().reverse();
      g.holes = g.holes.map(h => ringArea(h) > 0 ? h.slice().reverse() : h);
    }
    return out;
  }
  function MeshBuilder(off) {
    const V = [], F = [], map = new Map();
    const vid = (q, z) => {
      const key = q.X + ',' + q.Y + ',' + Math.round(z * 1e5);
      let i = map.get(key);
      if (i === undefined) { i = V.length / 3; V.push(q.X / S - off[0], q.Y / S - off[1], z); map.set(key, i); }
      return i;
    };
    return {
      cap(rings, z, up) { // rings: any set of nested rings; fills by depth parity
        for (const g of groups(rings)) {
          const all = [g.outer, ...g.holes], flat = [], holeIdx = [], ids = [];
          for (const r of all) { if (r !== g.outer) holeIdx.push(ids.length); for (const q of r) { flat.push(q.X, q.Y); ids.push(vid(q, z)); } }
          const tri = earcut(flat, holeIdx, 2);
          for (let t = 0; t < tri.length; t += 3) {
            let [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
            const cr = (flat[2*b]-flat[2*a])*(flat[2*c+1]-flat[2*a+1]) - (flat[2*b+1]-flat[2*a+1])*(flat[2*c]-flat[2*a]);
            if ((cr < 0) === up) [b, c] = [c, b];
            F.push(ids[a], ids[b], ids[c]);
          }
        }
      },
      walls(rings, z0, z1, inward) { // outward-facing side walls of the solid region, or facing into a pocket
        for (const g of groups(rings)) for (const r of [g.outer, ...g.holes]) {
          for (let i = 0; i < r.length; i++) {
            const p = r[i], q = r[(i + 1) % r.length];
            const a0 = vid(p, z0), b0 = vid(q, z0), a1 = vid(p, z1), b1 = vid(q, z1);
            if (!inward) { F.push(a0, b0, b1); F.push(a0, b1, a1); } else { F.push(a0, b1, b0); F.push(a0, a1, b1); }
          }
        }
      },
      done() { return { V: new Float32Array(V), F: new Uint32Array(F) }; },
    };
  }
  // style 'raised': lettering stands on top of the base. 'flush': lettering sits in a pocket, top surface level.
  function meshes(d, o) {
    o = Object.assign({ base: SPEC.base, layer: SPEC.raised, style: 'raised' }, o || {});
    const off = [(d.bounds.x0 + d.bounds.x1) / 2, (d.bounds.y0 + d.bounds.y1) / 2];
    const g = MeshBuilder(off), t = MeshBuilder(off);
    const top = o.base + o.layer;
    if (o.style === 'flush') {
      const floor = top - o.layer, pocket = Math.max(0.2, floor);
      g.cap(d.body, 0, false); g.walls(d.body, 0, top, false);
      g.cap(d.body.concat(d.inlay), top, true);          // top surface with lettering-shaped openings
      g.walls(d.inlay, pocket, top, true); g.cap(d.inlay, pocket, true); // pocket sides and floor
      t.cap(d.inlay, pocket, false); t.walls(d.inlay, pocket, top, false); t.cap(d.inlay, top, true);
    } else {
      g.cap(d.body, 0, false); g.walls(d.body, 0, o.base, false); g.cap(d.body, o.base, true);
      t.cap(d.inlay, o.base, false); t.walls(d.inlay, o.base, top, false); t.cap(d.inlay, top, true);
    }
    return [
      { name: 'Base', mesh: g.done(), slot: 1 },
      { name: 'Lettering', mesh: t.done(), slot: 2 },
    ];
  }

  // One solid block (base and lettering together) for single-colour .stl output in flush style
  function solid(d, o) {
    o = Object.assign({ base: SPEC.base, layer: SPEC.raised }, o || {});
    const off = [(d.bounds.x0 + d.bounds.x1) / 2, (d.bounds.y0 + d.bounds.y1) / 2], m = MeshBuilder(off), top = o.base + o.layer;
    m.cap(d.body, 0, false); m.walls(d.body, 0, top, false); m.cap(d.body, top, true);
    return m.done();
  }

  // ---------- file writers ----------
  function stl(mesh) {
    const nt = mesh.F.length / 3, buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf);
    dv.setUint32(80, nt, true); let o = 84; const V = mesh.V, F = mesh.F;
    for (let t = 0; t < nt; t++) {
      const a = F[3*t]*3, b = F[3*t+1]*3, c = F[3*t+2]*3;
      const ux = V[b]-V[a], uy = V[b+1]-V[a+1], uz = V[b+2]-V[a+2], vx = V[c]-V[a], vy = V[c+1]-V[a+1], vz = V[c+2]-V[a+2];
      let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx; const l = Math.hypot(nx, ny, nz) || 1;
      for (const v of [nx/l, ny/l, nz/l]) { dv.setFloat32(o, v, true); o += 4; }
      for (const i of [a, b, c]) for (let j = 0; j < 3; j++) { dv.setFloat32(o, V[i+j], true); o += 4; }
      o += 2;
    }
    return new Uint8Array(buf);
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  function threeMF(parts, name) {
    const objs = parts.map((p, i) => {
      const V = p.mesh.V, F = p.mesh.F; let v = '', t = '';
      for (let k = 0; k < V.length; k += 3) v += `<vertex x="${V[k].toFixed(4)}" y="${V[k+1].toFixed(4)}" z="${V[k+2].toFixed(4)}"/>`;
      for (let k = 0; k < F.length; k += 3) t += `<triangle v1="${F[k]}" v2="${F[k+1]}" v3="${F[k+2]}"/>`;
      return `<object id="${i+1}" name="${esc(p.name)}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    }).join('');
    const oid = parts.length + 1;
    const comp = parts.map((_, i) => `<component objectid="${i+1}"/>`).join('');
    const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objs}<object id="${oid}" name="${esc(name)}" type="model"><components>${comp}</components></object></resources><build><item objectid="${oid}"/></build></model>`;
    const ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    let cfg = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${oid}">\n    <metadata key="name" value="${esc(name)}"/>\n    <metadata key="extruder" value="1"/>\n`;
    parts.forEach((p, i) => { cfg += `    <part id="${i+1}" subtype="normal_part">\n      <metadata key="name" value="${esc(p.name)}"/>\n      <metadata key="extruder" value="${p.slot}"/>\n    </part>\n`; });
    cfg += '  </object>\n</config>\n';
    const u = fflate.strToU8;
    return fflate.zipSync({ '[Content_Types].xml': u(ct), '_rels/.rels': u(rels), '3D/3dmodel.model': u(model), 'Metadata/model_settings.config': u(cfg) }, { level: 6 });
  }

  // SVG path data for preview (evenodd)
  function svgPath(paths, flipY) {
    return paths.map(p => 'M' + p.map(q => (q.X / S).toFixed(3) + ' ' + (flipY - q.Y / S).toFixed(3)).join('L') + 'Z').join('');
  }

  return { SPEC, design, meshes, solid, stl, threeMF, svgPath };
});
