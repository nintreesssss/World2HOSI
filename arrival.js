import { dyno } from '@sparkjsdev/spark';

// Display-only world-space offset. At progress=1 every splat is exactly unmodified.
export const arrivalProgress = dyno.dynoFloat(0);
export function arrivalModifier() {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const node = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, progress: 'float' }, outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, progress: arrivalProgress }, globals: () => [dyno.defineGsplat],
      statements: ({ inputs, outputs }) => [`
        ${outputs.gsplat} = ${inputs.gsplat};
        if (${inputs.progress} < 1.0) {
          float seed = float(${inputs.gsplat}.index);
          vec3 hash = fract(sin(vec3(seed * 0.1031 + 1.7, seed * 0.11369 + 8.3, seed * 0.13787 + 4.1)) * 43758.5453);
          float delay = hash.z * 0.14;
          float t = clamp((${inputs.progress} - delay) / (1.0 - delay), 0.0, 1.0);
          float remaining = pow(1.0 - t, 3.0);
          vec3 radial = ${inputs.gsplat}.center - vec3(7.3, 5.2, 0.7);
          vec3 direction = normalize(radial + (hash - 0.5) * 2.0 + vec3(0.001));
          ${outputs.gsplat}.center += direction * (3.0 + 7.0 * hash.x) * remaining;
          ${outputs.gsplat}.scales = mix(vec3(0.003), ${inputs.gsplat}.scales, smoothstep(0.3, 0.94, t));
          ${outputs.gsplat}.rgba.a *= smoothstep(0.0, 0.16, t) * mix(0.18, 1.0, smoothstep(0.3, 0.88, t));
        }
      `]
    });
    return { gsplat: node.outputs.gsplat };
  });
}
