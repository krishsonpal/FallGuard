import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel} from '../src/model.mjs';
test('cloud artifact reproduces all six saved Keras predictions on CPU',async()=>{const model=await loadModel();try{assert.equal(model.checks.cases,6);assert.ok(model.checks.maxError<1e-4);assert.throws(()=>model.predict(Array(749).fill(0)));assert.throws(()=>model.predict(Array(750).fill(NaN)));assert.throws(()=>model.predict(Array(750).fill('0')));}finally{model.close();}});
