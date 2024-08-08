const port = 80;
const google_client_id = '1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com';
// npm i express path fs md5 body-parser express-fileupload google-auth-library
const express = require("express");
const path = require("path");
const md5 = require('md5');
const bodyParser = require("body-parser");
const fileUpload = require('express-fileupload');
const app = express();
const API = require('./api.js');
const { file, fs } = require('./file.js');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(google_client_id);


app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload({ limits: { fileSize: 50000000, /*50 MB*/ }, abortOnLimit: true }));
app.use(express.static(path.join(__dirname, "public")));
app.listen(port, () => { console.log(`Server is listening at http://localhost:${port}`) });


let auth = {};
let sessions = {};

async function verifyToken(token) {
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: google_client_id,
    });
    const payload = ticket.getPayload();
    const userId = payload['sub'];
    // If request specified a G Suite domain:
    // const domain = payload['hd'];
    return payload;
}


function loadAuth() {
    return new Promise((res, rej) => {
        file.read('auth.json', e => {
            auth = JSON.parse(e);
            res();
        }, error => {
            file.save('auth.json', '{}');
            res();
        });
    });
}

function saveAuth() {
    file.save('auth.json', JSON.stringify(auth));
}

app.post('/auth', async (req, res) => {
    const cred = JSON.parse(req.headers.authorization);
    if (!(cred.username in auth)) {
        await loadAuth();
    }
    if (!(cred.username in auth)) {
        res.status(403).json({ error: 'Couldn\'t log in' });
        return;
    }
    if (md5(cred.password) == auth[cred.username].password) {
        let token = md5(new Date().toISOString() + cred.username);
        res.json({ message: 'Successfully Logged In', token });
        delete sessions[auth[cred.username].token];
        sessions[token] = { user: auth[cred.username] };
        sessions[token].username = cred.username;
        auth[cred.username].token = token;
    } else {
        res.status(403).json({ error: 'Couldn\'t log in' });
        return;
    }
});

app.post('/google-signin', async (req, res) => {
    console.log('google sign in request recieved');
    let cred = JSON.parse(req.headers.authorization);
    try{
        let data = await verifyToken(cred.credential);
        if(!(cred.email in auth)){
            auth[cred.email] = {priv:0,token:''};
        }
        if(auth[cred.email].token) delete sessions[auth[cred.email].token];
        let token = md5(new Date().toISOString() + cred.email);
        sessions[token] = { user: auth[cred.email] };
        sessions[token].username = cred.name;
        sessions[token].google_data = data;
        auth[cred.email].token = token;
        saveAuth();
        res.status(200).json({message:'Successfully Logged In',token});
    } catch(e) {
        console.error(e);
        res.status(403).json({error:'Invalid Google Login'});
    }
});

API.public(app);

app.use(function(req, res, next) {
    if (!req.headers.authorization) return res.status(403).json({ error: 'No credentials Sent' });
    if (!(req.headers.authorization in sessions)) return res.status(403).json({ error: 'Invalid Token' });
    req.session = sessions[req.headers.authorization];
    next();
});

// TEST with: request('/newuser',{method:'POST',body:JSON.stringify({username:'user2',password:'123456'})});
app.post('/newuser', (req, res) => {
    if (req.session.user.priv !== 1) res.status(403).json({ error: 'You are not an admin' });
    let data = req.body;
    if (!data.priv) data.priv = 0;
    if (data.username && data.password) {
        auth[data.username] = { password: md5(data.password), priv: data.priv, token: '' };
        saveAuth();
    } else {
        res.status(400).json({ message: 'Username and Password must be specified' });
        return;
    }
    res.json({ message: 'User created Successfully' });
});

API.private(app);