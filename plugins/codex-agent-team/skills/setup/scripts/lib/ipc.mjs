import { createConnection, createServer } from "node:net";

export function startIpcServer(socketPath, handler) {
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      Promise.resolve()
        .then(() => handler(JSON.parse(line)))
        .then((value) => socket.end(`${JSON.stringify({ ok: true, value })}\n`))
        .catch((error) => socket.end(`${JSON.stringify({
          ok: false,
          error: { code: error?.code ?? "COMMAND_FAILED", message: error?.message ?? String(error) }
        })}\n`));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function sendIpc(socketPath, command, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Team Runtime did not respond"));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      const response = JSON.parse(buffer.slice(0, newline));
      if (response.ok) resolve(response.value);
      else {
        const error = new Error(response.error?.message ?? "Team Runtime command failed");
        error.code = response.error?.code;
        reject(error);
      }
    });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}
