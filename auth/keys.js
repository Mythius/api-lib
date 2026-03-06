const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY_PATH = path.join(__dirname, "..", "auth_private.pem");
const PUBLIC_KEY_PATH = path.join(__dirname, "..", "auth_public.pem");

function generateAndSaveKeypair() {
  console.warn(
    "[AUTH] RSA keys not found — generating new keypair. " +
      "In production, pre-generate and manage keys externally."
  );
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
  console.log("[AUTH] RSA keypair written to auth_private.pem / auth_public.pem");
  return { privateKey, publicKey };
}

function loadKeys() {
  try {
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
    const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
    return { privateKey, publicKey };
  } catch {
    return generateAndSaveKeypair();
  }
}

// Convert a PEM public key to a minimal JWKS representation
function publicKeyToJwks(publicKeyPem) {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  const jwk = keyObject.export({ format: "jwk" });
  return {
    keys: [
      {
        ...jwk,
        use: "sig",
        alg: "RS256",
        kid: "auth-key-1",
      },
    ],
  };
}

module.exports = { loadKeys, publicKeyToJwks };
