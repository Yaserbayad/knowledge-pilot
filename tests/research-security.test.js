import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { isBlockedAddress, pinnedLookup, readNodeText } from '../src/services/research.js';

const blocked = [
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '::1',
  'fc00::1',
  'fe80::1',
  'ff00::1',
  '2001:db8::1'
];

test('research SSRF guard rejects private, shared, link-local, multicast and reserved addresses', () => {
  for (const address of blocked) {
    assert.equal(isBlockedAddress(address), true, `expected ${address} to be blocked`);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});

test('research request lookup stays pinned to the previously validated address', async () => {
  const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 });
  const result = await new Promise((resolve, reject) => {
    lookup('attacker-controlled.example', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(result, { address: '8.8.8.8', family: 4 });
});

test('research response reader stops once the hard byte limit is crossed', async () => {
  const stream = Readable.from([Buffer.alloc(40), Buffer.alloc(40)]);
  await assert.rejects(
    readNodeText(stream, 64, 'Research source'),
    /exceeds the 64 byte limit/i
  );
  assert.equal(stream.destroyed, true);
});
