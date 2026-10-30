import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseDevicesJson,parseAllowedOrigins} from '../src/config.mjs';

test('device JSON preserves quoted chat IDs and access keys',()=>{
  const device={device_id:'FallGuard-ESP32-demo',wearer:'Demo',chat_id:'123456',phone_key:'a'.repeat(64),device_key:'b'.repeat(64)};
  assert.deepEqual(parseDevicesJson(JSON.stringify([device])),[device]);
  assert.deepEqual(parseDevicesJson(undefined),[]);
});

test('verified phone-host redirect adds only its exact successor to an existing allowlist',()=>{
  const previous='https://fallguard-mobile.muddynote1024.chatgpt.site';
  const current='https://fallguard-mobile.krishsonpal23.chatgpt.site';
  assert.deepEqual(parseAllowedOrigins(previous),[previous,current]);
  assert.deepEqual(parseAllowedOrigins(previous+','+current),[previous,current]);
  assert.deepEqual(parseAllowedOrigins('https://custom.example'),['https://custom.example']);
  assert.throws(()=>parseAllowedOrigins('*'));
  assert.throws(()=>parseAllowedOrigins(''));
});

test('malformed secret configuration is absent from process startup logs',()=>{
  const marker='private-test-key-that-must-not-appear-in-startup-output';
  const result=spawnSync(process.execPath,['src/server.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,
    env:{...process.env,DEVICES_JSON:`[{"phone_key":${marker}}]`}
  });
  assert.ifError(result.error);
  assert.notEqual(result.status,0);
  const output=result.stdout+result.stderr;
  assert.match(output,/DEVICES_JSON is invalid JSON/);
  assert.doesNotMatch(output,new RegExp(marker));
  assert.doesNotMatch(output,/SyntaxError:/);
});
