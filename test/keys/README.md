# Test-only keys

This RSA keypair exists so tests can forge **valid** Cloudflare Access JWTs
and exercise the real verification path (signature, issuer, audience,
expiry). It is generated for tests, committed on purpose, and grants access
to nothing anywhere. Never reuse it outside the test suite.

The test config injects `jwks-public.json` as the `ACCESS_JWKS` binding;
`test/helpers/auth.ts` signs tokens with `jwk-private.json`.
