import test from 'node:test';
import assert from 'node:assert/strict';
import { newOnboarding, changeOnboardingCountry, validateOnboardingStep } from '../src/utils/onboarding.js';
import { readIdentityLink, clearIdentityLink } from '../src/utils/identityLinks.js';

test('Ghana recommendations never silently activate registrations',()=>{
 const form=newOnboarding('2026-09-19');
 assert.equal(form.base_currency,'GHS');assert.equal(form.timezone,'Africa/Accra');
 assert.equal(form.tax_structure,'GHANA_GRA');assert.equal(form.activate_tax,false);
 assert.equal(form.registration.vat_registered,false);assert.equal(form.regional_confirmed,false);
 assert.equal(form.legal_name,'');assert.equal(form.address_line_1,'');
});
test('country changes clear Ghana obligations and require regional review',()=>{
 const old={...newOnboarding('2026-09-19'),activate_tax:true,tax_confirmation:true,regional_confirmed:true,registration:{vat_registered:true}};
 const gb=changeOnboardingCountry(old,'GB',{GB:{base_currency:'GBP',timezone:'Europe/London',locale:'en-GB',tax_structure:'CUSTOM_INTERNATIONAL'}});
 assert.equal(gb.base_currency,'GBP');assert.equal(gb.chart,'general');assert.equal(gb.registration.vat_registered,false);assert.equal(gb.activate_tax,false);assert.equal(gb.regional_confirmed,false);
 const unknown=changeOnboardingCountry(old,'KE',{});assert.equal(unknown.base_currency,'');assert.equal(unknown.timezone,'');assert.equal(unknown.tax_structure,'CUSTOM_INTERNATIONAL');
 assert.equal(old.activate_tax,true);
});
test('wizard catches missing identity, reversed dates and unconfirmed tax activation',()=>{
 const form=newOnboarding('2026-09-19');assert.ok(validateOnboardingStep(1,form).legal_name);assert.ok(validateOnboardingStep(2,form).regional_confirmed);
 assert.deepEqual(validateOnboardingStep(3,form),{});
 assert.ok(validateOnboardingStep(3,{...form,first_year_end:'2025-01-01'}).first_year_end);
 const invalid={...form,activate_tax:true,registration:{vat_registered:true}};
 const errors=validateOnboardingStep(5,invalid);for(const key of ['tin','vat_registration_number','vat_effective_from','tax_confirmation'])assert.ok(errors[key]);
});
test('identity fragments are removed from browser URL without browser storage',()=>{
 clearIdentityLink();let replaced;
 const history={replaceState(...args){replaced=args;}};
 assert.equal(readIdentityLink({pathname:'/verify-email',hash:'#token=synthetic-secret'},history),'synthetic-secret');
 assert.deepEqual(replaced,[null,'','/verify-email']);
 assert.equal(readIdentityLink({pathname:'/verify-email',hash:''},history),'synthetic-secret');
 assert.equal(readIdentityLink({pathname:'/accept-invitation',hash:''},history),'');
 clearIdentityLink();assert.equal(readIdentityLink({pathname:'/verify-email',hash:''},history),'');
});
