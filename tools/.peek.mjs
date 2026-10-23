import { open } from 'shapefile';
const src = await open(process.argv[2]);
let n = 0;
for (;;) { const r = await src.read(); if (r.done || n >= 3) break; n++; console.log(JSON.stringify(r.value.properties), r.value.geometry.type, JSON.stringify(r.value.geometry.coordinates).slice(0, 200)); }
