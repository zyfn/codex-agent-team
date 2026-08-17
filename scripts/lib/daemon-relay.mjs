import { createConnection, createServer } from "node:net";

const DEFAULT_MAX_CONNECTIONS = 64;

export function startDaemonRelay({
  daemonSocket,
  port,
  host = "127.0.0.1",
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  onStats = () => {}
}) {
  if (!daemonSocket) throw new TypeError("daemonSocket is required");
  if (!Number.isInteger(port) || port < 0) throw new TypeError("port must be a non-negative integer");

  const stats = { activeConnections: 0, totalConnections: 0 };
  const pairs = new Set();
  let closing = false;
  const server = createServer((client) => {
    if (closing) {
      client.destroy();
      return;
    }
    client.setNoDelay(true);
    client.pause();
    const upstream = createConnection(daemonSocket);
    upstream.setNoDelay(true);
    const pair = createSocketPair(client, upstream, () => {
      pairs.delete(pair);
      stats.activeConnections -= 1;
      onStats({ ...stats });
    });
    pairs.add(pair);
    stats.activeConnections += 1;
    stats.totalConnections += 1;
    onStats({ ...stats });

    upstream.once("connect", () => {
      if (closing || client.destroyed) {
        pair.destroy();
        return;
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  });
  server.maxConnections = maxConnections;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Team transport did not expose a TCP port"));
        return;
      }
      resolve({
        host,
        port: address.port,
        getStats: () => ({ ...stats }),
        async close() {
          if (closing) return;
          closing = true;
          const pending = [...pairs].map((pair) => pair.closed);
          for (const pair of pairs) pair.destroy();
          await Promise.all(pending);
          await new Promise((done) => server.close(() => done()));
        }
      });
    });
  });
}

function createSocketPair(client, upstream, onClose) {
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
  const finish = () => {
    if (closed) return;
    closed = true;
    client.destroy();
    upstream.destroy();
    onClose();
    resolveClosed();
  };
  client.once("error", finish);
  upstream.once("error", finish);
  client.once("close", finish);
  upstream.once("close", finish);
  return {
    closed: closedPromise,
    destroy: finish
  };
}
