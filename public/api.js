var auth_token = localStorage.getItem("auth_token");
async function login(username, password) {
  let authorization = { username, password };
  let req = await fetch("/auth", {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: JSON.stringify(authorization),
  });
  let dat = await req.json();
  auth_token = dat.token;
  return JSON.stringify(dat);
}
async function request(url, data = {}) {
  if (!data.method) data.method = "GET";
  if (!data.headers) data.headers = {};
  if (!data.headers["Content-Type"])
    data.headers["Content-Type"] = "application/json";
  if (!data.headers.authorization) data.headers.authorization = auth_token;
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
  let authorization = JSON.stringify(data);
  let req = await fetch("/google-signin", {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: authorization,
  });
  let dat = await req.json();
  auth_token = dat.token;
  localStorage.setItem("auth_token", auth_token);
  return JSON.stringify(dat);
}
