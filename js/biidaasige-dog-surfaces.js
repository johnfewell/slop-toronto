(function () {
// js/biidaasige-dog-surfaces.js
// Biidaasige Park — SOURCE-TRACED DOG SURFACES (bead st-bmyv.5.1, source correction).
// Owns only this file, its fixture, its optional builder, its test and docs/biidaasige-dog-surfaces.md. The Captain
// owns the fixture and every integration/shared module; this file edits none of them.
//
// The two dog off-leash areas are NOT whole-area turf. Current OSM dog-area rings include the surrounding asphalt
// apron; the actual artificial turf is the smaller ring independently identified inside the pale curb on the dedicated
// 2025 City 8 cm ortho exports. This module therefore builds:
//   - the exact current OSM dog-area ring as a matte asphalt underlay at the .224 m ground datum;
//   - the City2026 turf asset ring (independently checked against the aerial photo), projected through C.worldFromLatLon, clipped to the OSM outer ring, as a thin
//     .228 m finish (+.004 m, an explicit Toronto choice) so the two layers never share a coplanar face.
// The turf is clipped with a dependency-free Sutherland-Hodgman pass against the outer triangulation, so a turf
// vertex that falls slightly outside the OSM ring (ortho/OSM registration, ~3 m uncertainty) is trimmed rather than
// expanding the published whole-area boundary. Published 1,200/800 m2 are whole nominal dog-area sizes, never the
// actual turf area. No fence, gate, rectangle, centre point or whole-area turf is invented.
// Rendered triangles are published for the parent footing index; query answers never construct geometry.
// Data source and attribution are in the generated block and docs/biidaasige-dog-surfaces.md.
const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || null;

// >>> DOG_SURFACES_DATA
const DATA = {"schema":"biidaasige-dog-surfaces/1","source":"https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer/34","vintage":"City asset records created April2026, modified May2026, retrieved2026-11-11; independently checked against2025 City orthophoto.","interpretation":"Captain personally overlaid both City polygons on the dedicated2025 8cm City orthophotos; the geometry matches the artificial-turf island edges, not the outer asphalt apron. Asset label is Off Leash Area; physical turf interpretation is supported by that independent visual overlay. No survey accuracy is asserted.","validationSource":"https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer","errorM":3,"traceToleranceM":0.5,"features":[{"id":"dogs-east-1200","nominalWholeAreaM2":1200,"dimensionStatus":"Published whole dog-area size is not the turf-only area.","turfRingLatLon":[[43.64631478886553,-79.34936560608766],[43.64631590233618,-79.34936355801274],[43.64631695271574,-79.34936144811684],[43.64631794902192,-79.34935928877316],[43.64631890025604,-79.34935707995918],[43.646319788431754,-79.34935483411557],[43.64632061353272,-79.34935253884667],[43.646321384576616,-79.34935020652568],[43.64632210156345,-79.34934783715258],[43.64632274650686,-79.34934544316805],[43.646323337393184,-79.34934301213143],[43.64632386523744,-79.34934055646089],[43.646324339057266,-79.34933808852962],[43.64632474081736,-79.34933558359127],[43.64632507955171,-79.3493330664147],[43.646325355260295,-79.34933053699993],[43.64632555892545,-79.34932798297376],[43.64632570859888,-79.34932544147826],[43.64632578622887,-79.34932287537139],[43.646325800865796,-79.34932032181767],[43.646325752476976,-79.3493177560258],[43.64632564109509,-79.34931520278711],[43.64632546670375,-79.34931264970592],[43.64632522031803,-79.34931010920045],[43.64632491095558,-79.34930759364386],[43.64632453858371,-79.3493050782448],[43.64632410323512,-79.34930258779464],[43.646323604909796,-79.34930012229337],[43.64632304360775,-79.34929768174102],[43.6463224283303,-79.3492952661151],[43.64632174109115,-79.34929288785625],[43.64632099987661,-79.34929053452385],[43.64632019571802,-79.3492882309317],[43.646319337584075,-79.34928595226602],[43.64631842552376,-79.34928373571377],[43.646317450486734,-79.34928154411048],[43.64631642152337,-79.34927941462067],[43.64631533861733,-79.34927733484864],[43.64631421076991,-79.3492753047719],[43.646311793263436,-79.3492714061675],[43.64631008965727,-79.34926962544486],[43.64630835016015,-79.34926793158206],[43.646306556753046,-79.34926631222842],[43.64630473647266,-79.34926479210775],[43.646302871300016,-79.3492633588694],[43.646300970236396,-79.34926201249084],[43.64629903329818,-79.34926076536773],[43.64629706948669,-79.34925961747759],[43.646295078785606,-79.34925855642472],[43.646293052209955,-79.34925759462728],[43.646291007778714,-79.34925674443592],[43.646288945459204,-79.3492559810593],[43.64628686528413,-79.34925532928874],[43.646284767237155,-79.34925477672856],[43.64628266031959,-79.34925432335623],[43.64628053553014,-79.34925396919428],[43.64627841088777,-79.34925372659332],[43.6462762773912,-79.34925359557586],[43.646274135007715,-79.34925355135056],[43.64627200177267,-79.34925361866371],[43.6462677447289,-79.34925407555467],[43.64626337922776,-79.34925419803285],[43.6462590229895,-79.34925451881907],[43.646254685031764,-79.3492550502864],[43.646250356369585,-79.34925580485299],[43.64624604597161,-79.34925675770498],[43.64624177185684,-79.34925792119292],[43.64623752500758,-79.34925928294366],[43.646233314441524,-79.34926085533031],[43.64622914014231,-79.34926262595715],[43.64622502011261,-79.34926459477913],[43.64622095435239,-79.34926676179623],[43.64621695186299,-79.34926912698589],[43.64621300364306,-79.3492716903706],[43.64620911867759,-79.34927443953217],[43.646205314952894,-79.3492773620299],[43.64620158350031,-79.34928048267757],[43.64619793327209,-79.34928376426572],[43.64619437330229,-79.34928723156314],[43.646190903574535,-79.34929087217412],[43.64618752405612,-79.34929466130741],[43.64618424378108,-79.34929862373174],[43.646181062716664,-79.34930273465584],[43.64617798988058,-79.34930700645285],[43.646175034241445,-79.34931141430894],[43.64616945658395,-79.34932066303483],[43.646165820224645,-79.34932763849716],[43.64616237315441,-79.34933481181643],[43.64615913334313,-79.34934215815639],[43.646156100774505,-79.34934966512148],[43.646153275448484,-79.34935733271175],[43.646150666350046,-79.3493651485091],[43.646148282447804,-79.34937308769985],[43.6461441812142,-79.34938932388869],[43.64613652585736,-79.34942713742912],[43.646135551715844,-79.34943245760695],[43.6461344424887,-79.34943772853931],[43.64613320717733,-79.3494429502037],[43.64613182774634,-79.34944809785375],[43.646130322214816,-79.34945318384011],[43.64612868156505,-79.34945819578964],[43.64612691476575,-79.3494631088885],[43.64612503085094,-79.34946794790551],[43.646123011785285,-79.34947268809431],[43.64612087555518,-79.34947731701432],[43.6461186221769,-79.34948184706111],[43.6461162516342,-79.34948626583908],[43.64611377291208,-79.3494905609301],[43.64610848191197,-79.34949876767809],[43.64608975101887,-79.34952684104239],[43.64607584618163,-79.34954224637312],[43.64605343920887,-79.34956765141999],[43.646034829520964,-79.34958523771124],[43.646022926364616,-79.34960321631593],[43.64601295182362,-79.34961612028161],[43.64599478850523,-79.34965143120657],[43.64604049305431,-79.34970970075219],[43.646042854517226,-79.34971206243505],[43.6460452788591,-79.34971432479605],[43.64604776603103,-79.34971645064839],[43.646050298062946,-79.34971846482814],[43.646052883923595,-79.34972034252164],[43.64605551464425,-79.34972210854252],[43.646058190192335,-79.34972373809958],[43.64606090156647,-79.34972523121522],[43.64606365776804,-79.34972658786695],[43.64606644079437,-79.34972780809969],[43.646069259663086,-79.34972890428658],[43.64607210534027,-79.34972985165878],[43.6460749688409,-79.34973066263436],[43.64608074927985,-79.34973185060431],[43.64611970258575,-79.34972834469274],[43.64612103421332,-79.34972790752468],[43.64612235675808,-79.3497274084009],[43.64612366120241,-79.34972683494817],[43.64612495658021,-79.34972621193533],[43.64612623385755,-79.34972551459354],[43.646127484049416,-79.34972475534089],[43.646128725158476,-79.34972393413247],[43.646129939182025,-79.34972305101319],[43.64613112613639,-79.34972211837862],[43.646132294990295,-79.34972111141512],[43.64613342778994,-79.34972006735444],[43.64613454248916,-79.34971894896479],[43.64613562113412,-79.34971779347795],[43.64613667269357,-79.34971657608023],[43.64613768818247,-79.34971530918968],[43.646138667600844,-79.34971399280631],[43.646139619950006,-79.34971262690769],[43.64614053622861,-79.34971121151624],[43.646142242604085,-79.34970825709105],[43.646162038934,-79.34966895061527],[43.64617079983841,-79.34963668759744],[43.64617601611494,-79.34960588370866],[43.646180313268154,-79.34957433836706],[43.64618496451758,-79.34952459527129],[43.64618673717545,-79.34950361734634],[43.64618973810783,-79.34948574767051],[43.64619186728737,-79.3494757638265],[43.64619996240738,-79.34945061755256],[43.646210328552705,-79.34942751088806],[43.646221356085555,-79.34940766263051],[43.64623178759671,-79.3493931831907],[43.646242852008704,-79.34938083422439],[43.6462566348067,-79.34936846606509],[43.64627146527031,-79.34935876035814],[43.64628473753744,-79.34935515722778],[43.64629894287172,-79.3493560514062],[43.64631478886553,-79.34936560608766]],"geometrySource":{"url":"https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer/34","objectId":1965,"assetId":989013,"assetName":"BIIDAASIGE PARK - Off Leash Area (East)","created":1777042432000,"modified":1779199013000,"interpretation":"City asset polygon matches artificial-turf island in independently reviewed orthophoto; not a fence boundary or a surveyed elevation."},"export":{"width":1600,"height":1200,"scale":391.7327842208627,"extent":{"xmin":-8833231.868397554,"ymin":5410788.821957466,"xmax":-8833066.034520566,"ymax":5410913.197365207,"spatialReference":{"wkid":102100,"latestWkid":3857}}}},{"id":"dogs-west-800","nominalWholeAreaM2":800,"dimensionStatus":"Published whole dog-area size is not the turf-only area.","turfRingLatLon":[[43.64500704729852,-79.35245386411162],[43.64515379541246,-79.35213944083469],[43.645112591889344,-79.35209439761395],[43.64511114999103,-79.35209309962788],[43.645109681168904,-79.35209186368525],[43.645108176437624,-79.35209070220355],[43.64510664479857,-79.35208961516072],[43.645105086251675,-79.35208860255676],[43.64510350981438,-79.35208767676497],[43.6451018974519,-79.3520868130387],[43.64510027620035,-79.35208603610252],[43.645098628057056,-79.35208534600059],[43.64509696200729,-79.35208473031541],[43.64509528705243,-79.35208418902488],[43.64509359420714,-79.3520837345465],[43.6450918924728,-79.35208336685818],[43.64509018183334,-79.3520830735645],[43.64508847132218,-79.35208287943419],[43.645086751905936,-79.35208275969852],[43.645085023584556,-79.35208271435744],[43.64508330439283,-79.35208276815763],[43.64508158529737,-79.35208289633034],[43.64507986631416,-79.35208311127097],[43.64507815644455,-79.35208341295744],[43.64507646467386,-79.35208378897221],[43.64507477303147,-79.35208426415032],[43.64507309947195,-79.3520848012613],[43.64507143504209,-79.3520854375135],[43.64506978871113,-79.35208614809399],[43.645068169480396,-79.3520869329807],[43.64506655936329,-79.35208780461318],[43.645064985331715,-79.35208873813436],[43.64506342943112,-79.35208977077463],[43.645061900614714,-79.35209086532566],[43.64506040789988,-79.3520920341608],[43.64505893328395,-79.3520932773242],[43.64505750375489,-79.35209458235418],[43.6450561013421,-79.35209597408574],[43.645054734998794,-79.35209741531054],[43.64505341375838,-79.35209893079735],[43.64505212860351,-79.35210050817281],[43.6450508885355,-79.35210214741487],[43.64504968455297,-79.35210384854557],[43.64504852565732,-79.35210561154285],[43.64504742083384,-79.35210742398924],[43.64504635207981,-79.35210928592886],[43.64504533741399,-79.35211120971297],[43.645044376804265,-79.35211317055078],[43.64504346126536,-79.35211518085976],[43.64504259978254,-79.35211722822241],[43.64504179237188,-79.35211932503415],[43.64504103901732,-79.3521214588996],[43.645040339718854,-79.35212362981875],[43.645039694460465,-79.35212582539619],[43.645039112259504,-79.35212805800525],[43.64503858409859,-79.3521303152726],[43.645037698898335,-79.35213490376019],[43.645036711052654,-79.35214364497486],[43.64503596630661,-79.35215243517483],[43.64503546464417,-79.35216126196481],[43.645035215034575,-79.35217010053199],[43.645035435952565,-79.3521878006913],[43.64503588336496,-79.35219270819206],[43.64503620477442,-79.3521976283973],[43.64503640018094,-79.35220256130695],[43.64503646058318,-79.35220750694307],[43.64503638594906,-79.35221244051479],[43.64503619429732,-79.35221737437335],[43.64503586760926,-79.35222229616747],[43.645035405868846,-79.35222719350169],[43.64503482709477,-79.35223207872724],[43.6450341132363,-79.35223691470205],[43.645033273326845,-79.35224172619478],[43.645032316335666,-79.35224648839254],[43.64503122426011,-79.35225120133944],[43.64503001508685,-79.3522558525959],[43.645028688815884,-79.35226044216193],[43.64502567593146,-79.3522693990584],[43.64502285872123,-79.35227653334384],[43.64501985227416,-79.35228350695154],[43.645016647588996,-79.35229031990347],[43.64501325365108,-79.35229695978218],[43.64500967944573,-79.35230341417012],[43.6450020082036,-79.35231574163876],[43.64500039227001,-79.35231907997132],[43.644998857460486,-79.35232250487307],[43.64499741274432,-79.35232599153115],[43.6449960581375,-79.35232955234098],[43.64499479364003,-79.35233318730255],[43.64499362822123,-79.35233687160304],[43.644992561881125,-79.35234060524249],[43.64499158563433,-79.35234440063832],[43.64499070845019,-79.35234823297772],[43.64498993034468,-79.3523521146561],[43.64498926028713,-79.35235602086063],[43.6449886802909,-79.35235996403082],[43.6449882083426,-79.3523639317272],[43.64498783544093,-79.35236792397184],[43.644987570555216,-79.35237191595192],[43.64498740471608,-79.35237593248029],[43.64498734689291,-79.35237994874413],[43.644987388100326,-79.35238397716091],[43.64498753730768,-79.35238799291781],[43.64498778551363,-79.3523919960369],[43.64498814171949,-79.35239598649612],[43.64498859690798,-79.35239995192218],[43.644989151095054,-79.35240390471046],[43.64498981325004,-79.35240782004817],[43.64499056537031,-79.35241169797938],[43.6449914254745,-79.35241555085545],[43.64499238451331,-79.35241934151223],[43.64499344251871,-79.35242309474054],[43.644994590457394,-79.35242678577161],[43.64499583734667,-79.35243042697886],[43.644997174153225,-79.35243399359351],[43.64499860089311,-79.35243749801096],[43.64500011756623,-79.35244094023122],[43.64500172414067,-79.35244429546353],[43.64500342063244,-79.35244757610326],[43.64500704729852,-79.35245386411162]],"geometrySource":{"url":"https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer/34","objectId":3273,"assetId":989014,"assetName":"BIIDAASIGE PARK - Off Leash Area (West)","created":1776090899000,"modified":1779198826000,"interpretation":"City asset polygon matches artificial-turf island in independently reviewed orthophoto; not a fence boundary or a surveyed elevation."},"export":{"width":1600,"height":1200,"scale":326.4377624259397,"extent":{"xmin":-8833520.335667549,"ymin":5410622.983362336,"xmax":-8833382.14340507,"ymax":5410726.627559194,"spatialReference":{"wkid":102100,"latestWkid":3857}}}}]};
// <<< DOG_SURFACES_DATA

const GROUND_Y = 0.224; // world grass/asphalt datum
const TURF_Y = 0.228; // thin artificial-turf finish, +.004 m above the asphalt underlay
const TURF_LIFT_M = 0.004;
const EPS = 1e-9;
const MAX_AREA_SPAN_M = 100;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------------------------------------------
// Projection and source geometry (C.worldFromLatLon at call time; null when absent).
function projectionAvailable() {
  return !!(C && typeof C.worldFromLatLon === 'function');
}
function project(lat, lon) {
  if (!projectionAvailable() || !isNum(lat) || !isNum(lon)) return null;
  const p = C.worldFromLatLon(lat, lon);
  return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}
function ringWorld(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out = [];
  for (const pt of ring) {
    const lat = Array.isArray(pt) ? pt[0] : pt.lat;
    const lon = Array.isArray(pt) ? pt[1] : pt.lon;
    const p = project(lat, lon);
    if (!p) return null;
    out.push(p);
  }
  return out;
}
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!isNum(p.x) || !isNum(p.z)) return null;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
  }
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.z - l.z) < 1e-9) out.pop();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure polygon helpers (world x/z).
function signedArea2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return a / 2;
}
function ringArea(ring) {
  return Math.abs(signedArea2(ring));
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const L = vx * vx + vz * vz;
  let t = L ? ((px - ax) * vx + (pz - az) * vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}
function distToRing(x, z, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    m = Math.min(m, segDist(x, z, ring[j].x, ring[j].z, ring[i].x, ring[i].z));
  }
  return m;
}
function bboxOf(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}
function bboxOverlap(a, b) {
  return a.minX <= b.maxX + EPS && b.minX <= a.maxX + EPS && a.minZ <= b.maxZ + EPS && b.minZ <= a.maxZ + EPS;
}

