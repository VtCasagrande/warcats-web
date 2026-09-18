import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import catalog from '../shared/model-assets.json';
import { MAPS } from '../shared/maps';
import { segmentBox } from '../shared/physics';

const root = new URL('../public/', import.meta.url);
function readModel(id: keyof typeof catalog) {
  const bytes = readFileSync(new URL(catalog[id].url.slice(1), root));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  return { bytes, gltf };
}

test('all 13 gameplay assets have bounded atlases, valid indices and actual textured geometry', () => {
  assert.equal(Object.keys(catalog).length, 13);
  let total = 0;
  for (const id of Object.keys(catalog) as (keyof typeof catalog)[]) {
    const { bytes, gltf } = readModel(id); total += bytes.length;
    assert.equal(bytes.length, catalog[id].bytes); assert.ok(catalog[id].atlasSize <= 1024);
    assert.ok(gltf.images[0].bufferView >= 0);
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      const positions = gltf.accessors[primitive.attributes.POSITION], normals = gltf.accessors[primitive.attributes.NORMAL], uv = gltf.accessors[primitive.attributes.TEXCOORD_0];
      assert.equal(normals.count, positions.count); assert.equal(uv.count, positions.count);
      assert.ok(positions.min.every(Number.isFinite) && positions.max.every(Number.isFinite));
      const indices = gltf.accessors[primitive.indices], view = gltf.bufferViews[indices.bufferView];
      assert.equal(indices.componentType, 5123); assert.equal(indices.count % 3, 0);
      const start = 28 + bytes.readUInt32LE(12) + view.byteOffset;
      for (let i = 0; i < indices.count; i++) assert.ok(bytes.readUInt16LE(start + i * 2) < positions.count, `${id}: invalid index`);
    }
  }
  assert.ok(total < 6 * 1024 * 1024, `Gameplay GLBs use ${total} bytes`);
});

test('jeep axle pivots separate all four complete tires from the fixed body', () => {
  const { gltf } = readModel('jeep');
  const wheels = gltf.nodes.filter((node: { name: string }) => node.name.startsWith('wheel-'));
  assert.equal(wheels.length, 4);
  for (const wheel of wheels) {
    const positions = gltf.accessors[gltf.meshes[wheel.mesh].primitives[0].attributes.POSITION];
    assert.ok(positions.count > 500); assert.ok(Math.abs(wheel.translation[0]) > .8);
    assert.ok(wheel.translation[1] > .4 && wheel.translation[1] < .6);
    assert.equal(wheel.name.endsWith('front'), wheel.translation[2] < 0);
    assert.ok(positions.max[1] - positions.min[1] > .95);
  }
});

test('helicopter has distinct rotor meshes above the cabin and at the tail', () => {
  const { gltf } = readModel('helicopter');
  const main = gltf.nodes.find((n: { name: string }) => n.name === 'rotor'), tail = gltf.nodes.find((n: { name: string }) => n.name === 'tail-rotor');
  assert.ok(main && tail); assert.notEqual(main.mesh, tail.mesh);
  assert.ok(main.translation[1] > 3.5 && Math.abs(main.translation[0]) < .1);
  assert.ok(tail.translation[2] > 6 && Math.abs(tail.translation[0]) > .5);
});

test('all maps place all five scenario models with matching solid, unobstructed bounds', () => {
  for (const map of MAPS) {
    assert.equal(map.props.length, 15, map.id);
    assert.equal(new Set(map.props.map(prop => prop.asset)).size, 5);
    for (const prop of map.props) {
      const box = map.boxes.find(box => box.id === prop.id)!; assert.ok(box);
      const size = catalog[prop.asset].size;
      assert.ok(Math.abs(box.h - size[1]) < 1e-6);
      assert.ok(Math.abs(box.w - size[prop.yaw ? 2 : 0]) < 1e-6);
      assert.ok(map.spawns.every(spawn => Math.hypot(prop.x - spawn.x, prop.z - spawn.z) >= 38));
      assert.ok(!map.boxes.some(other => other.id !== box.id && Math.abs(box.x - other.x) < (box.w + other.w) / 2 && Math.abs(box.z - other.z) < (box.d + other.d) / 2));
      assert.notEqual(segmentBox({ x: box.x - box.w, y: box.y, z: box.z }, { x: box.x + box.w, y: box.y, z: box.z }, box), null);
    }
  }
});
