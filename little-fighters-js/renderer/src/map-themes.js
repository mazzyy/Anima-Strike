/**
 * The four stages' art: colours, fog, atmosphere, light rigs, decor.
 *
 * Split out of config.js so a lighting or set-dressing change need not
 * reproduce the gameplay configuration. Imports remain one-way.
 * Only the atmospheric specification authors the sun; key lights are derived.
 */

import { MAP_ART } from './config.js';
import { getSunLight } from './sky.js';

export const MAP_THEMES = [
  {
    id: 'dojo', name: 'Lantern Dojo',
    floorColor: 0x382113, skyColor: 0x24150e,
    sky: {
      elevation: 14, azimuth: 215,
      turbidity: 4, rayleigh: 2.2,
      mieCoefficient: 0.005, mieDirectionalG: 0.8,
    },
    fog: { color: 0x392719, near: 80, far: 180 },
    roughness: 0.85, metalness: 0, boundaryColor: 0xe6b46b,
    grade: {
      bloom: { strength: 0.38, radius: 0.65, threshold: 1.05 },
      exposure: 1.05, vignette: 0.22, saturation: -0.06,
      tint: [1.08, 1.01, 0.9], contrast: 0.94,
    },
    lights: [
      { type: 'hemisphere', color: 0xffdda5, groundColor: 0x39221a, intensity: 1.1 },
      { type: 'directional', color: 0xa6b5d4, intensity: 0.6, position: [-5, 6, -6] },
    ],
    decor: {
      woodColors: [0x85502b, 0x975f34, 0xa76b3c, 0x754525],
      boardWidth: 0.5, boardLength: 3, boardThickness: 0.08, boardGap: 0.018,
      frameColor: 0x362017, paperColor: 0xe8d8b7, paperGlow: 0.12,
      screenSpacing: 2.3, screenZ: -MAP_ART.floorDepth / 2,
      screenWidth: 2.26, screenHeight: 3.6, screenColumns: 3, screenRows: 4,
      frameWidth: 0.065,
      lanternColor: 0xffb95b, lanternGlow: 2.2, lanternSpacing: 4.5,
      lanternY: 3.6, lanternZ: -MAP_ART.floorDepth / 2 + 0.3,
      lanternRadius: 0.36, cordLength: 1.0, cordWidth: 0.025,
      capScale: 0.42, capHeight: 0.08, lightIntensity: 8, lightDistance: 7,
    },
  },
  {
    id: 'neon-street', name: 'Neon Street',
    floorColor: 0x151c29, skyColor: 0x030611,
    sky: {
      elevation: -18, azimuth: 225,
      turbidity: 2, rayleigh: 1.2,
      mieCoefficient: 0.003, mieDirectionalG: 0.8,
    },
    fog: { color: 0x0c1027, near: 80, far: 180 },
    roughness: 0.18, metalness: 0.45, boundaryColor: 0x6fe7ff,
    grade: {
      bloom: { strength: 1.25, radius: 0.5, threshold: 0.72 },
      exposure: 1.0, vignette: 0.3, saturation: 0.16,
      tint: [1.02, 0.97, 1.08], contrast: 1.06,
    },
    lights: [
      { type: 'hemisphere', color: 0x6f8dcc, groundColor: 0x101327, intensity: 0.85 },
      { type: 'directional', color: 0xff55cb, intensity: 0.85, position: [-5, 6, -6] },
    ],
    decor: {
      buildingColor: 0x151a29, buildingZ: -MAP_ART.floorDepth / 2 - 0.6,
      buildingHeight: 6, buildingWidth: 3.5, buildingDepth: 0.8,
      signSpacing: 3.8, signColors: [0xff329e, 0x27dbff, 0xb983ff],
      signBackingColor: 0x080a13, signY: 2.7,
      signZ: -MAP_ART.floorDepth / 2 - 0.12,
      signWidth: 2.2, signHeight: 1.25, signDepth: 0.08,
      signGlow: 3, signRoughness: 0.35, strokeWidth: 0.055,
      glyphCount: 3, glyphSpacing: 0.55, glyphHeight: 0.65, glyphWidth: 0.3,
      lightIntensity: 18, lightDistance: 9, lightOffset: 0.55,
      reflectionRows: 24, reflectionStartZ: -MAP_ART.floorDepth / 2 + 0.7,
      reflectionLength: MAP_ART.floorDepth - 1.4,
      reflectionOpacity: 0.3, reflectionJitter: 0.32,
      reflectionMinWidth: 0.3, reflectionWidthRange: 0.7, reflectionStripDepth: 0.13,
      curbColor: 0x424557, curbWidth: 0.65, curbHeight: 0.2,
      curbLength: 1.2, curbGap: 0.035,
      puddleColor: 0x28415d, puddleRoughness: 0.06, puddleMetalness: 0.65,
      puddleOpacity: 0.3, puddleArea: 8, puddleWidth: 0.7, puddleDepth: 0.3,
    },
  },
  {
    id: 'temple-courtyard', name: 'Dusk Temple',
    floorColor: 0x343640, skyColor: 0x55405f,
    sky: {
      elevation: 2, azimuth: 200,
      turbidity: 5, rayleigh: 3,
      mieCoefficient: 0.006, mieDirectionalG: 0.85,
    },
    fog: { color: 0x695b78, near: 80, far: 180 },
    roughness: 0.92, metalness: 0.03, boundaryColor: 0xd7b18a,
    grade: {
      bloom: { strength: 0.18, radius: 0.8, threshold: 1.2 },
      exposure: 1.08, vignette: 0.12, saturation: -0.24,
      tint: [1.06, 1.01, 0.92], contrast: 0.8,
    },
    lights: [
      { type: 'hemisphere', color: 0xbaacd7, groundColor: 0x343440, intensity: 1.15 },
      { type: 'directional', color: 0x999fff, intensity: 0.8, position: [5, 6, -6] },
    ],
    decor: {
      colors: [0x73737c, 0x85818a, 0x676b76, 0x8b8587],
      tileSize: 1.2, gap: 0.035, thickness: 0.1,
      pillarColor: 0x9c9290, trimColor: 0x6e6670,
      pillarSpacing: 4.5, pillarZ: -MAP_ART.floorDepth / 2 - 0.3,
      sidePillarZs: [-3.8, 0, 3.8], pillarRadius: 0.3, pillarHeight: 3.4,
      baseWidth: 0.95, baseHeight: 0.3, capHeight: 0.22,
      steps: 3, stepsSpacing: 8, stepsZ: -MAP_ART.floorDepth / 2 - 1.4,
      stepsWidth: 5.8, stepsHeight: 0.18, stepsDepth: 1.5, stepHeight: 0.18,
      stepDepth: 0.3, stepInset: 0.5,
    },
  },
  {
    id: 'rooftop', name: 'Highline Rooftop',
    floorColor: 0x363e4c, skyColor: 0x101d3a,
    sky: {
      elevation: -4, azimuth: 240,
      turbidity: 2, rayleigh: 2.5,
      mieCoefficient: 0.004, mieDirectionalG: 0.8,
    },
    fog: { color: 0x283d65, near: 65, far: 160 },
    roughness: 0.93, metalness: 0.03, boundaryColor: 0xb8c9de,
    grade: {
      bloom: { strength: 0.42, radius: 0.7, threshold: 1.1 },
      exposure: 1.18, vignette: 0.08, saturation: -0.12,
      tint: [0.9, 1.01, 1.13], contrast: 0.98,
    },
    lights: [
      { type: 'hemisphere', color: 0x799bd9, groundColor: 0x18243c, intensity: 0.95 },
      { type: 'directional', color: 0x91bce8, intensity: 0.45, position: [-5, 6, -6] },
    ],
    decor: {
      colors: [0x656b75, 0x606773, 0x707580],
      tileSize: 3, gap: 0.026, thickness: 0.08,
      parapetColor: 0x717781, parapetInset: 0.3,
      parapetHeight: 0.55, parapetWidth: 0.28,
      cityColor: 0x172132, cityZ: -MAP_ART.floorDepth / 2 - 7,
      cityDepth: 8, cityBaseY: -6, towerSpacing: 2.25,
      towerWidth: 1.8, towerDepth: 1.8, towerMinHeight: 6, towerHeightRange: 9,
      windowColors: [0xffd59a, 0x91bce8, 0xe6edff],
      windowColumns: 3, windowSpacingX: 0.42, windowSpacingY: 0.7,
      windowWidth: 0.14, windowHeight: 0.24, unlitFraction: 0.5,
      equipmentColor: 0x4c5666, equipmentSpacing: 5.5,
      equipmentZ: -MAP_ART.floorDepth / 2 - 1.4,
      equipmentWidth: 1.1, equipmentHeight: 0.9, equipmentDepth: 0.9,
      ventColor: 0x232c39, ventCount: 4, ventHeight: 0.035, ventWidthScale: 0.8,
    },
  },
].map((theme) => ({
  ...theme,
  lights: [
    theme.lights[0],
    // addLighting applies lightDistanceScale to shadow-casting lights.
    // Centre the shadow frustum along the actual sun ray, without changing
    // its elevation just to improve shadow coverage.
    getSunLight(
      theme.sky,
      MAP_ART.shadow.far / (2 * MAP_ART.shadow.lightDistanceScale),
    ),
    ...theme.lights.slice(1),
  ],
}));
