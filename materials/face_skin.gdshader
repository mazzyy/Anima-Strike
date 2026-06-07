shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

// --- Natural human face / skin --------------------------------------------
// Shows the model's ORIGINAL head texture with natural grading so the face
// reads as human, instead of the stylized dark-assassin armor treatment.
// Applied only to the Head_Hands mesh.

uniform sampler2D base_tex : source_color, hint_default_white;
uniform sampler2D normal_tex : hint_normal;

uniform vec3 skin_tint : source_color = vec3(1.0, 0.97, 0.93);
uniform float brightness : hint_range(0.0, 2.0) = 1.08;
uniform float saturation : hint_range(0.0, 2.0) = 1.05;
uniform float roughness_amount : hint_range(0.0, 1.0) = 0.55;
uniform float normal_strength : hint_range(0.0, 2.0) = 0.75;

// Very soft, neutral rim just for silhouette separation (no glowing red).
uniform vec3 rim_color : source_color = vec3(0.5, 0.55, 0.62);
uniform float rim_power : hint_range(0.5, 8.0) = 4.5;
uniform float rim_strength : hint_range(0.0, 2.0) = 0.22;

void fragment() {
	vec3 base = texture(base_tex, UV).rgb;

	// Gentle saturation control around luminance, then warm tint + lift.
	float lum = dot(base, vec3(0.299, 0.587, 0.114));
	base = mix(vec3(lum), base, saturation);
	base *= skin_tint * brightness;
	ALBEDO = clamp(base, 0.0, 1.0);

	NORMAL_MAP = texture(normal_tex, UV).rgb;
	NORMAL_MAP_DEPTH = normal_strength;

	// Skin is dielectric.
	METALLIC = 0.0;
	SPECULAR = 0.4;
	ROUGHNESS = roughness_amount;

	float fres = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), rim_power);
	EMISSION = rim_color * fres * rim_strength;
}
