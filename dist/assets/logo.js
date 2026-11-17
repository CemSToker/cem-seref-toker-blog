const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => { n = clamp(n); return n*n*n*(n*(n*6-15)+10); };

// Three-second assembly, then three seconds still and 1.5 seconds of liquid motion.
function logoFrame(elapsed) {
  if (elapsed < 3000) return { progress: ease(elapsed / 3000), softness: 0, rest: 0 };
  const phase = (elapsed - 3000) % 4500;
  if (phase < 3000) return { progress: 1, softness: 0, rest: 3000 - phase };
  const retreat = Math.sin(Math.PI * (phase - 3000) / 1500) ** 2;
  return { progress: 1 - .2 * retreat, softness: 1.1 * retreat, rest: 0 };
}

function initLanding(root) {
  const events = new AbortController();
  let disposed = false, pendingImage = null;
  const listen = (target, type, callback, options = {}) =>
    target.addEventListener(type, callback, { ...options, signal: events.signal });
  const canvas = root.querySelector('.liquid-mark');
  const fullLogo = root.querySelector('.assembled-logo');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0, playingSince = null, frame = 0;
  let liquid = null, loading = false, failed = false, showingLogo = false;
  const elapsedAt = now => elapsed + (playingSince === null ? 0 : now - playingSince);

  // Derive the transition from the original logo's alpha, including its hole.
  // The last frame is the untouched original image, not a redrawn approximation.
  function logoDistance(image) {
    const size = 512;
    const buffer = document.createElement('canvas');
    buffer.width = buffer.height = size;
    const ctx = buffer.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const alpha = ctx.getImageData(0, 0, size, size).data;
    const inside = new Float32Array(size * size);
    const outside = new Float32Array(size * size);
    for (let i = 0; i < inside.length; i++) {
      const black = alpha[i * 4 + 3] > 127;
      inside[i] = black ? 0 : size * 2;
      outside[i] = black ? size * 2 : 0;
    }
    const diagonal = Math.SQRT2;
    for (const field of [inside, outside]) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
        if (y) {
          field[i] = Math.min(field[i], field[i - size] + 1);
          if (x) field[i] = Math.min(field[i], field[i - size - 1] + diagonal);
          if (x < size - 1) field[i] = Math.min(field[i], field[i - size + 1] + diagonal);
        }
      }
      for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
        const i = y * size + x;
        if (x < size - 1) field[i] = Math.min(field[i], field[i + 1] + 1);
        if (y < size - 1) {
          field[i] = Math.min(field[i], field[i + size] + 1);
          if (x) field[i] = Math.min(field[i], field[i + size - 1] + diagonal);
          if (x < size - 1) field[i] = Math.min(field[i], field[i + size + 1] + diagonal);
        }
      }
    }
    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < inside.length; i++) {
      const signed = (inside[i] - outside[i]) * 1600 / size;
      const encoded = Math.round(clamp(.5 + signed / 840) * 65535);
      pixels[i * 4] = encoded >> 8;
      pixels[i * 4 + 1] = encoded & 255;
      pixels[i * 4 + 3] = 255;
    }
    return { size, pixels };
  }

  function createLiquid(image) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL is unavailable');
    const vertex = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * .5 + .5;
        gl_Position = vec4(a_position, 0., 1.);
      }`;
    const fragment = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_logo;
      uniform vec2 u_size;
      uniform float u_progress;
      uniform float u_time;
      float smoothUnion(float a, float b, float k) {
        float h = clamp(.5 + .5 * (b - a) / k, 0., 1.);
        return mix(b, a, h) - k * h * (1. - h);
      }
      vec2 cellCenter(vec2 from, vec2 to, float seed, float travel, float life) {
        float t = u_time + u_progress * 3.;
        vec2 center = mix(from, to, travel);
        center += vec2(sin(t * .64 + seed), cos(t * .53 + seed * 1.73)) * 38. * life;
        // Each fragment curls toward the mass on its own path, then settles.
        vec2 path = to - from;
        vec2 sideways = vec2(-path.y, path.x) / max(length(path), 1.);
        center += sideways * sin(t * .92 + seed * 1.9) * 62. * (4. * travel * (1. - travel)) * life;
        return center;
      }
      float body(vec2 p, vec2 from, vec2 to, float radius, float finalRadius, float seed, float travel, float life) {
        float t = u_time + u_progress * 3.;
        vec2 center = cellCenter(from, to, seed, travel, life);
        vec2 q = p - center;
        float turn = .22 * sin(t * .35 + seed);
        q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * q;
        q *= vec2(1. + .16 * sin(seed * 2.), 1. - .16 * sin(seed * 2.));
        float r = mix(radius, finalRadius, travel);
        // The membrane ripples locally while longer pseudopods reach outward.
        q += vec2(sin(q.y * .014 + t * .88 + seed), sin(q.x * .013 - t * .76)) * r * .065 * life;
        float a = atan(q.y, q.x);
        float lobe = .14 * sin(a * 3. + seed + t * .7)
                   + .09 * sin(a * 2. - t * .48 + seed * 2.)
                   + .055 * cos(a * 5. + t * .56);
        float finger = .49 * pow(.5 + .5 * cos(a * 3. + seed - t * .38), 10.)
                     + .10 * pow(.5 + .5 * sin(a * 5. - seed + t * .52), 12.);
        float pulse = 1. + .045 * sin(t * 1.1 + seed) * life;
        return length(q) - r * pulse * (1. + (lobe + finger) * life);
      }
      float tendril(vec2 p, vec2 from, vec2 toward, float growth, float seed, float life) {
        vec2 tip = mix(from, toward, growth);
        vec2 axis = tip - from;
        float extent = max(length(axis), 1.);
        vec2 along = axis / extent;
        vec2 normal = vec2(-along.y, along.x);
        float h = clamp(dot(p - from, along) / extent, 0., 1.);
        float t = u_time + u_progress * 3.;
        float arch = sin(h * 3.14159265);
        float bend = sin(seed + t * .58) * 78. + sin(h * 6.2831853 + seed + t * .8) * 24.;
        vec2 spine = from + axis * h + normal * arch * bend * life;
        float neck = .28 + .72 * pow(abs(2. * h - 1.), 1.4);
        float radius = mix(10., 33., smoothstep(.12, .55, u_progress)) * neck * life;
        radius *= 1. + .16 * sin(h * 10. - t * 1.7 + seed) * life;
        return length(p - spine) - radius;
      }
      void main() {
        vec2 uv = vec2(v_uv.x, 1. - v_uv.y);
        vec2 p = (uv - .5) * u_size / min(u_size.x, u_size.y) * 2240. + 800.;
        float travel = smoothstep(.04, .68, u_progress);
        float morph = smoothstep(.39, .96, u_progress);
        float life = 1. - smoothstep(.40, .95, u_progress);
        float k = mix(76., 132., travel);
        float d = body(p, vec2(520.,220.), vec2(895.,480.), 195.,245., 1.1,travel,life);
        d = smoothUnion(d, body(p,vec2(1280.,495.),vec2(1190.,810.),180.,200., 2.6,travel,life), k);
        d = smoothUnion(d, body(p,vec2(1410.,1110.),vec2(1200.,1120.),135.,145., 4.1,travel,life), k);
        d = smoothUnion(d, body(p,vec2(735.,1410.),vec2(850.,1180.),205.,245., 5.5,travel,life), k);
        d = smoothUnion(d, body(p,vec2(185.,870.),vec2(455.,855.),195.,210., 7.0,travel,life), k);
        d = smoothUnion(d, body(p,vec2(785.,805.),vec2(925.,925.),108.,245., 8.4,travel,life), k);
        d = smoothUnion(d, body(p,vec2(1125.,135.),vec2(965.,600.),43.,28., 9.8,travel,life), k * .8);
        d = smoothUnion(d, body(p,vec2(120.,405.),vec2(590.,865.),52.,28.,11.2,travel,life), k * .8);
        d = smoothUnion(d, body(p,vec2(1270.,1450.),vec2(1110.,1110.),37.,25.,12.5,travel,life), k * .8);
        // Smaller fragments trail the original six bodies and are absorbed
        // on staggered paths, keeping the silhouette open until it assembles.
        float fragments = smoothstep(.09,.73,u_progress);
        d = smoothUnion(d, body(p,vec2(875.,60.),vec2(920.,520.),40.,20.,13.7,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(1515.,135.),vec2(1135.,690.),57.,23.,15.2,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(1560.,745.),vec2(1190.,880.),43.,22.,16.8,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(1590.,1370.),vec2(1200.,1130.),52.,22.,18.3,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(270.,1540.),vec2(700.,1140.),60.,25.,19.9,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(70.,1240.),vec2(600.,950.),41.,20.,21.4,fragments,life), k * .5);
        d = smoothUnion(d, body(p,vec2(430.,570.),vec2(785.,820.),36.,18.,23.1,fragments,life), k * .5);
        // Staggered, curved liquid necks grow between cells before they fuse.
        // They disappear into the same silhouette field as the blobs.
        vec2 hub = cellCenter(vec2(785.,805.),vec2(925.,925.),8.4,travel,life);
        if (u_progress > .03 && u_progress < .95) {
          vec2 cell = cellCenter(vec2(185.,870.),vec2(455.,855.),7.,travel,life);
          d = smoothUnion(d,tendril(p,cell,hub,smoothstep(.03,.37,u_progress),1.2,life),48. * life + 6.);
          cell = cellCenter(vec2(520.,220.),vec2(895.,480.),1.1,travel,life);
          d = smoothUnion(d,tendril(p,cell,hub,smoothstep(.08,.43,u_progress),3.5,life),48. * life + 6.);
          cell = cellCenter(vec2(1280.,495.),vec2(1190.,810.),2.6,travel,life);
          d = smoothUnion(d,tendril(p,cell,hub,smoothstep(.13,.47,u_progress),5.2,life),48. * life + 6.);
          cell = cellCenter(vec2(735.,1410.),vec2(850.,1180.),5.5,travel,life);
          d = smoothUnion(d,tendril(p,cell,hub,smoothstep(.17,.50,u_progress),7.1,life),48. * life + 6.);
          // Fine feelers reach back for stragglers before the larger mass
          // swallows them; all detail dissolves into the exact logo field.
          vec2 satellite = cellCenter(vec2(270.,1540.),vec2(700.,1140.),19.9,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.14,.46,u_progress),9.2,life) + 3. * life,28. * life + 6.);
          cell = cellCenter(vec2(1280.,495.),vec2(1190.,810.),2.6,travel,life);
          satellite = cellCenter(vec2(1515.,135.),vec2(1135.,690.),15.2,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.19,.51,u_progress),11.6,life) + 3. * life,28. * life + 6.);
          cell = cellCenter(vec2(185.,870.),vec2(455.,855.),7.,travel,life);
          satellite = cellCenter(vec2(70.,1240.),vec2(600.,950.),21.4,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.24,.56,u_progress),14.3,life) + 3. * life,28. * life + 6.);
          cell = cellCenter(vec2(1280.,495.),vec2(1190.,810.),2.6,travel,life);
          satellite = cellCenter(vec2(1560.,745.),vec2(1190.,880.),16.8,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.10,.42,u_progress),16.7,life) + 4. * life,23. * life + 6.);
          cell = cellCenter(vec2(520.,220.),vec2(895.,480.),1.1,travel,life);
          satellite = cellCenter(vec2(875.,60.),vec2(920.,520.),13.7,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.21,.53,u_progress),19.1,life) + 4. * life,23. * life + 6.);
          cell = cellCenter(vec2(1410.,1110.),vec2(1200.,1120.),4.1,travel,life);
          satellite = cellCenter(vec2(1590.,1370.),vec2(1200.,1130.),18.3,fragments,life);
          d = smoothUnion(d,tendril(p,cell,satellite,smoothstep(.18,.49,u_progress),21.8,life) + 4. * life,23. * life + 6.);
        }
        vec2 samplePoint = clamp(p / 1600., 0., 1.);
        vec2 encoded = texture2D(u_logo, samplePoint).rg;
        float exact = (dot(encoded, vec2(256. / 257., 1. / 257.)) - .5) * 840.;
        exact += length(p - clamp(p, vec2(0.), vec2(1600.)));
        d = mix(d, exact, morph);
        float pixel = 2240. / min(u_size.x, u_size.y);
        float alpha = 1. - smoothstep(-pixel * .8, pixel * .8, d);
        gl_FragColor = vec4(0., 0., 0., alpha);
      }`;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment)];
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.useProgram(program);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const { size, pixels } = logoDistance(image);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.uniform1i(gl.getUniformLocation(program, 'u_logo'), 0);
    const uniforms = Object.fromEntries(['size', 'progress', 'time'].map(key => [key, gl.getUniformLocation(program, 'u_' + key)]));
    return {
      dispose() {
        gl.deleteTexture(texture);
        gl.deleteBuffer(vertices);
        gl.deleteProgram(program);
      },
      resize() {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uniforms.size, canvas.width, canvas.height);
      },
      draw(value, time) {
        gl.uniform1f(uniforms.progress, value);
        gl.uniform1f(uniforms.time, time);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    };
  }

  function initLiquid() {
    if (liquid || loading || failed || reducedMotion.matches) return;
    loading = true;
    const image = new Image();
    pendingImage = image;
    image.onload = () => {
      if (disposed) return;
      try {
        liquid = createLiquid(image);
        liquid.resize();
      } catch (error) {
        failed = true;
        console.warn('Showing the original logo because liquid rendering is unavailable.', error);
      }
      loading = false;
      update();
    };
    image.onerror = () => { loading = false; failed = true; update(); };
    image.src = root.querySelector('#original-mark').getAttribute('href');
  }
  function render(value, softness = 0, time = 0) {
    const whole = reducedMotion.matches || !liquid ? 1 : ease((value - .97) / .025);
    // Keep the animation clock alive during holds without redrawing the PNG.
    if (whole >= 1 && showingLogo) return;
    showingLogo = whole >= 1;
    fullLogo.setAttribute('opacity', whole.toFixed(3));
    canvas.style.opacity = whole >= 1 ? '0' : '1';
    canvas.style.filter = softness > 0 ? `blur(${softness.toFixed(3)}px)` : 'none';
    if (liquid && whole < 1) liquid.draw(value, time / 1000);
  }
  function stopClock() {
    if (playingSince !== null) elapsed = elapsedAt(performance.now());
    playingSince = null;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function tick(now) {
    frame = 0;
    if (disposed || playingSince === null) return;
    const time = elapsedAt(now);
    const state = logoFrame(time);
    render(state.progress, state.softness, time);
    // One continuous frame loop; every hold leads straight into the next cycle.
    frame = requestAnimationFrame(tick);
  }
  function update() {
    if (disposed) return;
    const staticLogo = reducedMotion.matches || failed || !liquid;
    if (staticLogo) stopClock();
    if (staticLogo) render(1);
    else {
      if (playingSince === null) playingSince = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
    }
  }
  function measure() {
    if (disposed) return;
    if (liquid) {
      liquid.resize();
      const time = elapsedAt(performance.now());
      const state = logoFrame(time);
      render(state.progress, state.softness, time);
    }
    initLiquid();
    update();
  }
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault(); liquid = null; failed = true; update();
  });
  listen(canvas, 'webglcontextrestored', () => { failed = false; initLiquid(); });
  listen(window, 'scroll', update, { passive: true });
  listen(window, 'resize', measure, { passive: true });
  listen(window, 'pageshow', measure);
  listen(reducedMotion, 'change', measure);
  listen(document, 'visibilitychange', update);
  measure();
  return () => {
    disposed = true;
    events.abort();
    stopClock();
    if (pendingImage) pendingImage.onload = pendingImage.onerror = null;
    if (liquid) liquid.dispose();
  };
}

if(document.querySelector(".emblem")) initLanding(document.body);
