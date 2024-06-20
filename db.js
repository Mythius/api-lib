// npm i mysql2 ssh2 csv-parse
const mysql = require('mysql2');
const { Client } = require('ssh2');
const {fs,file} = require('./file.js');

const config = {
    host: '127.0.0.1',
    user: 'matthias',
    password: '',
    port: 3306
};


function sshQuery(host, db, query) {
    return new Promise((res, rej) => {
        var dbServer = {
            host: host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: db
        }
        var tunnelConfig = {
            host: config.host,
            port: 22,
            username: config.user,
            password: config.password
        }
        var forwardConfig = {
            srcHost: config.host,
            srcPort: config.port,
            dstHost: dbServer.host,
            dstPort: dbServer.port
        };
        if (query.includes('--')) {
            rej('SQL INJECTION, only execute 1 query at a time');
            console.error('SQL Rejected (Detected Injection)');
            return;
        }
        const sshClient = new Client();
        const SSHConnection = new Promise((resolve, reject) => {
            sshClient.on('ready', () => {
                sshClient.forwardOut(
                    forwardConfig.srcHost,
                    forwardConfig.srcPort,
                    forwardConfig.dstHost,
                    forwardConfig.dstPort,
                    (err, stream) => {
                        if (err) reject(err);
                        const updatedDbServer = {
                            ...dbServer,
                            stream
                        };
                        const connection = mysql.createConnection(updatedDbServer);
                        connection.connect((error) => {
                            if (error) {
                                reject(error);
                            }
                            resolve(connection);
                        });
                    });
            }).connect(tunnelConfig);
        });
        SSHConnection.then(connection => {
            // console.log(connection);
            connection.query(query,
                function(err, results, fields) {
                    if (err) {
                        console.log(err);
                    } else {
                        connection.end();
                        sshClient.end();
                        res(results);
                    }
                }
            );
        }).catch(err => {
            rej(err);
        });
    })
}

function parseCSVdata(data,delimiter=','){
    return new Promise((res,rej)=>{
        parse(data,{trim:true,columns:false,quote:'"',escape:'"',delimiter},(e,r)=>{
            res(r);
        });
    });
}

function uploadCSV(path, host, db, table, delimiter = ',') {
    return new Promise((res, rej) => {
        file.read(path, data => {
            parseCSVdata(data,delimiter).then(alldata=>{
                let columns = alldata.shift();
                if(alldata.length==0){
                    console.log(path+' is empty, not uploading anything');
                    res();
                    return;
                }
                const VALUES = alldata.map(row=>row.map(e=>e.length?`'${e.replaceAll(`'`,`''`)}'`:'NULL').join(',')).join('),(');
                var SQL = `INSERT INTO ${table} (${columns.map(e=>e.match(/[\s\(]/gi)?`\`${e}\``:e).join(',')}) VALUES (${VALUES})`;
                // console.log(SQL);
                q(host, db, SQL).then(result => {
                    res(result);
                });
            })
        });
    });
}

function queryToCSV(host, db, query, filename, delimiter = ',') {
    return new Promise((res, rej) => {
        q(host, db, query).then(result => {
            let CSV = [];
            if(!result || !result[0]){
                res([]);
                return;
            }
            CSV.push(Object.keys(result[0]));
            for (let line of result) {
                let row = [];
                for (let cell in line) {
                    row.push(line[cell]);
                }
                CSV.push(row);
            }
            if (filename) file.save(filename, CSV.map(e => e.join(delimiter)).join('\n'));
            res(CSV);
        });
    });
}

function saveCSV(name, data, delimiter = ',') {
    file.save(name, data.map(e => e.join(delimiter)).join('\n'));
}

function loadSQL(filename) {
    return new Promise((res, rej) => {
        file.read(filename, data => {
            res(data.replaceAll(/(\r|\t)/g, '').replaceAll('\n', ' '));
        });
    });
}

function normalQuery(host, db, query) {
    return new Promise((res, rej) => {
        const connection = mysql.createConnection({
            ...config,
            database: db
        });
        connection.connect(err => {
            if (err) {
                rej(err);
                return;
            }
            connection.query(query,
                function(err, results, fields) {
                    if (err) {
                        // console.log(err);
                        rej(err);
                    } else {
                        res(results);
                        connection.end();
                    }
                }
            );
        });
    });
}

function setQueryMode(type = 'normal') {
    if (type == 'ssh') {
        q = sshQuery;
        exports.query = sshQuery;
    } else if (type == 'normal') {
        q = normalQuery;
        exports.query = normalQuery;
    } else if (type == 'snowflake') {
        q = function(u1, u2, qry) {
            return SF.query(qry)
        }
    } else if(type == 'pg'){
        q = postGresQuery;
    }
    exports.query = q;
}

function postGresQuery(host, db, query) {
    return new Promise((res, rej) => {
        const client = new pgClient({
            user: login["elevate-username"],
            host: login["elevate-host"],
            database: db,
            password: login["elevate-password"],
            port: 3306, // Default PostgreSQL port
        });
        client.connect().then(_=>{
            client.query(query,(err,result)=>{
                if(err){
                    console.log('Error');
                    rej(err);
                    return;
                } else {
                    console.log('success');
                    res(result.rows);
                }
                client.end();
            });
        });
    });
}

var q = normalQuery;


exports.query = normalQuery;
exports.uploadCSV = uploadCSV;
exports.dbServer = config;
exports.setQueryMode = setQueryMode;
exports.queryToCSV = queryToCSV;
exports.loadSQL = loadSQL;
exports.saveCSV = saveCSV;
exports.file = file;