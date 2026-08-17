// INTERFACE §3.1 设置页入口的 slot 注册
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubject } from './helpers/subject.mjs';
import { SLOT } from './helpers/contract.mjs';

const FULL_CTX = { services: { theme: {}, slots: {} } };

async function started(opts = {}) {
  const h = await createSubject(opts);
  const handle = h.start(FULL_CTX);
  return { h, handle };
}

test('槽位注册_全包只发生一次_register', async () => {
  const { h } = await started();
  assert.equal(h.slotCalls.register.length, 1);
});

test('槽位注册_槽位名精确等于_settings.general.item', async () => {
  const { h } = await started();
  assert.equal(h.slotCalls.register[0].arg.name, 'settings.general.item');
});

test('槽位注册_id精确等于_appearance-gallery', async () => {
  const { h } = await started();
  assert.equal(h.slotCalls.register[0].arg.id, SLOT.id);
  assert.equal(h.slotCalls.register[0].arg.id, 'appearance-gallery');
});

test('槽位注册_id不得沿用旧包id_否则宿主启动抛错', async () => {
  const { h } = await started();
  const id = h.slotCalls.register[0].arg.id;
  assert.notEqual(id, 'theme-gallery');
  assert.notEqual(id, 'skin-gallery');
});

test('槽位注册_order精确等于11', async () => {
  const { h } = await started();
  assert.equal(h.slotCalls.register[0].arg.order, 11);
});

test('槽位注册_order不得占用宿主composer-enter的20', async () => {
  const { h } = await started();
  assert.notEqual(h.slotCalls.register[0].arg.order, SLOT.hostReservedOrder);
});

test('槽位注册_不得传priority字段', async () => {
  const { h } = await started();
  assert.equal('priority' in h.slotCalls.register[0].arg, false);
});

test('槽位注册_register必须发生在inject回调内', async () => {
  const { h } = await started();
  assert.equal(h.slotCalls.register[0].insideInject, true);
  assert.deepEqual(h.slotCalls.inject, ['settings.general.item']);
});

test('槽位注册_前置服务缺失时一次register都不发生', async () => {
  const h = await createSubject();
  h.start({ services: { slots: {} } }); // theme 为 undefined
  assert.equal(h.slotCalls.register.length, 0);
  assert.equal(h.slotCalls.inject.length, 0);
});
