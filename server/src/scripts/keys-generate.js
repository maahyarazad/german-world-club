#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto'

/**
 * Ed25519 keypair for access-token signing (research R2).
 *
 * EdDSA over HS256 because the mobile app and admin console will eventually
 * verify tokens they did not mint: a public verification key means no shared
 * secret has to be distributed to anything that only needs to read tokens.
 */
const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim()
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()
const oneLine = (pem) => pem.replace(/\n/g, '\\n')

console.log('# Add these to server/.env — the private key is a credential.')
console.log(`JWT_PRIVATE_KEY="${oneLine(priv)}"`)
console.log(`JWT_PUBLIC_KEY="${oneLine(pub)}"`)
