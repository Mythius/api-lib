// Redirect the browser to start a Google OAuth flow.
// client_id and redirect_uri must match an entry in clients.json on the auth server.
function googleOAuth(clientId, redirectUri) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
  window.location.href = `/auth/google?${params}`;
}

// Redirect the browser to start a Microsoft OAuth flow.
function microsoftOAuth(clientId, redirectUri) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
  window.location.href = `/auth/microsoft?${params}`;
}

// Verify a token returned by the auth server (server-to-server call from your backend).
// Returns { valid: true, user: { sub, email, name, picture, provider } } or { valid: false }.
async function verifyAuthToken(token) {
  const res = await fetch("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

// Generic authenticated request helper for your own API (once you have your own session).
async function request(url, data = {}) {
  if (!data.method) data.method = "GET";
  if (!data.headers) data.headers = {};
  if (!data.headers["Content-Type"])
    data.headers["Content-Type"] = "application/json";
  data.credentials = "include";
  const res = await fetch(url, data);
  return res.json();
}
