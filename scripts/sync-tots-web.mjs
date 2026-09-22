/** Copy the reviewed, optimized Blender export and derive a small picking layout.
 * Usage: npm run tots:sync [-- rebuild directory]
 * Run only when accepting a new model revision; the site build uses committed assets.
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { bomToGltf, stageLabels } from "../src/lib/model3d-layout.ts";

const source = resolve(process.argv[2] ?? "blender-tots/rebuild-v2");
const target = resolve("public/tots-model/v2");
const original = JSON.parse(await readFile(resolve(source, "layout-v2.json"), "utf8"));
const sheet = JSON.parse(await readFile(resolve(source, "source-sheet.json"), "utf8"));
const version = original.revision.split(" ")[0].replaceAll("-", "");
const scale = values => values.map(bomToGltf);
const stage = Object.fromEntries(Object.entries(stageLabels.zh).map(([id, zh]) => [zh, id]));
const terrain = original.terrain_estimates;
const plateau = terrain.plateau_bounds_east_north;
const sea = terrain.sea_bounds_east_north;
const rim = original.tower_basin.rim_BOM_xz;
const tower = original.tower;
const landmarks = [{
  label: { zh: "黑塔", ja: "黒い塔" }, center: scale(tower.bom_base_center),
  radius: tower.diameter / 200, bottom: tower.bom_base_center[1] / 100 - 0.05,
  top: tower.top_altitude / 100 + 0.1,
}];
for (const row of sheet.values.filter(r => r[1]?.includes("綠洲"))) {
  landmarks.push({ label: { zh: row[0] + row[1], ja: row[1].startsWith("1F") ? "中位 1F 北西のオアシス" : "中位 16F 西のオアシス" },
    center: scale(row.slice(2, 5)), radius: 0.72, bottom: 2.15, top: 3.3 });
}
for (const row of sheet.values.filter(r => r[1]?.includes("7F東側盆地"))) {
  landmarks.push({ label: { zh: row[0] + row[1], ja: `序位 7F 東の盆地 ${row[1].slice(-1)}` },
    center: scale(row.slice(2, 5)), radius: row[6] / 200, bottom: 2.4, top: 3.1 });
}
for (const [index, flora] of original.flora.entries()) {
  landmarks.push({ label: index === 0 ? { zh: "粉色花瓣海", ja: "ピンクの花びら" } : { zh: "黃色草花叢", ja: "黄色い草花" },
    center: scale(flora.center_BOM), radius: flora.diameter_BOM / 200, bottom: -1.55, top: -1.4 });
}
const layout = {
  version: 2, revision: original.revision,
  resetBounds: {
    min: scale([Math.min(plateau[0], ...rim.map(p => p[0])), tower.bom_base_center[1], -plateau[3]]),
    max: scale([Math.max(plateau[2], ...rim.map(p => p[0])), tower.top_altitude, Math.max(...rim.map(p => p[1]))]),
  },
  overviewBounds: { min: scale([sea[0], tower.bom_base_center[1], -sea[3]]), max: scale([sea[2], tower.top_altitude, -sea[1]]) },
  rooms: original.rooms.map(room => ({
    id: `${stage[room.stage]}-${room.floor}`, stage: stage[room.stage], floor: room.floor,
    center: scale(room.bom_center), width: room.size_BOM / 100, height: room.height_BOM / 100,
    shape: room.shape === "方形六面體" ? "square" : "circle", floating: room.suspended_underside_BOM != null,
  })), landmarks,
};
await mkdir(target, { recursive: true });
const binary = await readFile(resolve(source, "tots-web-v2.glb"));
await copyFile(resolve(source, "tots-web-v2.glb"), resolve(target, `tots-${version}.glb`));
await writeFile(resolve(target, `layout-${version}.json`), JSON.stringify(layout, null, 2) + "\n");
await writeFile(resolve(target, `manifest-${version}.json`), JSON.stringify({
  revision: original.revision, model: `tots-${version}.glb`, bytes: binary.length,
  sha256: createHash("sha256").update(binary).digest("hex"), rooms: layout.rooms.length,
  coordinateSystem: "glTF=(BOM.x,BOM.y,BOM.z)*0.01",
}, null, 2) + "\n");
console.log(`Synced ${version}: ${layout.rooms.length} floors, ${binary.length} bytes.`);
