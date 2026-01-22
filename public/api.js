async function login(username, password) {
  let req = await fetch("/auth", {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    credentials: "include",
  });
  return await req.json();
}

async function request(url, data = {}) {
  if (!data.method) data.method = "GET";
  if (!data.headers) data.headers = {};
  if (!data.headers["Content-Type"])
    data.headers["Content-Type"] = "application/json";
  data.credentials = "include";
  let req = await fetch(url, data);
  return await req.json();
}

function googleAuth() {
  return new Promise((res, rej) => {
    google.accounts.id.initialize({
      client_id:
        "1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com",
      callback: handleCredentialResponse,
      scope:
        "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    });
    google.accounts.id.prompt();

    function handleCredentialResponse(data) {
      const idToken = data.credential;
      const decodedToken = jwt_decode(idToken);
      const email = decodedToken.email;
      const name = decodedToken.name;
      const credential = data.credential;
      let loginSuccess = loginGoogle({ email, name, credential });

      res({ email, name, credential, loginSuccess });
    }
  });
}

async function loginGoogle(data) {
  let req = await fetch("/auth/google-oneclick", {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
  return await req.json();
}

// Redirect-based OAuth (works when third-party cookies are blocked)
function googleOAuth() {
  window.location.href = "/auth/google";
}

function microsoftOAuth() {
  window.location.href = "/auth/microsoft";
}

async function logout() {
  let req = await fetch("/auth", {
    method: "DELETE",
    credentials: "include",
  });
  return await req.json();
}
