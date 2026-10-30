import fs from 'node:fs/promises';
import * as tf from '@tensorflow/tfjs';

export async function loadModel(root = new URL('../model/', import.meta.url)) {
  await tf.setBackend('cpu');
  await tf.ready();
  const read = async name => JSON.parse(await fs.readFile(new URL(name, root), 'utf8'));
  const artifact = await read('model.json');
  const bytes = await fs.readFile(new URL('weights.bin', root));
  const model = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: artifact.modelTopology,
    weightSpecs: artifact.weightsManifest[0].weights,
    weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }));
  const pre = await read('preprocessing.json');
  const scale = tf.tensor1d(pre.scale), offset = tf.tensor1d(pre.offset);
  const predict = samples => {
    if (!Array.isArray(samples) || samples.length !== 750 || samples.some(x => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1000)) {
      throw Object.assign(Error('samples must contain 750 finite raw physical-unit numbers'), {status: 400});
    }
    return tf.tidy(() => {
      const x = tf.tensor3d(samples, [1, 125, 6]);
      const score = model.predict(x.mul(scale).add(offset)).dataSync()[0];
      if (!Number.isFinite(score) || score < 0 || score > 1) throw Error('Invalid CNN output');
      return score;
    });
  };
  const {cases} = await read('reference_cases.json');
  let maxError = 0;
  for (const c of cases) {
    const error = Math.abs(predict(c.raw_input.flat(2)) - c.expected);
    if (error > 1e-4) throw Error(`Model self-check failed: ${c.name}`);
    maxError = Math.max(maxError, error);
  }
  return {predict, checks: {cases: cases.length, maxError}, close() {model.dispose(); scale.dispose(); offset.dispose();}};
}
