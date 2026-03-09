export function compileShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}

export function createProgram(gl, vSrc, fSrc) {
    const v = compileShader(gl, vSrc, gl.VERTEX_SHADER);
    const f = compileShader(gl, fSrc, gl.FRAGMENT_SHADER);
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Program error:', gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}
