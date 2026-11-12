(function () {
// js/biidaasige-river-access.js
// Biidaasige Park — SOURCE-FOOTPRINTED RIVER ACCESS (bead st-bmyv.7, remaining river-access portion).
// Owns only this file, its fixture, its optional builder, its test and docs/biidaasige-river-access.md. The Captain
// owns integration and every shared/data/path module; this file edits none of them.
//
// Default: two source-footprint gravel beaches at the native .224 m datum, a source-line slipway and a
// horizontal source-line pier (width/material estimates explicit). No bank elevations are surveyed. The optional
// deriveBankSlope factory setting is experimental and is not enabled by the park integration.
// Fishing nodes and the approximate east launch stay candidate-only; they do not add default physical platforms.
// The waterline comes from decoded water geometry and the active city classifier, never the park boundary.
// Rendered triangles are published for the parent 4 m footing index; query answers never construct geometry.
// Long polygons use actual bounded mesh batches. Ground masks are integrated separately by the captain.
// Data source and attribution are in the generated block and docs/biidaasige-river-access.md.
const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || null;

// >>> RIVER_ACCESS_DATA
const DATA = {"schema":"biidaasige-river-access/1","generatedFor":["st-bmyv.7"],"owner":"river-access worker (bounded)","claim":"Current OSM river-access footprints inside Biidaasige Park (beaches, slipways, piers, fishing points) plus the two registered Canoe Cove map anchors. Exact source rings/lines/points are carried verbatim. The waterline is the ACTUAL decoded water (C.GEO.areas:water with holes, or C.waterAt), never the whole park boundary. Fishing points are a catalog (candidate-only, unverified footprint), not a default platform. No dock, boat, toilet or marina is invented.","source":{"name":"OpenStreetMap Overpass API","query":"[out:json][timeout:60]; ( nwr[\"natural\"=\"beach\"](43.640,-79.362,43.652,-79.338); nwr[\"leisure\"=\"slipway\"](...); nwr[\"waterway\"=\"access_point\"](...); nwr[\"canoe\"=\"put_in\"](...); nwr[\"whitewater\"=\"put_in\"](...); nwr[\"leisure\"=\"fishing\"](...); nwr[\"man_made\"=\"pier\"](...); nwr[\"man_made\"=\"viewing_platform\"](...); nwr[\"sport\"~\"canoe|kayak|fishing\"](...); ); out body geom;","url":"https://overpass-api.de/api/interpreter","osmBaseTimestamp":"2026-11-10T23:24:18Z","fetchedOn":"2026-11-10","bbox":[43.64,-79.362,43.652,-79.338],"license":"ODbL-1.0","licenseUrl":"https://www.openstreetmap.org/copyright","attribution":"Data © OpenStreetMap contributors, ODbL 1.0"},"datum":{"groundY":0.224,"waterLevel":-0.7,"note":"World grass datum .224 m; water about -.7 m (C.CITY_BOUNDS.waterLevel)."},"park":{"ref":"way/813717630","polygon":[[43.643766,-79.3515378],[43.6437558,-79.3515447],[43.6437247,-79.3515658],[43.6436936,-79.351587],[43.6436766,-79.3515985],[43.6436588,-79.3516106],[43.6436494,-79.351617],[43.6436359,-79.3516262],[43.6436229,-79.351635],[43.6435951,-79.3515562],[43.6435542,-79.35145],[43.6434853,-79.3513078],[43.6434139,-79.3511792],[43.6433017,-79.3510251],[43.6432267,-79.3509514],[43.6431326,-79.3508732],[43.6430999,-79.3508539],[43.6430671,-79.3508507],[43.643037,-79.350862],[43.6430196,-79.3508968],[43.642707,-79.351615],[43.6426916,-79.3517013],[43.64277,-79.3516893],[43.6428363,-79.3516917],[43.6428991,-79.3517037],[43.6429845,-79.3517278],[43.6433663,-79.3520025],[43.6434324,-79.3522003],[43.6434702,-79.3522311],[43.6435218,-79.3522028],[43.6435619,-79.3521463],[43.6436884,-79.3520613],[43.6437501,-79.3520198],[43.6439017,-79.3519043],[43.6441187,-79.3524976],[43.6439543,-79.3525723],[43.6439263,-79.3526698],[43.6438753,-79.3528937],[43.6438337,-79.3531525],[43.6437865,-79.3532868],[43.6435759,-79.3534922],[43.6434517,-79.353726],[43.6432712,-79.3541501],[43.6432592,-79.354206],[43.6432617,-79.3542551],[43.6432707,-79.354302],[43.643286,-79.3543201],[43.6433125,-79.3543192],[43.6433353,-79.3543183],[43.6433786,-79.3543054],[43.6434292,-79.3542971],[43.6435039,-79.3543047],[43.6435493,-79.3543126],[43.6436243,-79.354348],[43.6436683,-79.3544423],[43.6436582,-79.3545298],[43.6436423,-79.3545858],[43.6435937,-79.3546282],[43.643495,-79.3546639],[43.6433841,-79.3547767],[43.6433449,-79.3548999],[43.6433321,-79.3550232],[43.6433445,-79.3551438],[43.6433863,-79.3551896],[43.6434092,-79.3552615],[43.643417,-79.3553438],[43.6434021,-79.3554157],[43.6433343,-79.3554899],[43.6432216,-79.3556465],[43.6431315,-79.3558291],[43.6430761,-79.3559076],[43.6430094,-79.3559392],[43.6429369,-79.3559552],[43.6428645,-79.3559451],[43.6427877,-79.355902],[43.6426164,-79.3558253],[43.6425212,-79.3558178],[43.6425036,-79.3558299],[43.6424786,-79.3558462],[43.6423882,-79.3559828],[43.6423586,-79.356033],[43.6422691,-79.3562385],[43.642259,-79.3562875],[43.6422642,-79.3563249],[43.6422745,-79.3563529],[43.642177,-79.3565894],[43.643896,-79.3579728],[43.6440165,-79.3580827],[43.6440976,-79.3578995],[43.6441029,-79.3578875],[43.6441358,-79.3578131],[43.6441586,-79.3578439],[43.64417,-79.3578594],[43.6441557,-79.3578737],[43.6441384,-79.3579014],[43.6441406,-79.3579292],[43.6441518,-79.3579546],[43.6441618,-79.3579714],[43.6444734,-79.3582204],[43.6445036,-79.3582337],[43.6445124,-79.3582188],[43.6445032,-79.3581947],[43.644489,-79.358134],[43.6444834,-79.3580848],[43.6444785,-79.3580709],[43.6445174,-79.3580718],[43.644516,-79.3580145],[43.644545,-79.3579835],[43.6445977,-79.3579398],[43.6445977,-79.3578931],[43.6445969,-79.3578795],[43.6445882,-79.3577386],[43.6445545,-79.3576395],[43.6445091,-79.3575652],[43.644449,-79.3575084],[43.6443773,-79.3574661],[43.644294,-79.3574442],[43.6446525,-79.3565898],[43.6445166,-79.3563881],[43.6440555,-79.3556946],[43.6440057,-79.3555194],[43.6440232,-79.355349],[43.6440541,-79.3552668],[43.6446918,-79.3538175],[43.6445683,-79.3537231],[43.644504,-79.3536705],[43.6443828,-79.3535594],[43.6442839,-79.3534421],[43.6441932,-79.353286],[43.6441634,-79.3532128],[43.6440882,-79.3529423],[43.6440634,-79.3528726],[43.6440774,-79.352863],[43.6440911,-79.3528537],[43.6441004,-79.3528474],[43.6441173,-79.3528359],[43.6441346,-79.3528241],[43.6441666,-79.3528024],[43.6441965,-79.3527821],[43.6442066,-79.3527752],[43.6442315,-79.352845],[43.6442405,-79.3528746],[43.6442821,-79.352999],[43.6443445,-79.3531035],[43.6444157,-79.3531973],[43.6444918,-79.3532803],[43.6446537,-79.3534116],[43.6446672,-79.3533744],[43.6446733,-79.3533388],[43.644672,-79.3533057],[43.6446665,-79.3532785],[43.6446567,-79.3532521],[43.6446417,-79.35323],[43.6446539,-79.3531962],[43.6447884,-79.3533097],[43.6449342,-79.3529704],[43.6449647,-79.3529086],[43.6450025,-79.3528503],[43.645081,-79.3527345],[43.6451367,-79.3526056],[43.6453145,-79.3521927],[43.6453479,-79.3521176],[43.6461819,-79.3501352],[43.6463801,-79.3496936],[43.6466187,-79.3491472],[43.6468091,-79.3486923],[43.6472535,-79.3477023],[43.647536,-79.3471185],[43.6475815,-79.3470233],[43.6475893,-79.3470069],[43.6477643,-79.3471794],[43.6477514,-79.3472506],[43.6478992,-79.3472749],[43.6483027,-79.3473512],[43.648462,-79.3474821],[43.6486003,-79.3476938],[43.648708,-79.3478684],[43.6487923,-79.3479767],[43.6489315,-79.3480285],[43.6490707,-79.3480536],[43.6492135,-79.3479381],[43.6492983,-79.3477605],[43.6494319,-79.3474051],[43.6498746,-79.3462928],[43.6486822,-79.3453857],[43.6486543,-79.3453723],[43.6486397,-79.3453763],[43.6486251,-79.3453861],[43.6485321,-79.3455917],[43.6483588,-79.3454267],[43.6484031,-79.3453045],[43.6484817,-79.3450821],[43.6484484,-79.3447494],[43.6474501,-79.3439297],[43.6459088,-79.3426125],[43.6457108,-79.3424459],[43.6456293,-79.3425895],[43.645179,-79.3433823],[43.6450527,-79.3436046],[43.6450079,-79.3436835],[43.6447392,-79.3441565],[43.6448275,-79.3442565],[43.6458164,-79.3453788],[43.6445799,-79.3477378],[43.643254,-79.3504074],[43.6432088,-79.3504881],[43.6431987,-79.3505201],[43.6432006,-79.3505433],[43.6432092,-79.3505678],[43.6432184,-79.3505853],[43.643208,-79.350605],[43.6433656,-79.3507441],[43.6434791,-79.3508752],[43.6435784,-79.351026],[43.6437382,-79.3514596],[43.643766,-79.3515378]]},"waterRings":[{"ref":"way/1172508605","kind":"wetland","ring":[[43.6461342,-79.3488373],[43.6462246,-79.348516],[43.6463878,-79.3482083],[43.646573,-79.3480346],[43.646659,-79.3479249],[43.6467053,-79.3477116],[43.6467097,-79.3475044],[43.6466546,-79.3472698],[43.6466259,-79.3470565],[43.6466325,-79.3468828],[43.646637,-79.3467213],[43.6465895,-79.3465694],[43.6463378,-79.3471429],[43.6462701,-79.3474636],[43.6462087,-79.3478041],[43.6461,-79.3484578],[43.6460614,-79.3488768],[43.6461342,-79.3488373]]},{"ref":"way/1172508606","kind":"wetland","ring":[[43.6456736,-79.3486857],[43.6456163,-79.3488742],[43.6455542,-79.3489629],[43.6454331,-79.3490658],[43.6453822,-79.3490841],[43.6453278,-79.3490977],[43.6451846,-79.349089],[43.6451126,-79.3490365],[43.6453046,-79.3490104],[43.6454771,-79.348936],[43.6455401,-79.3488413],[43.6455421,-79.3487571],[43.645564,-79.3486944],[43.6455554,-79.3486106],[43.6455579,-79.3485382],[43.6454995,-79.3484622],[43.6453825,-79.3484002],[43.6452976,-79.3483658],[43.6453549,-79.3482536],[43.6454334,-79.34804],[43.6454713,-79.3477737],[43.6454807,-79.3475495],[43.6455125,-79.3473559],[43.6455915,-79.3471437],[43.6456893,-79.3469574],[43.6457835,-79.3469151],[43.6458162,-79.3469593],[43.6457856,-79.3474093],[43.6457232,-79.3480228],[43.6456736,-79.3486857]]},{"ref":"way/1172508607","kind":"wetland","ring":[[43.6449497,-79.3494993],[43.6449568,-79.3495671],[43.6451292,-79.3496485],[43.6452662,-79.3497154],[43.6454182,-79.3497332],[43.6455094,-79.3496959],[43.6455942,-79.3496465],[43.6457416,-79.3495539],[43.6459043,-79.3493883],[43.6460003,-79.3492184],[43.6460797,-79.3490039],[43.6461342,-79.3488373],[43.6460614,-79.3488768],[43.6460101,-79.349058],[43.6459428,-79.3492306],[43.6458606,-79.3493741],[43.6457508,-79.3494991],[43.6456283,-79.3495877],[43.6455063,-79.3496345],[43.6453701,-79.3496389],[43.6452389,-79.3496343],[43.6449497,-79.3494993]]},{"ref":"way/1172508608","kind":"wetland","ring":[[43.6450889,-79.349999],[43.6450031,-79.349687],[43.6449395,-79.3496496],[43.6448734,-79.3496525],[43.6448308,-79.3496679],[43.6447654,-79.3497051],[43.644731,-79.3497725],[43.6447061,-79.3498523],[43.6446949,-79.3500189],[43.6446847,-79.3506239],[43.6446983,-79.350818],[43.644642,-79.3513959],[43.6446769,-79.351314],[43.644712,-79.3511848],[43.644741,-79.3511412],[43.6447955,-79.3511697],[43.6448592,-79.351266],[43.6449751,-79.351225],[43.6450388,-79.3510842],[43.6450711,-79.3508368],[43.6450566,-79.350323],[43.6450952,-79.3501508],[43.6450889,-79.349999]]},{"ref":"way/1352429165","kind":"water","ring":[[43.6454771,-79.348936],[43.6455401,-79.3488413],[43.6455421,-79.3487571],[43.645564,-79.3486944],[43.6455554,-79.3486106],[43.6455579,-79.3485382],[43.6454995,-79.3484622],[43.6453825,-79.3484002],[43.6452976,-79.3483658],[43.6450884,-79.3486181],[43.6449458,-79.348733],[43.6448338,-79.3487706],[43.6447336,-79.3487682],[43.6446271,-79.3487958],[43.6444628,-79.348905],[43.6443143,-79.3491084],[43.6442312,-79.3492866],[43.6441306,-79.3496315],[43.6440539,-79.3498441],[43.6439854,-79.3500199],[43.6439109,-79.3502072],[43.6438957,-79.3503309],[43.6439069,-79.3504455],[43.6439388,-79.3505659],[43.6439974,-79.3506975],[43.644023,-79.3508004],[43.6440824,-79.3509057],[43.6441442,-79.3509605],[43.6441617,-79.3508742],[43.6441965,-79.3508212],[43.644143,-79.350767],[43.6441309,-79.3505753],[43.6441337,-79.3504437],[43.6441661,-79.3499036],[43.6442532,-79.349479],[43.6443245,-79.3492632],[43.6444383,-79.3490919],[43.644569,-79.3489911],[43.6446895,-79.3489277],[43.6448236,-79.3489207],[43.6450356,-79.3489965],[43.6451126,-79.3490365],[43.6453046,-79.3490104],[43.6454771,-79.348936]]},{"ref":"way/1352429188","kind":"wetland","ring":[[43.648401,-79.3467926],[43.6484505,-79.3466866],[43.6485476,-79.3467042],[43.6487126,-79.3467525],[43.6488892,-79.3468527],[43.6491703,-79.3471166],[43.6492658,-79.3472448],[43.649295,-79.3473365],[43.6492844,-79.3474794],[43.649173,-79.3477359],[43.6490514,-79.3477454],[43.6489266,-79.3477309],[43.6488413,-79.3476299],[43.6487873,-79.3475383],[43.6487713,-79.3474321],[43.6488117,-79.3473619],[43.6489193,-79.3473417],[43.6489575,-79.3472859],[43.6489843,-79.3472065],[43.6489732,-79.3470885],[43.6489494,-79.3469862],[43.6488659,-79.3468958],[43.6486184,-79.346777],[43.648401,-79.3467926]]},{"ref":"way/1370683359","kind":"water","ring":[[43.6448592,-79.351266],[43.6448366,-79.3513748],[43.6448333,-79.3515581],[43.6448246,-79.3516829],[43.6448061,-79.3518226],[43.6448061,-79.3519533],[43.644792,-79.352081],[43.6447398,-79.3521817],[43.6446811,-79.3522298],[43.6445996,-79.3522568],[43.6444495,-79.3522974],[43.6443701,-79.3523305],[43.6443462,-79.3521832],[43.644418,-79.3521441],[43.6444886,-79.3521036],[43.6445354,-79.3520405],[43.6445539,-79.3519458],[43.6445474,-79.3518496],[43.6445517,-79.3517264],[43.6445843,-79.3515822],[43.644642,-79.3513959],[43.6446769,-79.351314],[43.644712,-79.3511848],[43.644741,-79.3511412],[43.6447955,-79.3511697],[43.6448592,-79.351266]]},{"ref":"way/1414354026","kind":"wetland","ring":[[43.6469202,-79.3444106],[43.6468619,-79.3443319],[43.6467846,-79.3442658],[43.6468034,-79.344445],[43.6467042,-79.3445835],[43.6465427,-79.344654],[43.6464677,-79.3446902],[43.6463951,-79.3447381],[43.6463177,-79.3448294],[43.6462498,-79.3448842],[43.6461875,-79.3448946],[43.6461176,-79.3448555],[43.6460761,-79.3447485],[43.6460138,-79.3446416],[43.6459393,-79.344589],[43.6458433,-79.3445577],[43.6457398,-79.3445658],[43.645678,-79.344579],[43.6455629,-79.3445507],[43.6454795,-79.3444993],[43.6455202,-79.3446387],[43.6456255,-79.3448018],[43.6457436,-79.3449041],[43.6458688,-79.3449985],[43.6459826,-79.3450673],[43.6460936,-79.345083],[43.6461591,-79.345085],[43.6462885,-79.345028],[43.6463952,-79.344967],[43.646519,-79.3448943],[43.6466713,-79.34479],[43.6467851,-79.3446819],[43.6468491,-79.3446092],[43.6469003,-79.3445364],[43.6469302,-79.3444676],[43.6469202,-79.3444106]]},{"ref":"way/1414354030","kind":"wetland","ring":[[43.6477825,-79.3456018],[43.6477937,-79.3455433],[43.6478591,-79.3455196],[43.6478762,-79.3454722],[43.6478741,-79.3453907],[43.6478483,-79.3453033],[43.6477894,-79.3451847],[43.6477047,-79.345081],[43.6476103,-79.3450024],[43.6475192,-79.3449891],[43.6474055,-79.3450069],[43.6473144,-79.3450469],[43.6472532,-79.3451121],[43.6471471,-79.3452336],[43.647087,-79.3453092],[43.6470649,-79.3454551],[43.6472253,-79.34544],[43.6473745,-79.3454559],[43.6475733,-79.3455088],[43.6477825,-79.3456018]]}],"registration":{"source":"City of Toronto, Biidaasige Park wayfinding map, September 2026 (NORTH-UP)","url":"https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf","note":"Map anchors are approximate (15–25 m). They are evidence a launch/landing exists in that neighbourhood, not surveyed dock points.","anchors":[{"id":"canoe-cove-east-launch","name":"Canoe Cove east launch","lat":43.6436718,"lon":-79.3546214,"approxErrorM":25,"status":"map-registered-candidate","basis":"Captain read the east Canoe Cove launch label on the 2026 north-up map."},{"id":"canoe-cove-west-landing","name":"Canoe Cove west landing","lat":43.6429002,"lon":-79.35638,"approxErrorM":25,"status":"map-registered-candidate","basis":"Captain read the west Canoe Cove landing label on the 2026 north-up map."}]},"features":[{"id":"west-landing","ref":"way/1531061648","kind":"beach","geometryType":"polygon","role":"river-landing","name":"West Landing","surface":"gravel","tags":{"name":"West Landing","natural":"beach","surface":"gravel"},"geometry":[[43.6431315,-79.3558291],[43.6431036,-79.3559924],[43.6431143,-79.3561101],[43.6431315,-79.3561849],[43.6431143,-79.3562381],[43.643029,-79.3563185],[43.6429766,-79.3563298],[43.6429036,-79.3563094],[43.6428389,-79.3562755],[43.6428479,-79.3561702],[43.642834,-79.3560637],[43.6427877,-79.355902],[43.6428645,-79.3559451],[43.6429369,-79.3559552],[43.6430094,-79.3559392],[43.6430761,-79.3559076],[43.6431315,-79.3558291]]},{"id":"north-beach","ref":"way/1414354037","kind":"beach","geometryType":"polygon","role":"beach","name":null,"surface":"gravel","tags":{"lifeguard":"no","natural":"beach","supervised":"no","surface":"gravel"},"geometry":[[43.6480425,-79.3470187],[43.648013,-79.3469285],[43.6479997,-79.3468664],[43.6480113,-79.3467957],[43.6479805,-79.3467732],[43.6477586,-79.3467411],[43.6477202,-79.3467344],[43.6476241,-79.3466333],[43.6475392,-79.3464837],[43.647486,-79.3463844],[43.647416,-79.3463065],[43.6472704,-79.3461889],[43.6471749,-79.3461422],[43.6470782,-79.3461242],[43.646969,-79.3461299],[43.6468682,-79.3461802],[43.6467583,-79.3462654],[43.6466648,-79.3463913],[43.6466279,-79.3464787],[43.6466719,-79.3464619],[43.646724,-79.3464864],[43.6467418,-79.3464864],[43.6467811,-79.3464243],[43.6468255,-79.346371],[43.6469047,-79.3463008],[43.6469949,-79.3462612],[43.6470033,-79.3462226],[43.6470005,-79.3461802],[43.6470293,-79.3461519],[43.6470787,-79.3461493],[43.647169,-79.3461763],[43.6472537,-79.3462188],[43.6473523,-79.346296],[43.6474594,-79.346422],[43.6474845,-79.3464786],[43.6474855,-79.3465134],[43.6474771,-79.3465404],[43.6474706,-79.34657],[43.6474529,-79.3465957],[43.6474976,-79.346687],[43.6475655,-79.3467925],[43.6476014,-79.3468357],[43.6476221,-79.3468098],[43.6476628,-79.3467895],[43.6476911,-79.3467779],[43.6477042,-79.3467729],[43.6477584,-79.3467823],[43.6478158,-79.3468038],[43.6478489,-79.3468203],[43.6479019,-79.3468875],[43.6479278,-79.346936],[43.6479457,-79.3469965],[43.6479485,-79.3470444],[43.6479617,-79.3470643],[43.6479772,-79.3470775],[43.6480019,-79.3470703],[43.648021,-79.3470538],[43.6480338,-79.3470417],[43.6480425,-79.3470187]]},{"id":"east-slipway","ref":"way/1414354028","kind":"slipway","geometryType":"line","role":"boat-launch","name":null,"surface":"paving_stones","tags":{"access":"yes","leisure":"slipway","surface":"paving_stones"},"geometry":[[43.6459391,-79.3468918],[43.6459672,-79.3469849],[43.6459882,-79.3470353],[43.6460296,-79.3470954],[43.6461494,-79.3472026]]},{"id":"canoe-cove-east-pier","ref":"way/1532838053","kind":"pier","geometryType":"line","role":"pier","name":null,"surface":null,"tags":{"man_made":"pier"},"geometry":[[43.6438776,-79.3532569],[43.6437266,-79.3531965]]},{"id":"fishing-12694860565","ref":"node/12694860565","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"access":"yes","fishing":"yes","leisure":"fishing"},"lat":43.6443219,"lon":-79.3521634},{"id":"fishing-13048845877","ref":"node/13048845877","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"access":"yes","leisure":"fishing"},"lat":43.6442109,"lon":-79.3508112},{"id":"fishing-13048845878","ref":"node/13048845878","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"access":"yes","leisure":"fishing"},"lat":43.6447033,"lon":-79.349532},{"id":"fishing-13767518202","ref":"node/13767518202","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"leisure":"fishing"},"lat":43.6452511,"lon":-79.343638},{"id":"fishing-13767518203","ref":"node/13767518203","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"leisure":"fishing"},"lat":43.6457966,"lon":-79.3486809},{"id":"fishing-13767518204","ref":"node/13767518204","kind":"fishing","geometryType":"point","role":"fishing-access","name":null,"surface":null,"tags":{"leisure":"fishing"},"lat":43.6455196,"lon":-79.3492152}],"excluded":[{"ref":"way/1483076658","kind":"pier","tags":{"man_made":"pier","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."},{"ref":"way/1483076659","kind":"pier","tags":{"man_made":"pier","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."},{"ref":"way/1483076660","kind":"pier","tags":{"area":"yes","man_made":"pier","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."},{"ref":"way/1483076661","kind":"slipway","tags":{"leisure":"slipway","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."},{"ref":"way/1483076662","kind":"pier","tags":{"man_made":"pier","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."},{"ref":"way/1483076663","kind":"pier","tags":{"man_made":"pier","surface":"wood"},"reason":"Outside the park polygon (south marina, ~289 m); not park river access."}],"unresolved":[{"id":"slipway-node-13036393828","ref":"node/13036393828","kind":"slipway","reason":"Point-only leisure=slipway with no source ring/line; 15.7 m from the nearest water edge. Not built to avoid inventing a ramp."},{"id":"canoe-cove-east-launch","ref":"registration:canoe-cove-east-launch","kind":"map-anchor","reason":"Registered map anchor only; no source footprint. Built as a non-default candidate aligned to the nearest decoded water (4.4 m, within the 25 m budget); occupancy unverified."}]};
// <<< RIVER_ACCESS_DATA

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const GROUND_Y = DATA.datum.groundY;
const WATER_Y = DATA.datum.waterLevel;
const SHORE_TOUCH_M = 2.0; // a ring/line this close to the water edge may slope to the water
const SHORE_TOLERANCE_M = 20.0; // a source feature farther than this from any water edge is not built
const PIER_WIDTH_M = 2.5;
const SLIPWAY_WIDTH_M = 3.0;
const FISHING_RADIUS_M = 1.5;
const CANDIDATE_RADIUS_M = 3.0;
const MESH_CHUNK_M = 120; // a long polygon is split into spatial triangle batches <=120 m across

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
    const p = project(pt[0], pt[1]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}
function lineWorld(line) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const out = [];
  for (const pt of line) {
    const p = project(pt[0], pt[1]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}
function pointWorld(lat, lon) {
  return project(lat, lon);
}

// ---------------------------------------------------------------------------------------------------------------
// Pure polygon / distance helpers (world x/z).
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return Math.abs(a / 2);
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
function distToLine(x, z, line) {
  let m = Infinity;
  for (let i = 1; i < line.length; i++) m = Math.min(m, segDist(x, z, line[i - 1].x, line[i - 1].z, line[i].x, line[i].z));
  return m;
}
// The ACTUAL waterline, from the city's decoded water polygons (C.GEO.areas, kind 'water'), NOT the park boundary.
// A park borders streets and land as well as water, so the whole park polygon is never a waterline. If the decoded
// GEO.areas are absent the module falls back to the exact data waterRings, still never the park boundary.
function waterRingsWorld() {
  const out = [];
  const geo = C && C.GEO;
  if (geo && Array.isArray(geo.areas)) {
    for (const a of geo.areas) {
      if (!Array.isArray(a) || a[0] !== 'water') continue;
      const flat = a[2];
      if (!Array.isArray(flat) || flat.length < 6) continue;
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ x: flat[i], z: flat[i + 1] });
      const holes = [];
      const flatHoles = Array.isArray(a[3]) ? a[3] : [];
      for (const fh of flatHoles) {
        if (!Array.isArray(fh) || fh.length < 6) continue;
        const h = [];
        for (let i = 0; i + 1 < fh.length; i += 2) h.push({ x: fh[i], z: fh[i + 1] });
        if (h.length >= 3) holes.push(h);
      }
      if (ring.length >= 3) out.push({ ref: `GEO.areas:water:${a[1] || 'unnamed'}`, kind: 'geo-water', ring, holes });
    }
  }
  if (!out.length) {
    for (const w of DATA.waterRings || []) {
      const r = ringWorld(w.ring);
      if (r) out.push({ ref: w.ref, kind: w.kind, ring: r });
    }
  }
  return out;
}
// Wet/dry uses the city's own water raster when present (C.waterAt / C.isOnLand), and ALWAYS falls back to the
// module's decoded water rings so the check works in a bare geodata context (and never invents a wet vertex).
let _waterRingsCache = null;
function wetByRings(x, z) {
  if (!_waterRingsCache) _waterRingsCache = waterRingsWorld();
  // This fallback supplies geometric occupancy only; it never verifies bank elevations.
  for (const e of _waterRingsCache) {
    if (!pointInRing(e.ring, x, z)) continue;
    let inHole = false;
    for (const h of e.holes || []) if (pointInRing(h, x, z)) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
function isWet(x, z) {
  if (C && typeof C.waterAt === 'function') return !!C.waterAt(x, z);
  return wetByRings(x, z);
}
function isDry(x, z) {
  if (C && typeof C.isOnLand === 'function') return !!C.isOnLand(x, z);
  if (C && typeof C.waterAt === 'function') return !C.waterAt(x, z);
  return !wetByRings(x, z);
}
function distToEdges(x, z, edges) {
  let m = Infinity;
  for (const e of edges) m = Math.min(m, distToRing(x, z, e.ring));
  return m;
}
function nearestEdge(x, z, edges) {
  let best = { d: Infinity, ref: null, kind: null };
  for (const e of edges) {
    const d = distToRing(x, z, e.ring);
    if (d < best.d) best = { d, ref: e.ref, kind: e.kind };
  }
  return best;
}
function nearestEdgeForRing(ring, edges) {
  let best = { d: Infinity, ref: null, kind: null };
  for (const p of ring) {
    const e = nearestEdge(p.x, p.z, edges);
    if (e.d < best.d) best = e;
  }
  return best;
}
function nearestEdgeForLine(line, edges) {
  let best = { d: Infinity, ref: null, kind: null };
  for (const p of line) {
    const e = nearestEdge(p.x, p.z, edges);
    if (e.d < best.d) best = e;
  }
  return best;
}
// True water contact: a vertex is actually wet, or the shore is crossed within SHORE_TOUCH_M (one side wet, the
// other dry). This is a real wet/dry check, not a "0 m to the park edge" proximity claim.
function waterContactOnRing(ring, edges) {
  // Raw water polygons can overlap land; only the active world's actual classifier may verify contact.
  if (typeof C?.waterAt !== 'function') return {wet:false,crossed:false};
  let wet=false,crossed=false;
  for(const p of ring){
    if(isWet(p.x,p.z))wet=true;
    if(nearestEdge(p.x,p.z,edges).d>SHORE_TOUCH_M)continue;
    let aroundWet=false,aroundDry=false;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const w=isWet(p.x+dx,p.z+dz);aroundWet ||= w;aroundDry ||= !w;
    }
    crossed ||= aroundWet&&aroundDry;
  }
  return {wet,crossed};
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry builders (pure; return a BufferGeometry or null).
function makeGeometry(THREE, positions) {
  if (!positions.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
// A ring triangulated by THREE.ShapeUtils (concave-safe), with a per-vertex height function. Winding is normalized
// so the +Y normal faces up. The result is BOUNDED: triangles are bucketed into spatial tiles <= MESH_CHUNK_M across
// (by their centroid), and one BufferGeometry is returned per tile, so no single mesh spans the whole long polygon.
function ringGeometries(THREE, ring, heightAt) {
  if (!ring || ring.length < 3) return null;
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return null; }
  if (!Array.isArray(faces) || !faces.length) return null;
  // Collect upward-wound triangles, then GREEDILY pack them into tiles whose ACTUAL bounding box stays within
  // MESH_CHUNK_M across (a coarse ring can have ~47 m triangles, so centroid bucketing alone is not enough).
  const tris = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    if (!a || !b || !c) continue;
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (Math.abs(ny) < 1e-12) continue;
    const order = ny > 0 ? [a, b, c] : [a, c, b];
    tris.push(order);
  }
  if (!tris.length) return null;
  tris.sort((t1, t2) => {
    const c1 = tileCentroid(t1), c2 = tileCentroid(t2);
    return c1.z !== c2.z ? c1.z - c2.z : c1.x - c2.x;
  });
  const tiles = [];
  let cur = null;
  for (const t of tris) {
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of t) { box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x); box.minZ = Math.min(box.minZ, p.z); box.maxZ = Math.max(box.maxZ, p.z); }
    if (!cur) { cur = { box: { ...box }, tris: [t] }; continue; }
    const merged = {
      minX: Math.min(cur.box.minX, box.minX), maxX: Math.max(cur.box.maxX, box.maxX),
      minZ: Math.min(cur.box.minZ, box.minZ), maxZ: Math.max(cur.box.maxZ, box.maxZ)
    };
    if (merged.maxX - merged.minX <= MESH_CHUNK_M && merged.maxZ - merged.minZ <= MESH_CHUNK_M) {
      cur.box = merged; cur.tris.push(t);
    } else {
      tiles.push(cur);
      cur = { box: { ...box }, tris: [t] };
    }
  }
  if (cur) tiles.push(cur);
  const geos = [];
  for (const tile of tiles) {
    const pos = [];
    for (const t of tile.tris) for (const p of t) pos.push(p.x, heightAt(p), p.z);
    const g = makeGeometry(THREE, pos);
    if (g) geos.push(g);
  }
  return geos.length ? geos : null;
}
function tileCentroid(t) {
  return { x: (t[0].x + t[1].x + t[2].x) / 3, z: (t[0].z + t[1].z + t[2].z) / 3 };
}
// Tile triangulation of a flat polygon (for a local factory pad), same bounding rule.
function ringGeometry(THREE, ring, heightAt) {
  const geos = ringGeometries(THREE, ring, heightAt);
  return geos ? geos[0] : null;
}
// Emit a triangle so its +Y normal faces up (same convention as ringGeometry).

function windUp(a, b, c, heightAt, pos) {
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  if (Math.abs(ny) < 1e-12) return;
  const order = ny > 0 ? [a, b, c] : [a, c, b];
  for (const p of order) pos.push(p.x, heightAt(p), p.z);
}
// A ribbon of constant width along a polyline, with a per-vertex height function. Per-segment quads (a short pier or
// slipway has no meaningful bend gap); winding normalized upward.
function ribbonGeometry(THREE, line, width, heightAt) {
  if (!line || line.length < 2) return null;
  const half = width / 2;
  const pos = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    const nx = -dz / len * half, nz = dx / len * half;
    const a1 = { x: a.x + nx, z: a.z + nz }, a2 = { x: a.x - nx, z: a.z - nz };
    const b1 = { x: b.x + nx, z: b.z + nz }, b2 = { x: b.x - nx, z: b.z - nz };
    windUp(a1, b1, b2, heightAt, pos);
    windUp(a1, b2, a2, heightAt, pos);
  }
  return makeGeometry(THREE, pos);
}
// A regular disc (fan) at a point, with a per-vertex height function.
function discGeometry(THREE, center, radius, heightAt, sides = 12) {
  if (!center || !(radius > 0)) return null;
  const pos = [];
  const rim = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    rim.push({ x: center.x + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius });
  }
  for (let i = 0; i < sides; i++) {
    const a = rim[i], b = rim[(i + 1) % sides];
    windUp(center, a, b, heightAt, pos);
  }
  return makeGeometry(THREE, pos);
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
    tris.push({ x: [T[0], T[3], T[6]], y: [T[1], T[4], T[7]], z: [T[2], T[5], T[8]], kind: s.kind });
  }
  return { tris };
}
function queryAt(query, x, z, siteId) {
  if (!query || !isNum(x) || !isNum(z)) return null;
  let best = null;
  for (const t of query.tris) {
    const x0 = t.x[0], x1 = t.x[1], x2 = t.x[2], z0 = t.z[0], z1 = t.z[1], z2 = t.z[2];
    const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(den) < 1e-12) continue;
    const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
    const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
    const c = 1 - a - b;
    if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
    const h = a * t.y[0] + b * t.y[1] + c * t.y[2];
    if (!best || h > best.surfaceY) best = { onAccess: true, kind: t.kind, siteId, surfaceY: h };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials (WebGPU NodeMaterial with a classic fallback, the repo convention).
const MATERIALS = {
  pebble: { color: 0x8d8578, roughness: 0.98, metalness: 0.0 }, // muted grey-brown gravel/pebble — photo estimate
  paving: { color: 0x9a9a94, roughness: 0.92, metalness: 0.0 }, // paving stones — photo estimate
  timber: { color: 0x6f5a44, roughness: 0.86, metalness: 0.0 }, // weathered timber deck — photo estimate
  stone: { color: 0x7f7d76, roughness: 0.98, metalness: 0.0 } // bank stone/gravel — photo estimate
};
function material(THREE, key) {
  const spec = MATERIALS[key] || MATERIALS.pebble;
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const mat=new Mat({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness });
  // Reuse the resident shoreline noise; grain is a photo-estimated material, never extra collision geometry.
  if(key==='pebble'&&C?.TSL&&C.waterEdgeNoise&&mat.isNodeMaterial){
    const T=C.TSL,p=T.positionWorld.xz;
    const grain=C.waterEdgeNoise(p.mul(11)),patch=C.waterEdgeNoise(p.mul(.7));
    mat.colorNode=T.mix(T.color(0x59574f),T.color(0xb9b4a6),T.smoothstep(.2,.8,grain))
      .mul(patch.mul(.15).add(.9));
  }
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------
// Site builders. Each returns { mesh, surfaces, site } or { skip }.
function buildBeach(THREE, feature, edges, opts={}) {
  const raw = ringWorld(feature.geometry);
  if (!raw) return { skip: 'source ring missing or outside the active projection' };
  const ring = dedupeRing(raw);
  if (!ring || ring.length < 3) return { skip: 'degenerate source ring' };
  const areaM2 = ringArea(ring);
  if (!(areaM2 > 1)) return { skip: 'source ring has no area' };
  const near = nearestEdgeForRing(ring, edges);
  if (!(near.d <= SHORE_TOLERANCE_M)) return { skip: `source ring is ${near.d.toFixed(1)} m from any water edge (> ${SHORE_TOLERANCE_M} m)` };
  // Slope to the water ONLY on verified wet/dry contact. A "0 m to the park edge" is not water contact.
  const contact = waterContactOnRing(ring, edges);
  const wetVerts = typeof C?.waterAt==='function' ? ring.filter((p) => isWet(p.x, p.z)) : [];
  const dMax = Math.max(...ring.map((p) => distToEdges(p.x, p.z, edges)));
  const slopes = opts.deriveBankSlope===true && wetVerts.length > 0;
  const heightAt = (p) => {
    if (!slopes) return GROUND_Y;
    const d = distToEdges(p.x, p.z, edges);
    const t = Math.max(0, Math.min(1, d / Math.max(0.5, dMax)));
    return WATER_Y + (GROUND_Y - WATER_Y) * t;
  };
  const geos = ringGeometries(THREE, ring, heightAt);
  if (!geos) return { skip: 'triangulation produced no faces' };
  const meshes = [], surfaces = [];
  let tris = 0;
  for (const geo of geos) {
    const m = new THREE.Mesh(geo, material(THREE, 'pebble'));
    m.name = `BiidaasigeRiverAccess_${feature.id}`;
    m.receiveShadow = true; m.castShadow = false;
    m.userData.cullDistance = 700; m.userData.cullCell = 90;
    meshes.push(m);
    collectTriangles(geo.attributes.position, 'pebble', surfaces, feature.id);
    tris += Math.floor(geo.attributes.position.count / 3);
  }
  if (!surfaces.length) return { skip: 'no upward triangles' };
  return {
    meshes, surfaces,
    site: {
      id: feature.id, ref: feature.ref, kind: feature.kind, role: feature.role,
      evidenceTier: 'source-footprint', defaultVisible: true,
      name: feature.name, surface: feature.surface,
      geometryType: 'polygon', areaM2: Math.round(areaM2 * 10) / 10,
      shoreDistanceM: Math.round(near.d * 10) / 10, shoreRef: near.ref, shoreKind: near.kind,
      slope: slopes ? 'slopes-to-water' : 'flat-source-footprint',
      waterContact: slopes ? 'verified-wet-vertex' : (contact.crossed ? 'shore-crossed-not-vertex' : 'none-verified'),
      heightStatus: slopes ? 'slope-derived-from-wet-vertices' : 'flat-height-unverified',
      yMin: Math.min(GROUND_Y, ...ring.map(heightAt)), yMax: Math.max(GROUND_Y, ...ring.map(heightAt)),
      material: 'pebble', materialStatus: 'photo-estimate-gravel-pebble',
      meshCount: meshes.length, meshChunkM: MESH_CHUNK_M,
      triangles: tris,
      ring: ring.map((p) => [p.x, p.z]),
      sourceStatus: 'exact OSM natural=beach ring, projected at call time'
    }
  };
}
function buildSlipway(THREE, feature, edges) {
  const raw = lineWorld(feature.geometry);
  if (!raw) return { skip: 'source line missing or outside the active projection' };
  const line = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z) > 1e-6);
  if (line.length < 2) return { skip: 'degenerate source line' };
  const near = nearestEdgeForLine(line, edges);
  if (!(near.d <= SHORE_TOLERANCE_M)) return { skip: `source line is ${near.d.toFixed(1)} m from any water edge (> ${SHORE_TOLERANCE_M} m)` };
  // A slipway is usually a flat paved ramp; slope only on a verified wet/dry crossing, never a proximity claim.
  const wet = line.filter((p) => isWet(p.x, p.z));
  const reachesWater = wet.length > 0;
  const heightAt = () => GROUND_Y; // horizontal unless a verified downward slope to water is sourced
  const geo = ribbonGeometry(THREE, line, SLIPWAY_WIDTH_M, heightAt);
  if (!geo) return { skip: 'ribbon produced no faces' };
  const surfaces = [];
  collectTriangles(geo.attributes.position, 'paving', surfaces, feature.id);
  if (!surfaces.length) return { skip: 'no upward triangles' };
  const mesh = new THREE.Mesh(geo, material(THREE, 'paving'));
  mesh.name = `BiidaasigeRiverAccess_${feature.id}`;
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.cullDistance = 700; mesh.userData.cullCell = 90;
  return {
    meshes: [mesh], surfaces,
    site: {
      id: feature.id, ref: feature.ref, kind: feature.kind, role: feature.role,
      evidenceTier: 'source-line-estimated-width', defaultVisible: true,
      name: feature.name, surface: feature.surface,
      geometryType: 'line', lengthM: Math.round(line.reduce((s, p, i) => i ? s + Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z) : 0, 0) * 10) / 10,
      widthM: SLIPWAY_WIDTH_M, widthStatus: 'source-line-width-estimate',
      shoreDistanceM: Math.round(near.d * 10) / 10, shoreRef: near.ref, shoreKind: near.kind,
      reachesWater, waterContact: reachesWater ? 'verified-wet-vertex' : 'none-verified',
      slope: 'flat-horizontal-at-datum',
      heightStatus: 'flat-height-unverified',
      material: 'paving', materialStatus: 'photo-estimate-paving',
      meshCount: 1, triangles: Math.floor(geo.attributes.position.count / 3),
      sourceStatus: 'exact OSM leisure=slipway line, projected at call time'
    }
  };
}
function buildPier(THREE, feature, edges) {
  const raw = lineWorld(feature.geometry);
  if (!raw) return { skip: 'source line missing or outside the active projection' };
  const line = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z) > 1e-6);
  if (line.length < 2) return { skip: 'degenerate source line' };
  const near = nearestEdgeForLine(line, edges);
  if (!(near.d <= SHORE_TOLERANCE_M)) return { skip: `source line is ${near.d.toFixed(1)} m from any water edge (> ${SHORE_TOLERANCE_M} m)` };
  // A pier deck is HORIZONTAL; keep it at the datum unless a source elevation is given (none here).
  const heightAt = () => GROUND_Y;
  const geo = ribbonGeometry(THREE, line, PIER_WIDTH_M, heightAt);
  if (!geo) return { skip: 'ribbon produced no faces' };
  const surfaces = [];
  collectTriangles(geo.attributes.position, 'timber', surfaces, feature.id);
  if (!surfaces.length) return { skip: 'no upward triangles' };
  const mesh = new THREE.Mesh(geo, material(THREE, 'timber'));
  mesh.name = `BiidaasigeRiverAccess_${feature.id}`;
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.cullDistance = 700; mesh.userData.cullCell = 90;
  const osmTimber = /timber|wood/i.test(JSON.stringify(feature.tags || {}));
  return {
    meshes: [mesh], surfaces,
    site: {
      id: feature.id, ref: feature.ref, kind: feature.kind, role: feature.role,
      evidenceTier: 'source-line-estimated-width', defaultVisible: true,
      name: feature.name, surface: feature.surface,
      geometryType: 'line', lengthM: Math.round(line.reduce((s, p, i) => i ? s + Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z) : 0, 0) * 10) / 10,
      widthM: PIER_WIDTH_M, widthStatus: 'source-line-width-estimate',
      shoreDistanceM: Math.round(near.d * 10) / 10, shoreRef: near.ref, shoreKind: near.kind,
      slope: 'flat-horizontal-at-datum',
      heightStatus: 'flat-height-unverified-no-source-elevation',
      material: 'timber', materialStatus: osmTimber ? 'osm-tag-timber' : 'photo-estimate-timber',
      meshCount: 1, triangles: Math.floor(geo.attributes.position.count / 3),
      sourceStatus: 'exact OSM man_made=pier line, projected at call time'
    }
  };
}
// Fishing access is a CATALOG point, not a verified platform: keep the exact node position as a candidate with an
// explicitly unverified local footprint, built ONLY as a non-default candidate (never a default 3 m pad).
function buildFishingCandidate(THREE, feature, edges) {
  const center = pointWorld(feature.lat, feature.lon);
  if (!center) return { skip: 'source point missing or outside the active projection' };
  const near = nearestEdge(center.x, center.z, edges);
  const heightAt = () => GROUND_Y;
  const geo = discGeometry(THREE, center, FISHING_RADIUS_M, heightAt);
  if (!geo) return { skip: 'disc produced no faces' };
  const surfaces = [];
  collectTriangles(geo.attributes.position, 'stone', surfaces, feature.id);
  if (!surfaces.length) return { skip: 'no upward triangles' };
  const mesh = new THREE.Mesh(geo, material(THREE, 'stone'));
  mesh.name = `BiidaasigeRiverAccess_candidate_${feature.id}`;
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.cullDistance = 700; mesh.userData.cullCell = 90;
  return {
    meshes: [mesh], surfaces,
    site: {
      id: feature.id, ref: feature.ref, kind: feature.kind, role: feature.role,
      evidenceTier: 'catalog-point-unverified-footprint', defaultVisible: false,
      name: feature.name, surface: feature.surface,
      geometryType: 'point', radiusM: FISHING_RADIUS_M,
      shoreDistanceM: Math.round(near.d * 10) / 10, shoreRef: near.ref, shoreKind: near.kind,
      footprint: 'unverified-local-factory-disc',
      derivation: `Exact OSM leisure=fishing node; the 3 m gravel pad is a local factory, NOT a surveyed platform (${near.d.toFixed(1)} m from the nearest decoded water).`,
      slope: 'flat-source-footprint', heightStatus: 'flat-height-unverified',
      material: 'stone', materialStatus: 'photo-estimate-stone',
      meshCount: 1, triangles: Math.floor(geo.attributes.position.count / 3),
      sourceStatus: 'exact OSM leisure=fishing node, catalog position preserved'
    }
  };
}
function buildCandidateLaunch(THREE, anchor, edges) {
  const center = pointWorld(anchor.lat, anchor.lon);
  if (!center) return { skip: 'anchor missing or outside the active projection' };
  const near = nearestEdge(center.x, center.z, edges);
  if (!(near.d <= anchor.approxErrorM)) return { skip: `nearest decoded water is ${near.d.toFixed(1)} m away (> ${anchor.approxErrorM} m budget)` };
  const wet = isWet(center.x, center.z);
  const heightAt = (p) => {
    const d = distToEdges(p.x, p.z, edges);
    const t = Math.max(0, Math.min(1, d / Math.max(0.5, near.d + CANDIDATE_RADIUS_M)));
    return WATER_Y + (GROUND_Y - WATER_Y) * t;
  };
  const geo = discGeometry(THREE, center, CANDIDATE_RADIUS_M, heightAt);
  if (!geo) return { skip: 'disc produced no faces' };
  const surfaces = [];
  collectTriangles(geo.attributes.position, 'pebble', surfaces, anchor.id);
  if (!surfaces.length) return { skip: 'no upward triangles' };
  const mesh = new THREE.Mesh(geo, material(THREE, 'pebble'));
  mesh.name = `BiidaasigeRiverAccess_candidate_${anchor.id}`;
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.cullDistance = 700; mesh.userData.cullCell = 90;
  return {
    meshes: [mesh], surfaces,
    site: {
      id: anchor.id, ref: `registration:${anchor.id}`, kind: 'launch', role: 'canoe-launch',
      evidenceTier: 'map-registered-shore-aligned', defaultVisible: false,
      name: anchor.name, surface: null,
      geometryType: 'point', radiusM: CANDIDATE_RADIUS_M,
      approxErrorM: anchor.approxErrorM,
      shoreDistanceM: Math.round(near.d * 10) / 10, shoreRef: near.ref, shoreKind: near.kind,
      occupancy: 'shore-aligned-unverified',
      anchorOnWater: wet,
      derivation: `Registered map anchor aligned to the nearest decoded water edge (${near.d.toFixed(1)} m, within the ${anchor.approxErrorM} m budget); no source footprint exists, so this is a local factory, not a surveyed dock.`,
      slope: wet ? 'slopes-to-water' : 'flat-source-footprint',
      heightStatus: 'flat-height-unverified',
      material: 'pebble', materialStatus: 'photo-estimate-gravel-pebble',
      meshCount: 1, triangles: Math.floor(geo.attributes.position.count / 3),
      sourceStatus: 'registered 2026 City map anchor, shore-aligned within budget'
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigeRiverAccess(scene, allColliders).
function buildBiidaasigeRiverAccess(scene = null, allColliders = null, opts={}) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;
  _waterRingsCache = null;
  const group = new THREE.Group();
  group.name = 'BiidaasigeRiverAccess';
  const candidateGroup = new THREE.Group();
  candidateGroup.name = 'BiidaasigeRiverAccessCandidates';
  const surfaces = [];
  const sites = [];
  const unplaced = [];
  const stats = {
    meshes: 0, triangles: 0, siteCount: 0, candidateCount: 0, colliders: 0,
    groundY: GROUND_Y, waterLevel: WATER_Y, meshChunkM: MESH_CHUNK_M,
    source: 'current OSM river-access footprints + registered map anchors'
  };

  if (!projectionAvailable()) {
    stats.reason = 'projection unavailable (C.worldFromLatLon missing)';
    group.userData.biidaasigeRiverAccess = stats;
    if (scene && scene.add) scene.add(group);
    if (C) C.biidaasigeRiverAccess = { group, colliders: [], surfaces, sites, unplaced, candidates: { group: candidateGroup, colliders: [], surfaces: [], sites: [] }, stats };
    if (C) C.biidaasigeRiverAccessAt = () => null;
    return { group, colliders: [], surfaces, sites, unplaced, candidates: { group: candidateGroup, colliders: [], surfaces: [], sites: [] }, stats };
  }

  const edges = waterRingsWorld();
  stats.waterEdgeCount = edges.length;
  stats.waterEdgeSource = (C && C.GEO && Array.isArray(C.GEO.areas)) ? 'C.GEO.areas:water' : 'fixture data waterRings';
  // Default builders: only source-footprinted features become default meshes.
  const builders = { beach: buildBeach, slipway: buildSlipway, pier: buildPier };
  // Fishing points are a catalog, not a verified platform: candidate-only.
  const candidateSurfaces = [];
  const candidateSites = [];

  for (const feature of DATA.features || []) {
    if (feature.kind === 'fishing') {
      const result = buildFishingCandidate(THREE, feature, edges);
      if (result.skip) { unplaced.push({ id: feature.id, ref: feature.ref, kind: feature.kind, reason: result.skip }); continue; }
      for (const m of result.meshes) candidateGroup.add(m);
      for (const s of result.surfaces) candidateSurfaces.push(s);
      result.site.query = makeTriangleQuery(result.surfaces);
      candidateSites.push(result.site);
      stats.candidateCount++;
      continue;
    }
    const builder = builders[feature.kind];
    if (!builder) { unplaced.push({ id: feature.id, ref: feature.ref, kind: feature.kind, reason: 'no builder for this source kind' }); continue; }
    const result = builder(THREE, feature, edges,opts);
    if (result.skip) { unplaced.push({ id: feature.id, ref: feature.ref, kind: feature.kind, reason: result.skip }); continue; }
    for (const m of result.meshes) group.add(m);
    for (const st of result.surfaces) surfaces.push(st);
    result.site.query = makeTriangleQuery(result.surfaces);
    sites.push(result.site);
    stats.meshes += result.meshes.length;
    stats.triangles += result.site.triangles;
    stats.siteCount++;
  }

  // Registered map anchors: the west landing is aligned to the exact West Landing beach ring; the east launch is a
  // non-default candidate aligned to the decoded water within its budget.
  for (const anchor of DATA.registration?.anchors || []) {
    if (anchor.id === 'canoe-cove-west-landing') {
      const beach = sites.find((s) => s.id === 'west-landing');
      if (beach) {
        const anchorWorld = pointWorld(anchor.lat, anchor.lon);
        const anchorToRingM = anchorWorld ? nearestEdge(anchorWorld.x, anchorWorld.z, [{ ref: 'west-landing-ring', kind: 'beach', ring: beach.ring || [] }]).d : null;
        beach.registeredAnchor = {
          id: anchor.id, lat: anchor.lat, lon: anchor.lon, approxErrorM: anchor.approxErrorM,
          anchorToSourceRingM: isNum(anchorToRingM) ? Math.round(anchorToRingM * 10) / 10 : null,
          derivation: `Registered west-landing anchor resolves to the exact West Landing beach ring (the source ring is the built footprint); the anchor is a map label, not a surveyed dock point.`
        };
      } else {
        unplaced.push({ id: anchor.id, ref: `registration:${anchor.id}`, kind: 'map-anchor', reason: 'West Landing source beach ring was not built; anchor not placed.' });
      }
      continue;
    }
    const result = buildCandidateLaunch(THREE, anchor, edges);
    if (result.skip) { unplaced.push({ id: anchor.id, ref: `registration:${anchor.id}`, kind: 'map-anchor', reason: result.skip }); continue; }
    for (const m of result.meshes) candidateGroup.add(m);
    for (const s of result.surfaces) candidateSurfaces.push(s);
    result.site.query = makeTriangleQuery(result.surfaces);
    candidateSites.push(result.site);
    stats.candidateCount++;
  }

  // Record the source features that were deliberately not built (point-only slipway, outside-park marina).
  for (const u of DATA.unresolved || []) {
    if (candidateSites.some((s) => s.id === u.id)) continue; // built as a non-default candidate, not unplaced
    if (!unplaced.some((x) => x.id === u.id)) unplaced.push({ id: u.id, ref: u.ref, kind: u.kind, reason: u.reason });
  }
  for (const e of DATA.excluded || []) {
    unplaced.push({ id: e.ref, ref: e.ref, kind: e.kind, reason: e.reason });
  }

  stats.colliders = 0;
  group.userData.biidaasigeRiverAccess = stats;
  candidateGroup.userData.biidaasigeRiverAccess = { ...stats, candidates: true };
  if (scene && scene.add) scene.add(group);
  if (C) {
    C.biidaasigeRiverAccess = {
      group, colliders: [], surfaces, sites, unplaced,
      candidates: { group: candidateGroup, colliders: [], surfaces: candidateSurfaces, sites: candidateSites },
      stats
    };
    C.biidaasigeRiverAccessAt = (x, z) => accessAtInternal(x, z);
  }
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigeRiverAccess] ${stats.siteCount} source-footprint sites (${stats.triangles} tris), ` +
      `${stats.candidateCount} candidate(s) [fishing catalog + map anchors], ${unplaced.length} unplaced, ` +
      `${stats.waterEdgeCount} decoded water edge(s)`);
  }
  return { group, colliders: [], surfaces, sites, unplaced, candidates: { group: candidateGroup, colliders: [], surfaces: candidateSurfaces, sites: candidateSites }, stats };
}

// Exact-triangle lookup over the DEFAULT surfaces only. Each site's own triangles are queried; an invalid rebuild
// replaces the record, so no stale answer survives.
function accessAtInternal(x, z) {
  const w = C && C.biidaasigeRiverAccess;
  if (!w || !Array.isArray(w.sites) || !Array.isArray(w.surfaces)) return null;
  for (const site of w.sites) {
    if (!site.query) continue;
    const q = queryAt(site.query, x, z, site.id);
    if (q) return q;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_RIVER_ACCESS: DATA,
    BIIDAASIGE_RIVER_ACCESS_GROUND_Y: GROUND_Y,
    BIIDAASIGE_RIVER_ACCESS_WATER_Y: WATER_Y,
    buildBiidaasigeRiverAccess,
    biidaasigeRiverAccessProjectionAvailable: projectionAvailable,
    biidaasigeRiverAccessHelpers: {
      pointInRing, ringArea, dedupeRing, segDist, distToRing, distToLine,
      ringGeometry, ribbonGeometry, discGeometry, collectTriangles, makeTriangleQuery, queryAt
    }
  });
}
})();
