// Prepare the original Magnific/Tripo meshes for gameplay. Never overwrite the originals.
// Spatial cuts preserve the texture atlas and put independently moving pieces on real pivots.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const base = new URL('../', import.meta.url).pathname;
const output = path.join(base, 'public/assets/models/warcats');
await mkdir(output, { recursive: true });
const definitions = {
  ar: { scale: .94, flip: true, bore: .068, centerX: .010, gripZ: -.235, rail: .115, support: .17 },
  ak: { scale: .94, bore: .077, centerX: -.010, gripZ: .205, rail: .133, support: -.13 },
  m40: { scale: 1.18, bore: .017, centerX: -.010, gripZ: .24, rail: .036, support: -.045 },
  awm: { scale: 1.30, bore: .025, centerX: -.010, gripZ: .255, rail: .043, support: -.015 },
  pistol: { scale: .27, bore: .223, centerX: -.002, gripZ: .33, rail: .274, support: .27 },
  shotgun: { scale: 1.02, bore: .081, centerX: -.010, gripZ: .185, rail: .096, support: -.20 },
  jeep: { scale: 4.1, flip: true },
  helicopter: { scale: 12.2, flip: true, offsetZ: .6, centerX: .0195 },
  crate: { scale: .88 }, fuel: { scale: 1.1 }, generator: { scale: 1.3 }, radar: { scale: 2.5 },
  truck: { scale: 7.2, rotate: true },
};
const manifest = {};
for (const [id, def] of Object.entries(definitions)) {
  const bytes = await readFile(path.join(base, `public/assets/magnific/expansion/models/${id}.glb`));
  const jsonLength = bytes.readUInt32LE(12), original = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength), primitive = original.meshes[0].primitives[0];
  function accessor(index) {
    const a = original.accessors[index], view = original.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    const slice = binary.subarray((view.byteOffset ?? 0) + (a.byteOffset ?? 0), (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * size * ctor.BYTES_PER_ELEMENT);
    return new ctor(Uint8Array.from(slice).buffer);
  }
  const pos = accessor(primitive.attributes.POSITION), normals = accessor(primitive.attributes.NORMAL), uv = accessor(primitive.attributes.TEXCOORD_0), indices = accessor(primitive.indices);
  const minY = original.accessors[primitive.attributes.POSITION].min[1];
  const gun = 'bore' in def, sign = def.flip ? -1 : 1;
  const offsetZ = gun ? .05 - def.gripZ * def.scale * sign : def.offsetZ ?? 0;
  function transform(x, y, z, normal = false) {
    if (def.rotate) [x, z] = [z, -x];
    if (normal) return [x * sign, y, z * sign];
    return [(x - (def.centerX ?? 0)) * sign * def.scale, gun ? (y - def.bore) * def.scale + .018 : (y - minY) * def.scale, z * sign * def.scale + offsetZ];
  }
  const parts = new Map();
  // Reconnect UV seams first. The generated tire shells are disconnected components,
  // so they can be articulated intact without cutting holes into a tire or its fender.
  const parent = Array.from({ length: pos.length / 3 }, (_, i) => i), welded = new Map();
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < parent.length; i++) { const key = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`; if (welded.has(key)) join(i, welded.get(key)); else welded.set(key, i); }
  for (let i = 0; i < indices.length; i += 3) { join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]); }
  const components = new Map();
  for (let i = 0; i < parent.length; i++) {
    const key = find(i); if (!components.has(key)) components.set(key, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const b = components.get(key); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], pos[i * 3 + k]); b.max[k] = Math.max(b.max[k], pos[i * 3 + k]); }
  }
  const componentParts = new Map();
  for (const [key, b] of components) {
    const [x, y, z] = b.min.map((v, k) => (v + b.max[k]) / 2);
    if (id === 'jeep' && (b.min[0] > .17 || b.max[0] < -.17) && b.max[1] < .006 && b.max[2] - b.min[2] < .29) {
      const axle = z > .08 ? .324 : -.286;
      if (Math.hypot(y + .128, z - axle) < .14) componentParts.set(key, `wheel-${x < 0 ? 'right' : 'left'}-${z > .08 ? 'front' : 'rear'}`);
    }
    if (id === 'helicopter' && b.max[2] < -.44 && b.min[1] > -.06 && b.max[1] < .10 && b.max[0] - b.min[0] > .01) componentParts.set(key, 'tail-rotor');
  }
  function classify(x, y, z) {
    if (id === 'helicopter') {
      if (y > .13 && z > -.425) return 'rotor';
    } else if (gun) {
      if ((id === 'm40' || id === 'awm') && y > def.rail && z > -.17 && z < .34) return null;
      if (id === 'ar' && y > .115 || id === 'ak' && y > .135 || id === 'pistol' && y > .274 || id === 'shotgun' && y > .096) return null;
      if (id === 'ar' && y < .012 && z > -.13 && z < .12 || id === 'ak' && y < .045 && z > -.16 && z < .065 || id === 'pistol' && y < -.21 || (id === 'm40' || id === 'awm') && y < -.027 && z > -.03 && z < .115) return 'magazine';
      if ((id === 'm40' || id === 'awm') && x > .023 && z > .16 && z < .29) return 'bolt';
      if (id === 'pistol') return y < .12 && z > .18 ? 'furniture' : 'body';
      if (id === 'ar') return z < -.30 || z > .07 && z < .31 && y < .113 || z < -.20 && y < .015 ? 'furniture' : 'body';
      if (id === 'ak') return z > .20 || z < -.06 && z > -.23 && y < .135 || z > .08 && y < .06 ? 'furniture' : 'body';
      return z > .30 || y < (id === 'shotgun' ? .071 : .015) && z > -.17 ? 'furniture' : 'body';
    }
    return 'body';
  }
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i], indices[i + 1], indices[i + 2]];
    const center = [0, 1, 2].map(k => triangle.reduce((sum, v) => sum + pos[v * 3 + k] / 3, 0));
    const key = componentParts.get(find(triangle[0])) ?? classify(...center); if (!key) continue;
    if (!parts.has(key)) parts.set(key, []); parts.get(key).push(...triangle);
  }
  const gltf = { asset: { version: '2.0', generator: 'WAR CATS asset preparation' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], materials: [], textures: original.textures, samplers: original.samplers, images: [] };
  const chunks = []; let length = 0;
  function view(array, target) {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); const pad = (4 - bytes.length % 4) % 4; if (pad) chunks.push(Buffer.alloc(pad)); length += bytes.length + pad; return index;
  }
  function attr(values, type, position = false) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type], a = { bufferView: view(values, type === 'SCALAR' ? 34963 : 34962), componentType: values instanceof Uint16Array ? 5123 : values instanceof Uint32Array ? 5125 : 5126, count: values.length / size, type };
    if (position) { a.min = [Infinity, Infinity, Infinity]; a.max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < values.length; i++) { const k = i % 3; a.min[k] = Math.min(a.min[k], values[i]); a.max[k] = Math.max(a.max[k], values[i]); } }
    gltf.accessors.push(a); return gltf.accessors.length - 1;
  }
  const material = structuredClone(original.materials[0]); material.name = 'original-atlas'; material.doubleSided = false;
  gltf.materials.push(material, { ...structuredClone(material), name: 'paintable-furniture', extras: { skinPanel: 'weapon' } });
  for (const [name, triangles] of parts) {
    let pivot = [0, 0, 0];
    if (name.startsWith('wheel-')) pivot = transform(name.includes('right') ? -.246 : .246, -.128, name.includes('front') ? .321 : -.286);
    if (name === 'rotor') pivot = transform(.025, .144, -.008);
    if (name === 'tail-rotor') pivot = transform(.073, .025, -.463);
    if (name === 'bolt') pivot = [.04, .028, .045];
    const lookup = new Map(), pp = [], nn = [], uu = [], skinUv = [], ii = [];
    for (const index of triangles) {
      if (!lookup.has(index)) {
        lookup.set(index, lookup.size);
        let rawP = [...pos.subarray(index * 3, index * 3 + 3)], rawN = [...normals.subarray(index * 3, index * 3 + 3)];
        // The AI tail assembly faces backwards. Reorient it onto the transverse tail shaft.
        if (name === 'tail-rotor') { rawP = [.073 + rawP[2] + .472, .025 + rawP[1] - .020, -.463 - rawP[0] + .022]; rawN = [rawN[2], rawN[1], -rawN[0]]; }
        const p = transform(...rawP);
        pp.push(...p.map((v, k) => v - pivot[k])); nn.push(...transform(...rawN, true)); uu.push(uv[index * 2], uv[index * 2 + 1]);
        // Second UV set keeps camouflage at a consistent physical size instead of stretching the atlas.
        const n = nn.slice(-3); skinUv.push((Math.abs(n[0]) > .5 ? p[2] : p[0]) * 3, (Math.abs(n[1]) > .5 ? p[2] : p[1]) * 3);
      }
      ii.push(lookup.get(index));
    }
    const attributes = { POSITION: attr(new Float32Array(pp), 'VEC3', true), NORMAL: attr(new Float32Array(nn), 'VEC3'), TEXCOORD_0: attr(new Float32Array(uu), 'VEC2') };
    if (gun) attributes.TEXCOORD_1 = attr(new Float32Array(skinUv), 'VEC2');
    gltf.meshes.push({ name, primitives: [{ attributes, indices: attr(new Uint16Array(ii), 'SCALAR'), material: name === 'furniture' ? 1 : 0 }] });
    gltf.nodes.push({ name, mesh: gltf.meshes.length - 1, translation: pivot, extras: { assetPart: name } }); gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }
  const atlasSize = gun || id === 'jeep' || id === 'helicopter' ? 1024 : 512;
  for (const image of original.images) {
    const v = original.bufferViews[image.bufferView];
    const atlas = await sharp(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)).resize(atlasSize, atlasSize, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    gltf.images.push({ mimeType: 'image/jpeg', bufferView: view(atlas) });
  }
  gltf.buffers[0].byteLength = length;
  const json = Buffer.from(JSON.stringify(gltf)); const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]), bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonPadded.length + bin.length, 8); header.writeUInt32LE(jsonPadded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  const file = Buffer.concat([header, jsonPadded, binHeader, bin]); await writeFile(path.join(output, `${id}.glb`), file);
  const sourceMin = original.accessors[primitive.attributes.POSITION].min, sourceMax = original.accessors[primitive.attributes.POSITION].max;
  const corners = [transform(...sourceMin), transform(...sourceMax)]; const size = [0, 1, 2].map(k => Math.abs(corners[1][k] - corners[0][k]));
  manifest[id] = { url: `/assets/models/warcats/${id}.glb`, bytes: file.length, atlasSize, size, parts: [...parts.keys()], triangles: [...parts.values()].reduce((n, list) => n + list.length / 3, 0), ...(gun ? { muzzle: - .499023 * def.scale + offsetZ, bore: .018, rail: (def.rail - def.bore) * def.scale + .018, support: def.support * sign * def.scale + offsetZ } : {}) };
  console.log(id, file.length, [...parts].map(([name, t]) => `${name}:${t.length / 3}`).join(' '));
}
await writeFile(path.join(base, 'shared/model-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
