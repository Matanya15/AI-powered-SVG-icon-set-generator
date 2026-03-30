(function () {
  const canvas = document.getElementById('dotField');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SPACING = 32;
  const DOT_RADIUS = 1.2;
  const INFLUENCE = 250;
  const PUSH_STRENGTH = 2;
  const SPRING = 0.06;
  const DAMPING = 0.82;

  const BASE_ALPHA = 0.28;
  const ACCENT_R = 255, ACCENT_G = 99, ACCENT_B = 31;

  let dots = [];
  let W, H, cols, rows;
  let mouseX = -9999, mouseY = -9999;
  let rafId = null;

  function buildGrid() {
    W = canvas.width = canvas.offsetWidth * devicePixelRatio;
    H = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const logicalW = canvas.offsetWidth;
    const logicalH = canvas.offsetHeight;
    cols = Math.ceil(logicalW / SPACING) + 1;
    rows = Math.ceil(logicalH / SPACING) + 1;
    const offsetX = (logicalW - (cols - 1) * SPACING) / 2;
    const offsetY = (logicalH - (rows - 1) * SPACING) / 2;

    dots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hx = offsetX + c * SPACING;
        const hy = offsetY + r * SPACING;
        dots.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0 });
      }
    }
  }

  function animate() {
    rafId = requestAnimationFrame(animate);
    if (canvas.offsetParent === null) return;

    const logicalW = canvas.offsetWidth;
    const logicalH = canvas.offsetHeight;
    ctx.clearRect(0, 0, logicalW, logicalH);
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const dx = d.x - mouseX;
      const dy = d.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < INFLUENCE && dist > 0.1) {
        const t = dist / INFLUENCE;
        const force = 4 * t * (1 - t) * (1 - t) * PUSH_STRENGTH;
        d.vx += (dx / dist) * force;
        d.vy += (dy / dist) * force;
      }

      d.vx += (d.hx - d.x) * SPRING;
      d.vy += (d.hy - d.y) * SPRING;
      d.vx *= DAMPING;
      d.vy *= DAMPING;
      d.x += d.vx;
      d.y += d.vy;

      const proximity = dist < INFLUENCE ? (1 - dist / INFLUENCE) : 0;
      const glow = proximity * proximity;
      const alpha = BASE_ALPHA + glow * 0.6;
      const radius = DOT_RADIUS + glow * 1.4;

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ACCENT_R},${ACCENT_G},${ACCENT_B},${alpha})`;
      ctx.fill();
    }
  }

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  }

  function onLeave() {
    mouseX = -9999;
    mouseY = -9999;
  }

  function onResize() {
    buildGrid();
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  window.addEventListener('resize', onResize);

  buildGrid();
  animate();
})();
