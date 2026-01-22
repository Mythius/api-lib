// npm i mysql2 ssh2 csv-parse
const mysql = require("mysql2");
const { Client } = require("ssh2");
const { fs, file } = require("./file.js");
const { parse } = require("csv-parse");

const config = {
  host: "127.0.0.1",
  user: "matthias",
  password: "",
  port: 3306,
};

const ssh_config = {
  host: "msouthwick.com",
  user: "matthias",
  password: "",
  port: 22,
}

function sshQuery( db, query, values = []) {
  return new Promise((res, rej) => {
    var dbServer = {
      host: `localhost`,
      port: config.port,
      user: config.user,
      password: config.password,
      database: db,
    };
    var tunnelConfig = {
      host: ssh_config.host,
      port: ssh_config.port,
      username: ssh_config.user,
      password: ssh_config.password,
    };
    var forwardConfig = {
      srcHost: config.host,
      srcPort: config.port,
      dstHost: dbServer.host,
      dstPort: dbServer.port,
    };
    const sshClient = new Client();
    const SSHConnection = new Promise((resolve, reject) => {
      sshClient
        .on("ready", () => {
          sshClient.forwardOut(
            forwardConfig.srcHost,
            forwardConfig.srcPort,
            forwardConfig.dstHost,
            forwardConfig.dstPort,
            (err, stream) => {
              if (err) reject(err);
              const updatedDbServer = {
                ...dbServer,
                stream,
              };
              const connection = mysql.createConnection(updatedDbServer);
              connection.connect((error) => {
                if (error) {
                  reject(error);
                }
                resolve(connection);
              });
            }
          );
        })
        .connect(tunnelConfig);

        
    });
    SSHConnection.then((connection) => {
      // console.log(connection);
      connection.query(query, values, function (err, results, fields) {
        if (err) {
          console.log(err);
        } else {
          connection.end();
          sshClient.end();
          res(results);
        }
      });
    }).catch((err) => {
      rej(err);
    });
  });
}

function parseCSVdata(data, delimiter = ",") {
  return new Promise((res, rej) => {
    parse(
      data,
      {
        trim: true,
        columns: false,
        quote: '"', // Field can be enclosed in double quotes
        escape: '"', // Embedded quotes are escaped with another quote
        delimiter,
        relax_quotes: false, // Allows leniency with quotes inside quoted fields
        relax_column_count: false, // Lenient on column count mismatch
      },
      (e, r) => {
        if (e) {
          console.error(e);
          rej(e);
        } else {
          res(r);
        }
      }
    );
  });
}

function uploadCSV(path, db, table, delimiter = ",") {
  return new Promise((res, rej) => {
    file.read(path, (data) => {
      parseCSVdata(data, delimiter).then((alldata) => {
        let columns = alldata.shift();
        if (alldata.length == 0) {
          console.log(path + " is empty, not uploading anything");
          res();
          return;
        }
        const VALUES = alldata
          .map((row) =>
            row
              .map((e) => (e.length ? `'${e.replaceAll(`'`, `''`)}'` : "NULL"))
              .join(",")
          )
          .join("),(");
        var SQL = `INSERT INTO ${table} (${columns
          .map((e) => (e.match(/[\s\(]/gi) ? `\`${e}\`` : e))
          .join(",")}) VALUES (${VALUES})`;
        // console.log(SQL);
        q(host, db, SQL).then((result) => {
          res(result);
        });
      });
    });
  });
}

function queryToCSV(db, query, values, filename, delimiter = ",") {
  return new Promise((res, rej) => {
    q(db, query, values).then((result) => {
      let CSV = [];
      if (!result || !result[0]) {
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
      if (filename) saveCSV(filename, CSV);
      res(CSV);
    });
  });
}

function escapeField(field, delimiter) {
  if (
    typeof field === "string" &&
    (field.includes(delimiter) || field.includes('"') || field.includes("\n"))
  ) {
    field = field.replace(/"/g, '""');
    return `"${field}"`;
  }
  return field;
}

function saveCSV(filename, CSV, delimiter = ",") {
  const escapedCSV = CSV.map((row) =>
    row.map((field) => escapeField(field, delimiter)).join(delimiter)
  ).join("\n");

  file.save(filename, escapedCSV);
}

function loadCSV(path, delimiter = ",") {
  return new Promise((res, rej) => {
    file.read(path, (data) => {
      parseCSVdata(data, delimiter).then((alldata) => {
        res(alldata);
      });
    });
  });
}

function loadSQL(filename) {
  return new Promise((res, rej) => {
    file.read(filename, (data) => {
      res(data.replaceAll(/(\r|\t)/g, "").replaceAll("\n", " "));
    });
  });
}

function normalQuery(db, query, values = []) {
  return new Promise((res, rej) => {
    const connection = mysql.createConnection({
      ...config,
      database: db,
    });
    connection.connect((err) => {
      if (err) {
        rej(err);
        return;
      }
      connection.query(query, values, function (err, results, fields) {
        if (err) {
          rej(err);
        } else {
          res(results);
        }
        connection.end();
      });
    });
  });
}

function setQueryMode(type = "normal") {
  if (type == "ssh") {
    q = sshQuery;
    exports.query = sshQuery;
  } else if (type == "normal") {
    q = normalQuery;
    exports.query = normalQuery;
  }
  exports.query = q;
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
exports.loadCSV = loadCSV;
exports.ssh_config = ssh_config;