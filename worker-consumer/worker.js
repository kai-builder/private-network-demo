const http = require('http');
const net = require('net');
const { URL } = require('url');

const APP_NAME = process.env.APP_NAME || 'worker-consumer';
const PORT = Number(process.env.PORT || 3000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 2500);

function formatSocketError(error) {
  if (!error) {
    return 'unknown socket error';
  }

  const maybeError = error;
  const message = typeof maybeError.message === 'string' ? maybeError.message.trim() : '';
  const code = typeof maybeError.code === 'string' ? maybeError.code : '';

  if (message) {
    return code ? `${code}: ${message}` : message;
  }

  if (code) {
    return code;
  }

  return String(error);
}

function parseCacheTarget() {
  const fallbackUrl = `redis://${process.env.CACHE_HOST || 'localhost'}:${process.env.CACHE_PORT || 6379}`;

  try {
    const parsed = new URL(process.env.CACHE_URL || fallbackUrl);
    return {
      url: process.env.CACHE_URL || fallbackUrl,
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
    };
  } catch (_error) {
    return {
      url: fallbackUrl,
      host: process.env.CACHE_HOST || 'localhost',
      port: Number(process.env.CACHE_PORT || 6379),
    };
  }
}

function tcpCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    function done(result) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        host,
        port,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    }

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => done({ ok: true }));
    socket.once('timeout', () => done({ ok: false, error: `timeout after ${timeoutMs}ms` }));
    socket.once('error', (error) => {
      done({ ok: false, error: formatSocketError(error) });
    });

    socket.connect(port, host);
  });
}

function redisPing(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let response = '';

    function done(result) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        host,
        port,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    }

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      socket.write('*1\\r\\n$4\\r\\nPING\\r\\n');
    });

    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('PONG')) {
        done({ ok: true, response: response.trim() });
      }
    });

    socket.once('timeout', () => {
      done({ ok: false, error: `timeout after ${timeoutMs}ms`, response: response.trim() || null });
    });

    socket.once('error', (error) => {
      done({
        ok: false,
        error: formatSocketError(error),
        response: response.trim() || null,
      });
    });

    socket.once('close', () => {
      if (!settled) {
        const normalized = response.trim();
        done({
          ok: normalized.includes('PONG'),
          response: normalized || null,
          error: normalized.includes('PONG') ? undefined : 'connection closed before PONG',
        });
      }
    });

    socket.connect(port, host);
  });
}

async function getCacheStatus() {
  const target = parseCacheTarget();
  const [tcp, ping] = await Promise.all([
    tcpCheck(target.host, target.port, REQUEST_TIMEOUT_MS),
    redisPing(target.host, target.port, REQUEST_TIMEOUT_MS),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    target,
    tcp,
    ping,
    overallOk: Boolean(tcp.ok && ping.ok),
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  const path = req.url || '/';

  if (path === '/health') {
    writeJson(res, 200, {
      status: 'ok',
      app: APP_NAME,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (path === '/status') {
    const cache = await getCacheStatus();
    writeJson(res, cache.overallOk ? 200 : 503, {
      app: APP_NAME,
      cache,
      env: {
        CACHE_URL: process.env.CACHE_URL || null,
        CACHE_HOST: process.env.CACHE_HOST || null,
        CACHE_PORT: process.env.CACHE_PORT || null,
      },
      hint: 'Link this app to redis-producer and set CACHE_URL=redis://redis:6379',
    });
    return;
  }

  writeJson(res, 200, {
    app: APP_NAME,
    endpoints: ['/health', '/status'],
    hint: 'This app is used for multi-consumer linking tests against redis-producer.',
  });
});

server.listen(PORT, () => {
  console.log(`${APP_NAME} listening on port ${PORT}`);
});
