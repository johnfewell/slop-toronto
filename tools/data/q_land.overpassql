[out:json][timeout:300];
(
  way["landuse"](43.595,-79.495,43.692,-79.315);
  relation["landuse"](43.595,-79.495,43.692,-79.315);
  way["leisure"](43.595,-79.495,43.692,-79.315);
  relation["leisure"](43.595,-79.495,43.692,-79.315);
  way["natural"](43.595,-79.495,43.692,-79.315);
  relation["natural"](43.595,-79.495,43.692,-79.315);
  way["waterway"](43.595,-79.495,43.692,-79.315);
  way["amenity"~"^(parking|place_of_worship|university|school|hospital|fuel|marketplace)$"](43.595,-79.495,43.692,-79.315);
  way["man_made"](43.595,-79.495,43.692,-79.315);
  way["barrier"="wall"](43.595,-79.495,43.692,-79.315);
);
out body geom(43.585,-79.505,43.700,-79.305);
