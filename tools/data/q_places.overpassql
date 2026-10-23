[out:json][timeout:180];
(
  node["place"](43.55,-79.60,43.75,-79.20);
  nwr["place"="square"](43.595,-79.495,43.692,-79.315);
  nwr["tourism"](43.595,-79.495,43.692,-79.315);
  nwr["historic"](43.595,-79.495,43.692,-79.315);
  nwr["amenity"~"^(townhall|courthouse|fountain|ferry_terminal)$"]["name"](43.595,-79.495,43.692,-79.315);
  nwr["landuse"]["name"](43.595,-79.495,43.692,-79.315);
  nwr["leisure"]["name"](43.595,-79.495,43.692,-79.315);
  nwr["man_made"~"^(tower|pier|breakwater)$"]["name"](43.595,-79.495,43.692,-79.315);
);
out body geom;
