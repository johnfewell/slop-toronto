// The homepage previews the same map that Explore will open.
(() => {
  const EGLINTON_ON_DESKTOP = true;
  window.selectCityMap = (params = new URLSearchParams()) => {
    const touchFirst = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
    const desktop = !touchFirst && !['low', 'medium'].includes(params.get('quality')) &&
      !(navigator.deviceMemory && navigator.deviceMemory < 8);
    const explicit = params.get('map');
    const map = explicit === 'eglinton' || explicit === 'detail' ? explicit
      : params.get('gallery') === 'presets' || !EGLINTON_ON_DESKTOP || !desktop ? 'detail' : 'eglinton';
    return { map, desktop, touchFirst };
  };
})();
