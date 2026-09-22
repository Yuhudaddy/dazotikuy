/** Integration checks for the shipped GLB, both languages, and picking coordinates. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fitModelBounds, formatBom, parseBomField, pickModelLabel, roomLabel, stageLabels } from "../src/lib/model3d-layout.ts";

const root = new URL("../public/tots-model/v2/", import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, root), "utf8"));
const layout = await json("layout-20260921d.json");
const manifest = await json("manifest-20260921d.json");
const binary = await readFile(new URL(manifest.model, root));
assert.equal(createHash("sha256").update(binary).digest("hex"), manifest.sha256);
assert.equal(binary.length, manifest.bytes);
const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
for (const name of ["TOTS2_wall", "TOTS2_wall_dark", "TOTS2_青色結界"]) {
  assert(gltf.materials.some(material => material.name === name), `Missing transparency material: ${name}`);
}
// Coordinates typed from the sheet (BOM) must land on the model: every floor's locator node
// inside the GLB sits exactly at layout center = BOM * 0.01, in the declared axis order.
assert.equal(manifest.coordinateSystem, "glTF=(BOM.x,BOM.y,BOM.z)*0.01");
const locators = new Map(gltf.nodes.filter(n => n.name?.endsWith("__中心")).map(n => [n.name, n.translation]));
assert.equal(locators.size, 51);
for (const room of layout.rooms) {
  const node = locators.get(`${stageLabels.zh[room.stage]}${room.floor}F__中心`);
  assert(node, `${room.id}: no locator node in GLB`);
  node.forEach((n, i) => assert(Math.abs(n - room.center[i]) < 1e-4, `${room.id}: GLB ${node} != layout ${room.center}`));
}
assert.equal(layout.rooms.length, 51);
assert.equal(new Set(layout.rooms.map(r => r.id)).size, 51);
assert.deepEqual(["beginner", "middle", "final"].map(stage => layout.rooms.filter(r => r.stage === stage).length), [12, 16, 23]);
for (const room of layout.rooms) {
  assert.equal(room.center[1], 3);
  if (room.shape === "square") assert.equal(room.height, 1, `${room.id}: square height must not scale with width`);
  for (const lang of ["zh", "ja"]) {
    assert.equal(pickModelLabel(layout, room.center, lang), roomLabel(room, lang));
    assert.equal(pickModelLabel(layout, [room.center[0], 5, room.center[2]], lang), null);
  }
}
assert.equal(layout.rooms.find(r => r.id === "beginner-11").width, 2);
assert.equal(layout.rooms.find(r => r.id === "middle-4").width, 1);
assert.equal(layout.rooms.find(r => r.id === "final-4").width, 1.5);
assert.equal(pickModelLabel(layout, [-35.4513, 10, 4.7531], "ja"), "黒い塔");
assert.equal(pickModelLabel(layout, [4.25, -1.5, -21.6], "zh"), "粉色花瓣海");
assert.equal(pickModelLabel(layout, [-48, 2.3, -34.8], "ja"), "中位 1F 北西のオアシス");
assert.equal(pickModelLabel(layout, [0, 0, 0], "zh"), null);
// Typed coordinates: BOM in, glTF out (x, y, z) * 0.01; a blank field is null, junk is undefined.
assert.equal(parseBomField("-4200"), -42);
assert.equal(parseBomField(" −538.19 "), -5.3819);
assert.equal(parseBomField(""), null);
assert.equal(parseBomField("   "), null);
for (const bad of ["abc", "1 2", "-4200,", "３００"]) assert.equal(parseBomField(bad), undefined, JSON.stringify(bad));
assert.equal(formatBom([-42, 3.916, -26.644]), "BOM (-4200, 392, -2664)");
assert.equal(formatBom([0.004, -0.004, 0]), "BOM (0, 0, 0)");
assert(layout.resetBounds.min[0] <= -50.5 && layout.resetBounds.min[2] <= -40.5);
assert(layout.resetBounds.max[0] >= -20 && layout.resetBounds.max[2] >= 16.34);
// Project the reset rectangle at its closest elevation into desktop and phone frames.
for (const aspect of [16 / 9, 4 / 3, 3 / 4, 9 / 16]) {
  for (const fov of [12, 30, 60]) {
    const { orbit, target } = fitModelBounds(layout.resetBounds, aspect, fov);
    assert(orbit.startsWith("0deg 0deg "), "Reset must be north-up and overhead");
    const distance = parseFloat(orbit.split(" ")[2]);
    const center = target.split(" ").map(parseFloat);
    const nearestDepth = distance - (layout.resetBounds.max[1] - center[1]);
    const halfHeight = nearestDepth * Math.tan(fov * Math.PI / 360);
    const halfWidth = halfHeight * aspect;
    for (const corner of [layout.resetBounds.min, layout.resetBounds.max]) {
      assert(Math.abs(corner[0] - center[0]) < halfWidth);
      assert(Math.abs(corner[2] - center[2]) < halfHeight);
    }
  }
}
for (const [path, language, menu] of [["types/botw-08", "zh", "地圖功能選單"], ["ja/types/botw-08", "ja", "マップ操作メニュー"]]) {
  const html = await readFile(new URL(`../dist/${path}/index.html`, import.meta.url), "utf8");
  assert(html.includes(`/tots-model/v2/${manifest.model}`));
  assert(html.includes(`data-lang="${language}"`));
  assert(html.includes(menu));
  assert(!html.includes("/tots-model/model/tots-model.glb"));
  assert(!html.includes("右上角圓形按鈕") && !html.includes("右上の丸ボタン"));
}
console.log("ToTS integration verified: shipped GLB hash/materials, 51 locator nodes match layout, bilingual picking, 12 responsive top-view frames, both built pages.");
