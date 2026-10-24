(function () {
// js/cameras.js
// Multi-camera system supporting Third-Person Chase (with mouse/touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, Toronto's vantage points, and an Auto-Director Drone.

const { THREE } = window.CITY;

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',            short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',            short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',      short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'trail',       name: 'Martin Goodman Trail',        short: 'Trail',       category: 'scenic', fov: 50 },
  { id: 'islands',     name: 'Skyline from the Islands',    short: 'Islands',     category: 'scenic', fov: 46 },
  { id: 'cnTower',     name: 'CN Tower',                    short: 'CN Tower',    category: 'scenic', fov: 54 },
  { id: 'cityHall',    name: 'City Hall',                   short: 'City Hall',   category: 'scenic', fov: 52 },
  { id: 'rom',         name: 'Royal Ontario Museum',        short: 'ROM',         category: 'scenic', fov: 54 },
  { id: 'unionStation', name: 'Union Station',              short: 'Union',       category: 'scenic', fov: 54 },
  { id: 'legislature', name: "Queen's Park",                short: "Queen's Park", category: 'scenic', fov: 52 },
  { id: 'sugarBeach',  name: 'Sugar Beach',                 short: 'Sugar Beach', category: 'scenic', fov: 50 },
  { id: 'humberBay',   name: 'Sunset over Humber Bay',      short: 'Humber Bay',  category: 'scenic', fov: 48 },
  { id: 'skyline',     name: 'Skyline from the Lake',       short: 'Skyline',     category: 'scenic', fov: 44 },
  { id: 'drone',       name: 'Auto-Director Aerial',        short: 'Director',    category: 'scenic', fov: 50 }
];

// Scenic vantage points from the real geography: the teleport arrivals (a road with a clear view of the landmark,
// city-config.js) lifted to eye height, looking at the landmark
function landmarkView(teleportKey, siteId, eye, lookY, elapsed, out) {
  const { TELEPORT_LOCATIONS: T, LANDMARK_SITES: S } = window.CITY;
  const a = T[teleportKey], s = S[siteId];
  if (!a || !s) return false;
  const sway = Math.sin(elapsed * 0.22) * 2.0;
  const dx = s.x - a.x, dz = s.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  out.pos.set(a.x - (dz / L) * sway, eye, a.z + (dx / L) * sway);
  out.look.set(s.x, lookY, s.z);
  return true;
}

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the boroughs & harbor run out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    // Film mode (js/cinema.js): a function of time giving { pos, look, fov } overrides every preset
    this.cinema = null;
    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    this.bindPointerControls();
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  // The gamepad's right stick orbits the chase & POV cameras, its D-pad zooms the chase one (gamepad-controls.js)
  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this.setCameraPreset('chase', true);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    if (this.cinema) {
      const shot = this.cinema(elapsed);
      if (shot) {
        this.currentPos.set(...shot.pos);
        this.currentLookAt.set(...shot.look);
        if (shot.fov && shot.fov !== this.camera.fov) {
          this.camera.fov = shot.fov;
          this.camera.updateProjectionMatrix();
        }
        this.camera.position.copy(this.currentPos);
        this.camera.lookAt(this.currentLookAt);
        this.initialized = false;
        return;
      }
    }
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;

    switch (this.activePresetId) {
      case 'chase': {
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          Math.max(0.65, entity.position.y + height),
          entity.position.z - Math.cos(totalYaw) * horizDist
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 5.2,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(entity.heading) * 5.2
        );
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'trail':
      case 'islands':
      case 'sugarBeach':
      case 'humberBay': {
        // Fixed eye points on the real shore (lat / lon), looking at the CN Tower or a point of their own
        const { worldFromLatLon, GEO } = window.CITY;
        const cn = GEO.points.cnTower;
        const [lat, lon, eye, lookY, lookAt] = {
          trail: [43.63075, -79.4679, 3.2, 180],     // just east of the Humber Bay Arch Bridge
          islands: [43.6215, -79.3772, 4.0, 150],    // Centre Island's north shore, across the harbour
          sugarBeach: [43.6421, -79.3662, 2.6, 120], // on the sand at the water, looking west along the waterfront
          humberBay: [43.6262, -79.4232, 4.0, 8, [43.6303, -79.4705]] // Ontario Place's west shore to the arch bridge
        }[this.activePresetId];
        const p = worldFromLatLon(lat, lon);
        const sway = Math.sin(elapsed * 0.2) * 2.0;
        desiredPos.set(p.x + sway, eye, p.z);
        const t = lookAt ? worldFromLatLon(lookAt[0], lookAt[1]) : { x: cn[0], z: cn[1] };
        desiredLook.set(t.x, lookY, t.z);
        break;
      }

      case 'cnTower':
      case 'cityHall':
      case 'rom':
      case 'unionStation':
      case 'legislature': {
        const [key, site, eye, lookY] = {
          cnTower: ['cnTower', 'cnTower', 6, 260],
          cityHall: ['cityHall', 'cityHall', 6, 40],
          rom: ['rom', 'rom', 5, 18],
          unionStation: ['unionStation', 'unionStation', 5, 14],
          legislature: ['legislature', 'legislature', 5, 25]
        }[this.activePresetId];
        if (!landmarkView(key, site, eye, lookY, elapsed, { pos: desiredPos, look: desiredLook })) {
          const cn = window.CITY.GEO.points.cnTower;
          desiredPos.set(cn[0] - 300, 40, cn[1] + 300);
          desiredLook.set(cn[0], 200, cn[1]);
        }
        break;
      }

      case 'skyline': {
        // Out over the lake, south of the Islands, the whole waterfront from Ontario Place to the Port Lands
        const cn = window.CITY.GEO.points.cnTower;
        const pan = Math.sin(elapsed * 0.12) * 300.0;
        desiredPos.set(cn[0] + 400.0 + pan, 140.0, cn[1] + 4200.0);
        desiredLook.set(cn[0] + 600.0, 120.0, cn[1]);
        break;
      }

      case 'drone': {
        // Orbiting downtown round the CN Tower: the Financial District, the waterfront, the Islands
        const cn = window.CITY.GEO.points.cnTower;
        const angle = elapsed * 0.06 + 0.65;
        const radius = 1500.0 + Math.sin(elapsed * 0.23) * 250.0;
        const alt = 380.0 + Math.cos(elapsed * 0.19) * 110.0;
        desiredPos.set(cn[0] + Math.cos(angle) * radius, alt, cn[1] + Math.sin(angle) * radius);
        desiredLook.set(cn[0] + 300.0, 80.0, cn[1] - 300.0);
        break;
      }
    }

    if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const k = 1 - Math.exp(-dt * 8.5);
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}

Object.assign(window.CITY, { CAMERA_PRESETS, CameraSystem });
})();
