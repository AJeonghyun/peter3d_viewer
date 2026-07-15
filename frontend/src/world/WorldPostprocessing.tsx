import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

export default function WorldPostprocessing() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom intensity={0.5} luminanceThreshold={0.68} luminanceSmoothing={0.3} mipmapBlur />
      <Vignette offset={0.18} darkness={0.52} eskil={false} />
    </EffectComposer>
  );
}
