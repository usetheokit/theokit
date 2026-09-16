export {
  authFilePath,
  // `credentialHome` and `ensureAuthHome` are NOT re-exported. Both answer "where is the store?"
  // without touching it, and every surface wants the other half — `installAuthHome`, which writes
  // the variable the SDK reads. Publishing the read-only pair beside it is how the CLI came to call
  // the one that changes nothing and believe it had bootstrapped the credential store.
  installAuthHome,
  resolveCredential,
  resolveCredentialForModel,
  resolveFreshCredential,
  type ResolvedCredential,
} from './credentials.js'

export { login, logout, methodsFor, oauthDeviceLogin, knownProviders } from './login.js'

export { describeSource, dotenvNames } from './credential-provenance.js'

export { strayCredentialFiles } from './stray-credentials.js'

export { routeToCredential } from './model-route.js'
