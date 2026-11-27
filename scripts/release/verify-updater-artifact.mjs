#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tauri wraps Minisign's text public key/signature in base64. Verify both the
// installer signature and Minisign's authenticated comment, using Node crypto.
export function verifyUpdaterArtifact(artifact, publicKeyText, signatureText) {
  const keyLines = Buffer.from(publicKeyText.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const sigLines = Buffer.from(signatureText.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? '', 'base64');
  const signature = Buffer.from(sigLines[1] ?? '', 'base64');
  const globalSignature = Buffer.from(sigLines[3] ?? '', 'base64');
  assert.equal(key.length, 42, 'Invalid updater public key');
  assert.equal(signature.length, 74, 'Invalid updater signature');
  assert.equal(globalSignature.length, 64, 'Invalid global signature');
  assert.equal(signature.subarray(0, 2).toString(), 'ED', 'Only prehashed Minisign updates are accepted');
  assert.ok(key.subarray(2, 10).equals(signature.subarray(2, 10)), 'Updater key ID mismatch');
  assert.ok(sigLines[2]?.startsWith('trusted comment: '), 'Missing authenticated comment');
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]),
    format: 'der', type: 'spki',
  });
  const rawSignature = signature.subarray(10);
  const digest = createHash('blake2b512').update(artifact).digest();
  assert.ok(verify(null, digest, publicKey, rawSignature), 'Installer signature verification failed');
  const authenticated = Buffer.concat([rawSignature, Buffer.from(sigLines[2].slice(17), 'utf8')]);
  assert.ok(verify(null, authenticated, publicKey, globalSignature), 'Signature comment verification failed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [artifactPath, publicKeyPath] = process.argv.slice(2);
  if (!artifactPath || !publicKeyPath) throw new Error('Usage: verify-updater-artifact.mjs <Setup.exe> <public-key.txt>');
  const artifact = readFileSync(artifactPath);
  const publicKey = readFileSync(publicKeyPath, 'utf8');
  const signature = readFileSync(artifactPath + '.sig', 'utf8');
  verifyUpdaterArtifact(artifact, publicKey, signature);
  const tampered = Buffer.from(artifact);
  tampered[Math.floor(tampered.length / 2)] ^= 1;
  assert.throws(() => verifyUpdaterArtifact(tampered, publicKey, signature), /signature verification failed/);
  console.log('Updater signature verified; a modified installer is correctly rejected.');
}
