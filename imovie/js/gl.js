/* Minimal WebGL helper (GLSL ES 1.00 so it works on WebGL1 and WebGL2 contexts) */
(function (IM) {
  'use strict';

  const QUAD_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
uniform float u_flipY;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  if (u_flipY > 0.5) v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  class GL {
    constructor(canvas, opts) {
      opts = opts || {};
      const attrs = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' };
      let gl = canvas.getContext('webgl2', attrs);
      this.isWebGL2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
      if (!gl) throw new Error('WebGL is not available');
      this.gl = gl;
      this.canvas = canvas;
      this.programs = new Map();
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.quad = buf;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.disable(gl.DEPTH_TEST);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; IM.bus.emit('gl-lost'); });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.programs.clear(); IM.bus.emit('gl-restored'); });
    }
    /** Get/compile a program for fragment source (cached by key). */
    program(key, fsSrc) {
      let p = this.programs.get(key);
      if (p) return p;
      const gl = this.gl;
      const vs = this._shader(gl.VERTEX_SHADER, QUAD_VS, key + ':vs');
      const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc, key);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        console.error('Link error', key, log);
        throw new Error('Program link failed: ' + key);
      }
      p = { prog, uniforms: new Map(), key };
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        const name = info.name.replace(/\[0\]$/, '');
        p.uniforms.set(name, { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size });
      }
      this.programs.set(key, p);
      return p;
    }
    _shader(type, src, key) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error('Shader compile error in', key, '\n', log, '\n', src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
        throw new Error('Shader compile failed: ' + key + ' ' + log);
      }
      return s;
    }
    texture() {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return { tex: t, w: 1, h: 1 };
    }
    upload(t, source, w, h) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        t.w = w || source.videoWidth || source.displayWidth || source.naturalWidth || source.width || 1;
        t.h = h || source.videoHeight || source.displayHeight || source.naturalHeight || source.height || 1;
        return true;
      } catch (e) {
        return false;
      }
    }
    deleteTexture(t) { if (t && t.tex) this.gl.deleteTexture(t.tex); }
    fbo(w, h) {
      const gl = this.gl;
      const t = this.texture();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      t.w = w; t.h = h;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, tex: t.tex, w, h, t };
    }
    deleteFbo(f) { if (!f) return; this.gl.deleteFramebuffer(f.fb); this.gl.deleteTexture(f.tex); }
    /**
     * Draw a full-screen quad with program into target (fbo or null for canvas).
     * textures: {u_name: texObject|fbo}
     */
    draw(prog, target, uniforms, textures, opts) {
      const gl = this.gl;
      opts = opts || {};
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      const w = target ? target.w : gl.drawingBufferWidth, h = target ? target.h : gl.drawingBufferHeight;
      if (opts.viewport) gl.viewport(opts.viewport[0], opts.viewport[1], opts.viewport[2], opts.viewport[3]);
      else gl.viewport(0, 0, w, h);
      gl.useProgram(prog.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      let unit = 0;
      if (textures) {
        for (const name in textures) {
          const u = prog.uniforms.get(name);
          const tx = textures[name];
          if (!u || !tx) continue;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tx.tex);
          gl.uniform1i(u.loc, unit);
          unit++;
        }
      }
      const all = Object.assign({ u_flipY: target ? 0 : 1 }, uniforms || {});
      for (const name in all) {
        const u = prog.uniforms.get(name);
        if (!u) continue;
        const v = all[name];
        switch (u.type) {
          case gl.FLOAT: gl.uniform1f(u.loc, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
          case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v | 0); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
          default: break;
        }
      }
      if (opts.blend) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else gl.disable(gl.BLEND);
      if (opts.clear) {
        const c = opts.clear;
        gl.clearColor(c[0], c[1], c[2], c[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    clear(target, rgba) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : gl.drawingBufferWidth, target ? target.h : gl.drawingBufferHeight);
      gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  IM.GL = GL;
})(window.IM = window.IM || {});
