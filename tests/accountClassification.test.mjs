import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { accountingApiService } from '../src/services/accountingApiService.js';
import { normaliseApiError } from '../src/services/apiError.js';

test('replacement sends an explicit confirmation, reason and target to the scoped API', async t => {
  const calls=[];
  t.mock.method(globalThis, 'fetch', async (url, options) => {calls.push({url, options});return Response.json({id:'new-control'});});
  const result=await accountingApiService.replaceAccountControl('old-control',{replacement_id:'new-control',confirmed:true,reason:'Replace for future posting'});
  assert.equal(result.id,'new-control');assert.ok(calls[0].url.endsWith('/accounts/old-control/replace-control/'));
  assert.deepEqual(JSON.parse(calls[0].options.body),{replacement_id:'new-control',confirmed:true,reason:'Replace for future posting'});
});

test('classification validation messages remain useful in the frontend', async t => {
  const message='This account contains accounting activity. Its account type cannot be changed because doing so could alter historical financial statement presentation.';
  t.mock.method(globalThis, 'fetch', async () => Response.json({account_type:[message]},{status:400}));
  await assert.rejects(accountingApiService.updateAccount('used-account',{account_type:'expense'}),error=>{
    assert.equal(error.status,400);assert.ok(normaliseApiError(error).includes(message));return true;
  });
});

test('account edit exposes server policy, confirmation and historical-balance replacement warnings', () => {
  const source=readFileSync(new URL('../src/components/accounting/AccountFormModal.jsx',import.meta.url),'utf8');
  for(const text of ['classification_policy','can_change_type','can_change_class','classification_confirmed','classification_reason','Historical transactions remain on the old account','Existing balances are not automatically transferred','normaliseApiError'])assert.ok(source.includes(text),text);
});
