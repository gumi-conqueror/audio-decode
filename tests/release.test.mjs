import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { selectRun, verifyPackage } from '../scripts/release.mjs';

test('only the latest successful push build of the exact main commit can be promoted', () => {
  const run = {
    id: 1,
    head_sha: 'abc',
    head_branch: 'main',
    event: 'push',
    run_number: 5,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
  };
  assert.equal(selectRun([run], 'abc'), run);
  for (const change of [
    { head_sha: 'other' },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
  ]) {
    assert.throws(() => selectRun([{ ...run, ...change }], 'abc'));
  }
  assert.throws(() =>
    selectRun([run, { ...run, id: 2, run_number: 6, conclusion: 'failure' }], 'abc'),
  );
});

test('release rejects mismatched identity, lockfile, filename and archive bytes', () => {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const lock = Buffer.from('locked dependencies');
  const bytes = Buffer.from('tested archive');
  const filename = 'gumi-conqueror-audio-decode-0.1.0.tgz';
  const info = {
    version: '0.1.0',
    commit: 'abc',
    dirty: false,
    profile: 'release',
    target: 'wasm32-unknown-unknown',
    lockSha256: hash(lock),
  };
  const input = {
    tag: 'v0.1.0',
    commit: 'abc',
    lock,
    info,
    checksums: `${hash(bytes)}  ${filename}\n`,
    bytes,
  };
  assert.equal(verifyPackage(input), filename);
  for (const change of [
    { version: '0.1.1' },
    { commit: 'other' },
    { dirty: true },
    { profile: 'debug' },
    { target: 'native' },
    { lockSha256: 'different' },
  ]) {
    assert.throws(() => verifyPackage({ ...input, info: { ...info, ...change } }));
  }
  for (const change of [
    { tag: 'latest' },
    { lock: Buffer.from('updated') },
    { bytes: Buffer.from('modified') },
    { checksums: `${hash(bytes)}  ../other.tgz` },
  ]) {
    assert.throws(() => verifyPackage({ ...input, ...change }));
  }
});
