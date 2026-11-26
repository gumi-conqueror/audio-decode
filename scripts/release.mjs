import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stable release tags; the package version is the tag without its `v`. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
/** `npm pack` derives this name from the package name `@gumi-conqueror/audio-decode`. */
export function packageFilename(version) {
  return `gumi-conqueror-audio-decode-${version}.tgz`;
}

// A tag promotes a successful main build. PR artifacts and rebuilt tag artifacts are ineligible.
export function selectRun(runs, commit) {
  const run = runs
    .filter(
      (item) => item.head_sha === commit && item.head_branch === 'main' && item.event === 'push',
    )
    .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  assert.ok(run, 'No main push build exists for this commit');
  assert.equal(run.status, 'completed', 'Wait for the main build to finish');
  assert.equal(run.conclusion, 'success', 'The latest main build must pass all jobs');
  return run;
}

export function verifyPackage({ tag, commit, lock, info, checksums, bytes }) {
  assert.match(tag, RELEASE_TAG, 'Use a stable vMAJOR.MINOR.PATCH tag');
  assert.equal(info.version, tag.slice(1), 'Package and tag versions differ');
  assert.equal(info.commit, commit, 'Package was built from another commit');
  assert.equal(info.dirty, false, 'Package was built from a dirty checkout');
  assert.equal(info.profile, 'release');
  assert.equal(info.target, 'wasm32-unknown-unknown');
  assert.equal(
    info.lockSha256,
    createHash('sha256').update(lock).digest('hex'),
    'Cargo lockfile differs',
  );
  const filename = packageFilename(info.version);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(checksums.trim(), `${hash}  ${filename}`, 'Package checksum or filename differs');
  return filename;
}

function main() {
  const capture = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim();
  const repository = process.env.GITHUB_REPOSITORY;
  const tag = process.env.GITHUB_REF_NAME;
  assert.ok(repository && tag, 'Run this script in the tag release workflow');
  assert.match(tag, RELEASE_TAG);
  const commit = capture('git', ['rev-parse', 'HEAD']);
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);

  if (process.argv[2] === 'select') {
    const api = (endpoint) => JSON.parse(capture('gh', ['api', `repos/${repository}/${endpoint}`]));
    const { workflow_runs: runs } = api(
      `actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${commit}&per_page=100`,
    );
    const run = selectRun(runs, commit);
    const { artifacts } = api(`actions/runs/${run.id}/artifacts?per_page=100`);
    const matches = artifacts.filter((item) => item.name === `wasm-${commit}` && !item.expired);
    assert.equal(
      matches.length,
      1,
      'Expected one unexpired WASM artifact; rerun the main build if expired',
    );
    assert.ok(process.env.GITHUB_OUTPUT);
    appendFileSync(process.env.GITHUB_OUTPUT, `run-id=${run.id}\nartifact-id=${matches[0].id}\n`);
  } else if (process.argv[2] === 'publish') {
    const info = JSON.parse(readFileSync('release/build-info.json', 'utf8'));
    // Derive the input path from the validated tag, never from downloaded metadata.
    const filename = packageFilename(tag.slice(1));
    const archive = `release/${filename}`;
    verifyPackage({
      tag,
      commit,
      info,
      lock: readFileSync('Cargo.lock'),
      checksums: readFileSync('release/SHA256SUMS', 'utf8'),
      bytes: readFileSync(archive),
    });
    assert.deepEqual(
      JSON.parse(capture('tar', ['-xOf', archive, 'package/build-info.json'])),
      info,
      'The package must contain the same build identity as the release manifest',
    );
    const notes =
      `Symphonia audio decoder ${tag.slice(1)}.\n\n` +
      'Native Rust and prebuilt WASM use the same source revision.\n\n' +
      `Source: ${commit}\n\nInstall the versioned npm tarball from this release; see the README for usage and format limits.\n`;
    writeFileSync('release/notes.md', notes);
    execFileSync(
      'gh',
      [
        'release',
        'create',
        tag,
        archive,
        'release/SHA256SUMS',
        'release/build-info.json',
        '--repo',
        repository,
        '--verify-tag',
        '--title',
        tag,
        '--notes-file',
        'release/notes.md',
      ],
      { stdio: 'inherit', windowsHide: true },
    );
  } else {
    throw new Error('Use select or publish');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