// Sutherland-Hodgman: clip a subject polygon against a CONVEX clip polygon (a triangle here). The clip winding is
// detected from its signed area, so either orientation works. Returns an ordered convex polygon (possibly empty).
function clipConvex(subject, clip) {
  if (!Array.isArray(subject) || subject.length < 3 || !Array.isArray(clip) || clip.length < 3) return [];
  const ccw = signedArea2(clip) > 0;
  let output = subject.map((p) => ({ x: p.x, z: p.z }));
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    const inside = (p) => {
      const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      return ccw ? cross >= -EPS : cross <= EPS;
    };
    const intersect = (p, q) => {
      const x1 = p.x, z1 = p.z, x2 = q.x, z2 = q.z, x3 = a.x, z3 = a.z, x4 = b.x, z4 = b.z;
      const den = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
      if (Math.abs(den) < 1e-12) return { x: (x1 + x2) / 2, z: (z1 + z2) / 2 };
      const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / den;
      return { x: x1 + t * (x2 - x1), z: z1 + t * (z2 - z1) };
    };
    let prev = input[input.length - 1];
    let prevIn = inside(prev);
    for (const cur of input) {
      const curIn = inside(cur);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
      prev = cur;
      prevIn = curIn;
    }
  }
  const clean = [];
  for (const p of output) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    clean.push(p);
  }
  if (clean.length >= 2) {
    const f = clean[0], l = clean[clean.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.z - l.z) < 1e-9) clean.pop();
  }
  return clean.length >= 3 ? clean : [];
}

