(function () {
  var canvas = document.getElementById('constellation');
  if (!canvas) return;

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050505, 0.0035);

  var camera = new THREE.PerspectiveCamera(60, 1, 1, 400);
  camera.position.z = 160;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var N = 140;
  var positions = new Float32Array(N * 3);
  var velocities = [];

  for (var i = 0; i < N; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 300;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 300;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    velocities.push({
      x: (Math.random() - 0.5) * 0.15,
      y: (Math.random() - 0.5) * 0.15,
      z: (Math.random() - 0.5) * 0.1
    });
  }

  var particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  var particleMat = new THREE.PointsMaterial({
    color: 0xff631f,
    size: 2.2,
    transparent: true,
    opacity: 0.4,
    sizeAttenuation: true
  });

  scene.add(new THREE.Points(particleGeo, particleMat));

  var MAX_CONN = 500;
  var CONN_DIST = 85;
  var linePositions = new Float32Array(MAX_CONN * 6);
  var lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setDrawRange(0, 0);

  var lineMat = new THREE.LineBasicMaterial({
    color: 0xff631f,
    transparent: true,
    opacity: 0.04
  });

  scene.add(new THREE.LineSegments(lineGeo, lineMat));

  var glowGeo = new THREE.SphereGeometry(8, 32, 32);
  var glowMat = new THREE.MeshBasicMaterial({ color: 0xff631f, transparent: true, opacity: 0.05 });
  var glow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glow);

  var glowGeo2 = new THREE.SphereGeometry(18, 32, 32);
  var glowMat2 = new THREE.MeshBasicMaterial({ color: 0xff631f, transparent: true, opacity: 0.02 });
  var glow2 = new THREE.Mesh(glowGeo2, glowMat2);
  scene.add(glow2);

  var mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', function (e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function onResize() {
    var parent = canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    var h = parent.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  onResize();

  var frame = 0;

  function animate() {
    requestAnimationFrame(animate);
    if (canvas.offsetParent === null) return;
    frame++;

    var pos = particleGeo.attributes.position.array;
    for (var i = 0; i < N; i++) {
      pos[i * 3]     += velocities[i].x;
      pos[i * 3 + 1] += velocities[i].y;
      pos[i * 3 + 2] += velocities[i].z;

      if (Math.abs(pos[i * 3])     > 150) velocities[i].x *= -1;
      if (Math.abs(pos[i * 3 + 1]) > 150) velocities[i].y *= -1;
      if (Math.abs(pos[i * 3 + 2]) > 100) velocities[i].z *= -1;
    }
    particleGeo.attributes.position.needsUpdate = true;

    if (frame % 2 === 0) {
      var idx = 0;
      var lp = lineGeo.attributes.position.array;
      for (var a = 0; a < N && idx < MAX_CONN; a++) {
        for (var b = a + 1; b < N && idx < MAX_CONN; b++) {
          var dx = pos[a * 3]     - pos[b * 3];
          var dy = pos[a * 3 + 1] - pos[b * 3 + 1];
          var dz = pos[a * 3 + 2] - pos[b * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < CONN_DIST * CONN_DIST) {
            var base = idx * 6;
            lp[base]     = pos[a * 3];
            lp[base + 1] = pos[a * 3 + 1];
            lp[base + 2] = pos[a * 3 + 2];
            lp[base + 3] = pos[b * 3];
            lp[base + 4] = pos[b * 3 + 1];
            lp[base + 5] = pos[b * 3 + 2];
            idx++;
          }
        }
      }
      lineGeo.setDrawRange(0, idx * 2);
      lineGeo.attributes.position.needsUpdate = true;
    }

    var t = Date.now() * 0.001;
    glow.scale.setScalar(1 + Math.sin(t * 1.2) * 0.15);
    glow2.scale.setScalar(1 + Math.sin(t * 0.8) * 0.1);

    camera.position.x += (mouseX * 20 - camera.position.x) * 0.02;
    camera.position.y += (-mouseY * 20 - camera.position.y) * 0.02;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
  }

  animate();
})();
