export const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform vec2 u_pan;
uniform float u_zoom;
uniform vec2 u_resolution;
void main() {
    vec2 world = a_pos / u_zoom + u_pan;
    v_uv = world * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
void main() {
    vec2 uv = fract(v_uv); // toroidal wrap
    fragColor = texture(u_tex, uv);
}`;

export const BLOOM_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform vec2 u_texSize;
void main() {
    vec2 uv = fract(v_uv);
    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    vec3 result = texture(u_tex, uv).rgb * weights[0];
    vec2 texel = u_dir / u_texSize;
    for (int i = 1; i < 5; i++) {
        result += texture(u_tex, uv + texel * float(i)).rgb * weights[i];
        result += texture(u_tex, uv - texel * float(i)).rgb * weights[i];
    }
    fragColor = vec4(result, 1.0);
}`;

export const BLOOM_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
