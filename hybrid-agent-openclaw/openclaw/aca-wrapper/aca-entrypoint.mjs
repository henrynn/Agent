import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

function readPort(names, fallback) {
  for (const name of names) {
    const value = process.env[name];
    if (!value) {
      continue;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }

  return fallback;
}

function appendHeaderValue(existingValue, newValue) {
  if (!existingValue) {
    return newValue;
  }

  return `${existingValue}, ${newValue}`;
}

const publicPort = readPort(["OPENCLAW_PUBLIC_PORT", "PORT", "WEBSITES_PORT"], 18789);
const internalPort = readPort(["OPENCLAW_INTERNAL_PORT", "OPENCLAW_GATEWAY_PORT"], 18790);
const internalHost = process.env.OPENCLAW_UPSTREAM_HOST || "127.0.0.1";

if (publicPort === internalPort) {
  console.error(
    `[aca-wrapper] refusing to start because the public port (${publicPort}) matches the internal gateway port (${internalPort}).`
  );
  process.exit(1);
}

const gatewayEnv = {
  ...process.env,
  OPENCLAW_GATEWAY_PORT: String(internalPort),
  OPENCLAW_INTERNAL_PORT: String(internalPort),
  OPENCLAW_PUBLIC_PORT: String(publicPort),
};

delete gatewayEnv.PORT;
delete gatewayEnv.WEBSITES_PORT;

for (const pathValue of [gatewayEnv.OPENCLAW_CONFIG_DIR, gatewayEnv.OPENCLAW_WORKSPACE_DIR]) {
  if (pathValue) {
    mkdirSync(pathValue, { recursive: true });
  }
}

const gateway = spawn(process.execPath, ["/app/openclaw.mjs", "gateway"], {
  env: gatewayEnv,
  stdio: "inherit",
});

let shuttingDown = false;

function log(message) {
  console.log(`[aca-wrapper] ${message}`);
}

function failProxy(res, error) {
  if (res.headersSent) {
    res.destroy(error);
    return;
  }

  res.statusCode = 502;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("OpenClaw gateway is not reachable yet.\n");
}

const server = http.createServer((req, res) => {
  if (req.url === "/__aca__/healthz") {
    res.statusCode = gateway.exitCode === null ? 200 : 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ gatewayRunning: gateway.exitCode === null }));
    return;
  }

  const forwardedFor = appendHeaderValue(req.headers["x-forwarded-for"], req.socket.remoteAddress || "");
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "";
  const forwardedProto = req.headers["x-forwarded-proto"] || "https";
  const forwardedPort = req.headers["x-forwarded-port"] || String(publicPort);

  const upstreamReq = http.request(
    {
      host: internalHost,
      port: internalPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        connection: "close",
        "x-forwarded-for": forwardedFor,
        "x-forwarded-host": forwardedHost,
        "x-forwarded-port": forwardedPort,
        "x-forwarded-proto": forwardedProto,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (error) => {
    console.error(`[aca-wrapper] http proxy error: ${error.message}`);
    failProxy(res, error);
  });

  req.on("aborted", () => upstreamReq.destroy());
  req.pipe(upstreamReq);
});

server.on("upgrade", (req, socket, head) => {
  const upstreamSocket = net.connect(internalPort, internalHost, () => {
    const forwardedFor = appendHeaderValue(req.headers["x-forwarded-for"], req.socket.remoteAddress || "");
    const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "";
    const forwardedProto = req.headers["x-forwarded-proto"] || "https";
    const forwardedPort = req.headers["x-forwarded-port"] || String(publicPort);

    const rawHeaders = [];
    rawHeaders.push(`${req.method} ${req.url} HTTP/${req.httpVersion}`);

    for (const [name, value] of Object.entries({
      ...req.headers,
      "x-forwarded-for": forwardedFor,
      "x-forwarded-host": forwardedHost,
      "x-forwarded-port": forwardedPort,
      "x-forwarded-proto": forwardedProto,
    })) {
      if (Array.isArray(value)) {
        rawHeaders.push(`${name}: ${value.join(", ")}`);
      } else if (value !== undefined) {
        rawHeaders.push(`${name}: ${value}`);
      }
    }

    rawHeaders.push("", "");
    upstreamSocket.write(rawHeaders.join("\r\n"));

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    socket.pipe(upstreamSocket).pipe(socket);
  });

  upstreamSocket.on("error", (error) => {
    console.error(`[aca-wrapper] websocket proxy error: ${error.message}`);
    socket.destroy(error);
  });

  socket.on("error", () => {
    upstreamSocket.destroy();
  });
});

server.on("clientError", (error, socket) => {
  console.error(`[aca-wrapper] client error: ${error.message}`);
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log(`received ${signal}, shutting down`);
  server.close(() => {
    if (gateway.exitCode === null) {
      gateway.kill(signal);
    }
  });

  setTimeout(() => {
    if (gateway.exitCode === null) {
      gateway.kill("SIGKILL");
    }
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

gateway.on("exit", (code, signal) => {
  log(`gateway exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
  server.close(() => {
    if (typeof code === "number") {
      process.exit(code);
    }

    process.exit(signal ? 1 : 0);
  });
});

server.listen(publicPort, "0.0.0.0", () => {
  log(`proxy listening on 0.0.0.0:${publicPort} -> ${internalHost}:${internalPort}`);
});