// Fan-triangulate a convex polygon at a fixed height, winding every triangle upward (+Y).
function fanTriangles(poly, y, out) {
  if (!Array.isArray(poly) || poly.length < 3) return;
  const a = poly[0];
  for (let i = 1; i + 1 < poly.length; i++) {
    const b = poly[i], c = poly[i + 1];
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (Math.abs(ny) < 1e-12) continue;
    if (ny > 0) out.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z);
    else out.push(a.x, y, a.z, c.x, y, c.z, b.x, y, b.z);
  }
}

// Concave-safe ring triangulation through THREE.ShapeUtils (the repo convention). Returns triangles of {x,z}.
function triangulateRing(THREE, ring) {
  if (!THREE || !Array.isArray(ring) || ring.length < 3) return null;
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = null; }
  if (!faces || !faces.length) return null;
  const tris = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    if (!a || !b || !c) continue;
    tris.push([a, b, c]);
  }
  return tris.length ? tris : null;
}

function makeGeometry(THREE, pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Copy the ACTUAL rendered triangles into the repo `surfaces` format, rewound upward.
function collectTriangles(p, kind, out, siteId) {
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
    const cx = p.getX(t + 2), cy = p.getY(t + 2), cz = p.getZ(t + 2);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(ny) < 1e-12) continue;
    if (ny > 0) out.push({ triangle: [ax, ay, az, bx, by, bz, cx, cy, cz], kind, siteId });
    else out.push({ triangle: [ax, ay, az, cx, cy, cz, bx, by, bz], kind, siteId });
  }
}
function makeTriangleQuery(surfaces) {
  const tris = [];
  for (const s of surfaces) {
    const T = s.triangle;
    if (!Array.isArray(T) || T.length !== 9) continue;
    tris.push({ x: [T[0], T[3], T[6]], y: [T[1], T[4], T[7]], z: [T[2], T[5], T[8]], kind: s.kind, siteId: s.siteId });
  }
  return { tris };
}
function queryAt(query, x, z, kind) {
  if (!query || !isNum(x) || !isNum(z)) return null;
  let best = null;
  for (const t of query.tris) {
    if (kind && t.kind !== kind) continue;
    const x0 = t.x[0], x1 = t.x[1], x2 = t.x[2], z0 = t.z[0], z1 = t.z[1], z2 = t.z[2];
    const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(den) < 1e-12) continue;
    const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
    const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
    const c = 1 - a - b;
    if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
    const h = a * t.y[0] + b * t.y[1] + c * t.y[2];
    if (!best || h > best.surfaceY) best = { onSurface: true, kind: t.kind, siteId: t.siteId, surfaceY: h };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials (WebGPU NodeMaterial with a classic fallback, the repo convention). Matte, photo-estimated: asphalt is a
// dark grey (sRGB ~.15) and the K9 artificial turf is a muted dark grey-green, never bright natural-grass noise.
const MATERIALS = {
  asphalt: { color: 0x262626, roughness: 0.98, metalness: 0.0 },
  turf: { color: 0x3a463a, roughness: 0.96, metalness: 0.0 }
};
function material(THREE, key) {
  const spec = MATERIALS[key] || MATERIALS.asphalt;
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness });
}

