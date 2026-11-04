[out:json][timeout:180];
// High Park's features (tools/build-high-park-features.mjs): its paths and trails, gardens, beds and fountains, the
// zoo's paddocks and fences, the off-leash areas, the labyrinth, allotments, amphitheatre, parking, and buildings
(
  way["highway"~"^(footway|path|pedestrian|steps|cycleway|track|bridleway|service|unclassified)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["leisure"~"^(garden|dog_park|playground|picnic_table|park)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["landuse"~"^(flowerbed|allotments|grass|meadow)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["amenity"~"^(fountain|parking|theatre|shelter)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["tourism"~"^(zoo|attraction)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["zoo"](43.6355,-79.4740,43.6550,-79.4540);
  way["attraction"](43.6355,-79.4740,43.6550,-79.4540);
  way["barrier"~"^(fence|wall|hedge)$"](43.6355,-79.4740,43.6550,-79.4540);
  way["building"](43.6355,-79.4740,43.6550,-79.4540);
  node["tourism"~"^(attraction|information|picnic_site)$"](43.6355,-79.4740,43.6550,-79.4540);
);
out tags geom;
