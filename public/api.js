var auth_token = 'empty';
async function login(username, password) {
    let authorization = JSON.stringify({ username, password });
    let req = await fetch('/auth', { method: 'POST', headers: { authorization } });
    let dat = await req.json();
    auth_token = dat.token;
    return JSON.stringify(dat);
}
async function request(url, data = {}) {
    if (!data.method) data.method = 'GET';
    if (!data.headers) data.headers = {};
    if (!data.headers['Content-Type']) data.headers['Content-Type'] = 'application/json';
    if (!data.headers.authorization) data.headers.authorization = auth_token;
    let req = await fetch(url, data);
    return await req.json();
}