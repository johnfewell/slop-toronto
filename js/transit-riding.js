(function () {
// Shared passenger ownership and doors. Vehicle simulation remains in each transit system.
function openTransitDoors(car, stopIndex, dwell) {
  car.stopIndex = stopIndex;
  car.speed = 0;
  car.dwell = Math.max(8, dwell);
  car.doorState = 'opening';
  car.doorProgress = 0;
}

function stepTransitDoors(car, dt) {
  if (!car.doorState) car.doorState = 'closed';
  if (car.doorState === 'closed') return false;
  car.speed = 0;
  if (car.doorState === 'opening') {
    car.doorProgress = Math.min(1, car.doorProgress + dt / 0.7);
    if (car.doorProgress === 1) car.doorState = 'open';
  } else if (car.doorState === 'open') {
    car.dwell = Math.max(0, car.dwell - dt);
    if (car.hold > 0) {
      car.hold = Math.max(0, car.hold - dt);
      car.dwell = Math.max(car.dwell, car.hold);
    }
    if (car.ridden && car.stopIndex === car.lastPassengerStop) car.dwell = Math.max(car.dwell, 1);
    if (car.dwell === 0) car.doorState = 'closing';
  } else {
    car.doorProgress = Math.max(0, car.doorProgress - dt / 0.7);
    if (car.doorProgress === 0) car.doorState = 'closed';
  }
  return true;
}

function createTransitRideSession({ controllerManager: controller, cameraSystem: camera }) {
  let saved = null, release = null;
  const api = { active: false, entity: null, vehicle: null, begin, end, savedGround };
  function savedGround(mode) {
    return saved?.mode === mode ? { ...saved.ground } : null;
  }
  function begin(vehicle, entity, releaseLease) {
    if (api.active || controller.suspended || !vehicle || !entity) return false;
    const ground = controller.getActiveEntity();
    saved = {
      mode: controller.activeMode,
      ground: { x: ground.position.x, y: ground.position.y, z: ground.position.z, heading: ground.heading },
      visible: ground.mesh.visible, preset: camera.activePresetId, near: camera.camera.near,
      yaw: camera.orbitYawOffset, pitch: camera.orbitPitchOffset, zoom: camera.zoomMultiplier
    };
    release = releaseLease;
    controller.resetInput();
    controller.suspended = true;
    ground.speed = 0;
    ground.mesh.visible = false;
    ground.verticalVel = 0;
    camera.followOverride = entity;
    api.active = true;
    api.entity = entity;
    api.vehicle = vehicle;
    return true;
  }
  // A destination must already be validated by the adapter. Cancelling restores the original safe ground state.
  function end(destination = null) {
    if (!api.active) return false;
    const target = destination || saved.ground;
    if (destination && !controller.findTeleportPosition(target.x, target.z, target.heading, target.y || 0, true)) return false;
    controller.setMode(saved.mode);
    const ground = controller.getActiveEntity();
    ground.position.set(target.x, target.y || 0, target.z);
    ground.heading = target.heading;
    // The normal teleport resets gait, lean, input and mesh transforms. Cancellation can still fall back to its
    // saved position if the city's arrival search is temporarily obstructed.
    controller.teleportActiveTo(target.x, target.z, target.heading, target.y);
    ground.mesh.visible = saved.visible;
    ground.prevX = ground.position.x;
    ground.prevZ = ground.position.z;
    controller.suspended = false;
    controller.resetInput();
    camera.followOverride = null;
    camera.camera.near = saved.near;
    camera.camera.updateProjectionMatrix();
    camera.resetForTeleport();
    camera.setCameraPreset(saved.preset, true);
    camera.orbitYawOffset = saved.yaw;
    camera.orbitPitchOffset = saved.pitch;
    camera.zoomMultiplier = saved.zoom;
    const done = release;
    release = null;
    api.active = false;
    api.entity = api.vehicle = null;
    saved = null;
    done?.();
    return true;
  }
  return api;
}

Object.assign(window.CITY, { openTransitDoors, stepTransitDoors, createTransitRideSession });
})();
