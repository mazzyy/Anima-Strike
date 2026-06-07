shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

// --- Modern "dark assassin" reskin -----------------------------------------
// Takes the original Knight textures and reworks them into a desaturated,
// darkened, cohesive assassin palette with metallic armor response and a
// fresnel rim light for that stylized modern edge glow.

uniform sampler2D base_tex : source_color, hint_default_white;
uniform sampler2D normal_tex : hint_normal;
uniform sampler2D spec_tex : hint_default_white;

// Palette / grading
uniform vec3 tint_color : source_color = vec3(0.42, 0.46, 0.55); // cool steel
uniform float desaturation : hint_range(0.0, 1.0) = 0.65;
uniform float darkness : hint_range(0.0, 1.0) = 0.45;
uniform float contrast : hint_range(0.5, 2.0) = 1.18;

// Surface response
uniform float metallic_amount : hint_range(0.0, 1.0) = 0.70;
uniform float roughness_amount : hint_range(0.0, 1.0) = 0.42;
uniform float normal_strength : hint_range(0.0, 2.0) = 1.15;

// Rim / accent
uniform vec3 rim_color : source_color = vec3(0.85, 0.12, 0.14); // assassin crimson
uniform float rim_power : hint_range(0.5, 8.0) = 3.2;
uniform float rim_strength : hint_range(0.0, 4.0) = 1.35;

void fragment() {
	vec3 base = texture(base_tex, UV).rgb;

	// Desaturate toward luminance, then push into the assassin palette.
	float lum = dot(base, vec3(0.299, 0.587, 0.114));
	base = mix(base, vec3(lum), desaturation);

	// Contrast around mid-grey, then darken and tint.
	base = (base - 0.5) * contrast + 0.5;
	base = clamp(base, 0.0, 1.0);
	base *= tint_color;
	base *= (1.0 - darkness);

	ALBEDO = base;

	// Detail from the original normal map.
	NORMAL_MAP = texture(normal_tex, UV).rgb;
	NORMAL_MAP_DEPTH = normal_strength;

	// Specular map drives the metallic / roughness response.
	float spec = texture(spec_tex, UV).r;
	METALLIC = clamp(metallic_amount * (0.55 + 0.55 * spec), 0.0, 1.0);
	ROUGHNESS = clamp(roughness_amount * (1.25 - spec), 0.05, 1.0);

	// Fresnel rim light using view-space normal + view direction.
	float fres = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), rim_power);
	EMISSION = rim_color * fres * rim_strength;
}