// ---------------------------------------------------------------------------------------------------------------
// One dog area: OSM outer asphalt underlay + clipped source-traced turf finish.
function buildArea(THREE, feature, outerRing) {
  const outer = dedupeRing(outerRing);
  if (!outer || outer.length < 3) return { skip: 'OSM outer ring missing or degenerate' };
  const outerArea = ringArea(outer);
  if (!(outerArea > 1)) return { skip: 'OSM outer ring has no area' };
  const outerTris = triangulateRing(THREE, outer);
  if (!outerTris) return { skip: 'OSM outer ring triangulation failed' };

  const rawTurf = ringWorld(feature.turfRingLatLon);
  if (!rawTurf) return { skip: 'turf ring missing or outside the active projection' };
  const turf = dedupeRing(rawTurf);
  if (!turf || turf.length < 3) return { skip: 'turf ring degenerate' };
  const rawTurfArea = ringArea(turf);
  const turfTris = triangulateRing(THREE, turf);
  if (!turfTris) return { skip: 'turf ring triangulation failed' };

  // Report how far the raw trace sits outside the OSM ring; never expand the published boundary to fit it.
  let outside = 0, maxOutside = 0;
  for (const p of turf) {
    if (!pointInRing(outer, p.x, p.z)) {
      outside++;
      maxOutside = Math.max(maxOutside, distToRing(p.x, p.z, outer));
    }
  }

  // Clip every turf triangle against every outer triangle (coarse bbox prune first). The union of the pairwise
  // intersections is exactly turf ∩ outer, so no turf face can escape the OSM boundary.
  const outerBoxes = outerTris.map((t) => bboxOf(t));
  const turfPos = [];
  let clippedArea = 0;
  for (const tt of turfTris) {
    const tb = bboxOf(tt);
    for (let i = 0; i < outerTris.length; i++) {
      if (!bboxOverlap(tb, outerBoxes[i])) continue;
      const poly = clipConvex(tt, outerTris[i]);
      if (poly.length < 3) continue;
      clippedArea += ringArea(poly);
      fanTriangles(poly, TURF_Y, turfPos);
    }
  }
  if (!turfPos.length) return { skip: 'turf ring does not intersect the OSM outer ring' };

  // Asphalt underlay: the whole OSM outer ring at the ground datum. The turf finish sits .004 m above it, so the
  // layers are physically plausible and never coplanar.
  const asphaltPos = [];
  for (const t of outerTris) fanTriangles(t, GROUND_Y, asphaltPos);
  if (!asphaltPos.length) return { skip: 'asphalt underlay produced no triangles' };

  const asphaltGeo = makeGeometry(THREE, asphaltPos);
  const turfGeo = makeGeometry(THREE, turfPos);
  const asphaltMesh = new THREE.Mesh(asphaltGeo, material(THREE, 'asphalt'));
  asphaltMesh.name = `BiidaasigeDogSurfaces_${feature.id}_Asphalt`;
  asphaltMesh.receiveShadow = true;
  asphaltMesh.castShadow = false;
  const turfMesh = new THREE.Mesh(turfGeo, material(THREE, 'turf'));
  turfMesh.name = `BiidaasigeDogSurfaces_${feature.id}_Turf`;
  turfMesh.receiveShadow = true;
  turfMesh.castShadow = false;

  const surfaces = [];
  collectTriangles(asphaltGeo.attributes.position, 'asphalt', surfaces, feature.id);
  collectTriangles(turfGeo.attributes.position, 'turf', surfaces, feature.id);

  const bb = bboxOf(outer);
  const spanM = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
  const site = {
    id: feature.id,
    kind: 'dog-surface',
    nominalWholeAreaM2: feature.nominalWholeAreaM2,
    dimensionStatus: feature.dimensionStatus || 'Published whole dog-area size is not the turf-only area.',
    outerAreaM2: round1(outerArea),
    actualAsphaltAreaM2: round1(outerArea-clippedArea),
    asphaltUnderlayAreaM2:round1(outerArea),
    geometrySource:feature.geometrySource,
    actualTurfAreaM2: round1(clippedArea),
    rawTurfAreaM2: round1(rawTurfArea),
    turfVerticesOutside: outside,
    maxTurfVertexOutsideM: round1(maxOutside),
    traceUncertaintyM: DATA.errorM,
    traceToleranceM: DATA.traceToleranceM,
    groundY: GROUND_Y,
    turfY: TURF_Y,
    turfLiftM: TURF_LIFT_M,
    spanM: round1(spanM),
    outerRing: outer.map((p) => [p.x, p.z]),
    turfRing: turf.map((p) => [p.x, p.z]),
    meshCount: 2,
    materials: ['asphalt', 'turf'],
    triangles: { asphalt: asphaltPos.length / 9, turf: turfPos.length / 9 },
    sourceStatus: 'outer = current verified OSM dog-area ring; turf = City2026 Outdoor Recreation Area asset polygon independently verified against2025 orthophoto, clipped to OSM outer',
    heightStatus: 'asphalt at .224 m datum; turf finish at .228 m (+.004 m)'
  };
  return { meshes: [asphaltMesh, turfMesh], surfaces, site };
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigeDogSurfaces(scene, opts).
function buildBiidaasigeDogSurfaces(scene = null, opts = {}) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;
  const group = new THREE.Group();
  group.name = 'BiidaasigeDogSurfaces';
  const surfaces = [];
  const sites = [];
  const unplaced = [];
  const stats = {
    siteCount: 0, meshes: 0, triangles: 0, asphaltTriangles: 0, turfTriangles: 0,
    colliders: 0, groundY: GROUND_Y, turfY: TURF_Y, turfLiftM: TURF_LIFT_M,
    traceUncertaintyM: DATA.errorM, traceToleranceM: DATA.traceToleranceM,
    source: 'current verified OSM dog-area rings + Captain-traced 2025 ortho turf rings'
  };

  const publish = (record) => {
    if (!C) return;
    C.biidaasigeDogSurfaces = record;
    C.biidaasigeDogSurfaceAt = (x, z, o) => dogSurfaceAtInternal(x, z, o);
  };
  const finish = (reason) => {
    if (reason) stats.reason = reason;
    stats.colliders = 0;
    group.userData.biidaasigeDogSurfaces = stats;
    if (scene && scene.add) scene.add(group);
    const record = { group, colliders: [], surfaces, sites, unplaced, stats };
    publish(record);
    return record;
  };

  if (!projectionAvailable()) return finish('projection unavailable (C.worldFromLatLon missing)');
  if (!C || typeof C.biidaasigeParkRingWorld !== 'function') {
    return finish('OSM dog-area rings unavailable (C.biidaasigeParkRingWorld missing)');
  }

  for (const feature of DATA.features || []) {
    const outerRing = C.biidaasigeParkRingWorld(feature.id);
    if (!outerRing) { unplaced.push({ id: feature.id, reason: 'OSM dog-area ring unavailable' }); continue; }
    const result = buildArea(THREE, feature, outerRing);
    if (result.skip) { unplaced.push({ id: feature.id, reason: result.skip }); continue; }
    for (const m of result.meshes) group.add(m);
    for (const s of result.surfaces) surfaces.push(s);
    result.site.query = makeTriangleQuery(result.surfaces);
    sites.push(result.site);
    stats.meshes += result.meshes.length;
    stats.triangles += result.site.triangles.asphalt + result.site.triangles.turf;
    stats.asphaltTriangles += result.site.triangles.asphalt;
    stats.turfTriangles += result.site.triangles.turf;
    stats.siteCount++;
  }

  if (!sites.length && unplaced.length) {
    stats.reason = unplaced.every((u) => /OSM dog-area ring unavailable/.test(u.reason))
      ? 'OSM dog-area rings unavailable (C.biidaasigeParkRingWorld returned no ring)'
      : `no dog area could be built: ${unplaced.map((u) => u.reason).join('; ')}`;
  }
  const record = finish(null);
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigeDogSurfaces] ${stats.siteCount} source-traced dog area(s), ` +
      `${stats.asphaltTriangles} asphalt + ${stats.turfTriangles} turf tris, ${unplaced.length} unplaced`);
  }
  return record;
}

// Exact-triangle lookup over the published surfaces. Returns the ACTUAL highest eligible height at (x,z), or null.
// opts.kind ('asphalt'|'turf') restricts the layer. An invalid rebuild replaces the record, so no stale answer survives.
function dogSurfaceAtInternal(x, z, opts) {
  const w = C && C.biidaasigeDogSurfaces;
  if (!w || !Array.isArray(w.sites)) return null;
  const kind = opts && typeof opts.kind === 'string' ? opts.kind : null;
  let best = null;
  for (const site of w.sites) {
    if (!site.query) continue;
    const q = queryAt(site.query, x, z, kind);
    if (q && (!best || q.surfaceY > best.surfaceY)) best = q;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_DOG_SURFACES: DATA,
    BIIDAASIGE_DOG_SURFACES_GROUND_Y: GROUND_Y,
    BIIDAASIGE_DOG_SURFACES_TURF_Y: TURF_Y,
    buildBiidaasigeDogSurfaces,
    biidaasigeDogSurfacesProjectionAvailable: projectionAvailable,
    biidaasigeDogSurfaceHelpers: {
      pointInRing, ringArea, dedupeRing, segDist, distToRing, bboxOf, bboxOverlap,
      clipConvex, fanTriangles, triangulateRing, collectTriangles, makeTriangleQuery, queryAt
    }
  });
}
})();
