import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingApiService } from '../src/services/accountingApiService.js';

function session(t) {
  const stored = JSON.stringify({ accessToken: 'synthetic-token', selectedOrganisation: { id: 'test-organisation', base_currency: 'GHS' } });
  t.mock.method(globalThis, 'fetch');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored } });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : delete globalThis.localStorage);
}

test('account template download, multipart preview and confirmation preserve workbook bytes and organisation', async (t) => {
  session(t);
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 128]);
  const calls = [];
  globalThis.fetch.mock.mockImplementation(async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers['X-Organisation-ID'], 'test-organisation');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    if (url.endsWith('/template/')) return new Response(bytes, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    return Response.json(url.endsWith('/preview/') ? { id: 'preview-batch', valid_rows: 2 } : { status: 'completed' });
  });
  const downloaded = await accountingApiService.downloadAccountImportTemplate();
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  const file = new File([downloaded], 'Ledgify_Chart_of_Accounts_Import_Template (2).xlsx');
  const preview = await accountingApiService.previewAccountImport(file);
  assert.equal(preview.valid_rows, 2);
  assert.equal(calls[1].body.get('file').name, file.name);
  assert.deepEqual(new Uint8Array(await calls[1].body.get('file').arrayBuffer()), bytes);
  assert.equal(calls[1].body.get('import_mode'), 'stop_on_existing');
  assert.deepEqual([...calls[1].body.keys()], ['file', 'import_mode']);
  assert.equal(calls[1].headers['Content-Type'], undefined);
  assert.equal((await accountingApiService.confirmAccountImport(preview.id)).status, 'completed');
  assert.ok(calls[0].url.endsWith('/accounts/import/template/'));
  assert.ok(calls[1].url.endsWith('/accounts/import/preview/'));
  assert.ok(calls[2].url.endsWith('/accounts/import/preview-batch/confirm/'));
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'POST']);
  assert.equal(calls[2].body, '{}');
});

test('unsupported template preview preserves the backend helpful error', async (t) => {
  session(t);
  const message = 'This import template is no longer supported. Download the latest template and try again.';
  globalThis.fetch.mock.mockImplementation(async () => Response.json([message], { status: 400 }));
  await assert.rejects(accountingApiService.previewAccountImport(new File(['old'], 'old.xlsx')), error => {
    assert.equal(error.status, 400);
    assert.deepEqual(error.data, [message]);
    return true;
  });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});
