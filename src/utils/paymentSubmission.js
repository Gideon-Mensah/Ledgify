// One UUID per logical submission. An uncertain network result retains its key.
export function createPaymentSubmission() {
  let signature;
  let key;
  let pending = false;
  return {
    begin(payload) {
      if (pending) return null;
      const nextSignature = JSON.stringify(payload);
      if (nextSignature !== signature) {
        signature = nextSignature;
        key = crypto.randomUUID();
      }
      pending = true;
      return key;
    },
    finish() { pending = false; },
    complete() { pending = false; signature = undefined; key = undefined; },
  };
}
