function listEndpoints(app, log = false) {
  const routes = [];

  function extractRoutes(stack, prefix = "") {
    stack.forEach((layer) => {
      if (layer.route) {
        // Direct route
        const methods = Object.keys(layer.route.methods)
          .map((m) => m.toUpperCase())
          .join(", ");
        routes.push({ method: methods, path: prefix + layer.route.path });
      } else if (layer.name === "router" && layer.handle.stack) {
        // Nested router (e.g. app.use('/api', someRouter))
        extractRoutes(
          layer.handle.stack,
          prefix + (layer.regexp.source === "^\\/" ? "" : layer.regexp.source)
        );
      }
    });
  }

  extractRoutes(app._router.stack);

  //   console.log("📌 Express Endpoints:\n");
  if (log) routes.forEach((r) => console.log(`[${r.method}] ${r.path}`));

  return routes;
}

function expose(app) {
  app.get("/endpoints/html", (req, res) => {
    const endpoints = listEndpoints(app);

    const html = /*html*/ `
<!DOCTYPE html>
<html>

<head>
  <title>API Endpoints</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f7f9fc;
      color: #333;
      padding: 20px;
    }

    h1 {
      text-align: center;
      color: #2b7de9;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      margin: auto;
      max-width: 800px;
    }

    th,
    td {
      padding: 12px;
      text-align: left;
      font-weight: bold;
    }

    th {
      background-color: #2b7de9;
      color: white;
      font-size: 16px;
      text-transform: uppercase;
    }

    tr:nth-child(even) {
      background-color: #f2f6ff;
    }

    tr:hover {
      background-color: #e8f1ff;
    }

    .method {
      font-weight: bold;
      padding: 5px 10px;
      border-radius: 5px;
      color: white;
      width: 200px;
      display: block;
      text-align: center;
    }

    .GET {
      background-color: #2890ffff;
    }

    .POST {
      background-color: #00b928ff;
    }

    .PUT {
      background-color: #e7b727ff;
    }

    .DELETE {
      background-color: #df5e6bff;
    }

    .PATCH {
      background-color: #9d54c7ff;
    }
  </style>
</head>

<body>
  <h1>📌 API Endpoints</h1>
  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Path</th>
      </tr>
    </thead>
    <tbody>
      ${endpoints
        .map(
          (e) => /*html*/ `
      <tr>
        <td><span class="method ${e.method}">${e.method}</span></td>
        <td>${e.path}</td>
      </tr>
      `
        )
        .join("")}
    </tbody>
  </table>
</body>

</html>
  `;

    res.send(html);
  });
  app.get("/endpoints/json", (req, res) => {
    const endpoints = listEndpoints(app);
    res.json(endpoints);
  });
}

exports.listEndpoints = listEndpoints;
exports.expose = expose;
