// tools/capture-resource-buffer.js — a capture init script (CAPTURE_INIT_SCRIPT): the page's resource-timing buffer keeps
// 250 entries by default, so a list of everything a page fetched is cut short; this makes room for all of them.
performance.setResourceTimingBufferSize(5000);
