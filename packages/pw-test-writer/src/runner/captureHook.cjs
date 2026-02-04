/**
 * Capture Hook
 *
 * CommonJS module that gets loaded via NODE_OPTIONS --require to enable action capture.
 * Two capture mechanisms:
 * 1. BrowserContext patching - for UI tests (captures actions, network, console, snapshots)
 * 2. HTTP interception - for API tests (captures outgoing HTTP requests)
 *
 * Environment variables:
 * - PW_CAPTURE_ENDPOINT: HTTP endpoint to send captures to
 */

const endpoint = process.env.PW_CAPTURE_ENDPOINT;

if (endpoint) {
  // === 1. BrowserContext patching for UI tests ===
  let patched = false;

  function tryPatch() {
    if (patched) return true;

    for (const key of Object.keys(require.cache)) {
      if (key.includes('browserContext') && key.endsWith('.js')) {
        try {
          const mod = require.cache[key];
          if (mod && mod.exports) {
            const BrowserContext = mod.exports.BrowserContext;
            if (BrowserContext &&
                typeof BrowserContext === 'function' &&
                !BrowserContext._captureHookPatched &&
                BrowserContext._allContexts) {
              patched = true;
              BrowserContext._captureHookPatched = true;
              patchBrowserContext(BrowserContext);
              return true;
            }
          }
        } catch (e) {
          // Module not ready
        }
      }
    }
    return false;
  }

  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    if (tryPatch() || attempts >= 1000) {
      clearInterval(pollInterval);
    }
  }, 5);

  // === 2. HTTP interception for API tests ===
  installHttpInterceptor();
}

function patchBrowserContext(BrowserContext) {
  BrowserContext.onActionStart = async (info, context) => {
    try {
      await sendCapture({
        type: 'action:start',
        sessionId: process.env.PW_CAPTURE_SESSION || 'default',
        timestamp: Date.now(),
        data: {
          callId: info.callId,
          type: info.type,
          method: info.method,
          title: info.title,
          startTime: info.startTime,
        },
      });
    } catch {}
  };

  BrowserContext.onActionCapture = async (capture, context) => {
    try {
      await sendCapture({
        type: 'action:capture',
        sessionId: process.env.PW_CAPTURE_SESSION || 'default',
        timestamp: Date.now(),
        data: {
          type: capture.type,
          method: capture.method,
          title: capture.title,
          timing: capture.timing,
          network: capture.network,
          console: capture.console,
          snapshot: capture.snapshot ? {
            diff: capture.snapshot.diff,
          } : undefined,
          error: capture.error,
        },
      });
    } catch {}
  };
}

/**
 * Install HTTP interceptor to capture outgoing requests for API tests.
 * Patches http.request and https.request at the Node.js level.
 */
function installHttpInterceptor() {
  const http = require('http');
  const https = require('https');
  const captureUrl = new URL(endpoint);

  function wrapRequest(originalRequest, protocol) {
    return function patchedRequest(...args) {
      const req = originalRequest.apply(this, args);

      // Extract request info
      let url = '';
      let method = 'GET';
      let postData = null;

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = args[0].toString();
        if (typeof args[1] === 'object' && args[1] !== null && !args[1].on) {
          method = args[1].method || 'GET';
        }
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        const opts = args[0];
        method = opts.method || 'GET';
        const host = opts.hostname || opts.host || 'localhost';
        const port = opts.port ? `:${opts.port}` : '';
        const path = opts.path || '/';
        url = `${protocol}//${host}${port}${path}`;
      }

      // Skip capture endpoint requests and localhost/internal
      if (url.includes(captureUrl.host) || !url || url.includes('127.0.0.1')) {
        return req;
      }

      const startTime = Date.now();

      // Capture POST data
      const originalWrite = req.write;
      req.write = function(data, ...rest) {
        if (data && !postData) {
          postData = typeof data === 'string' ? data : data.toString('utf8').substring(0, 2000);
        }
        return originalWrite.call(this, data, ...rest);
      };

      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const endTime = Date.now();
          const durationMs = endTime - startTime;

          // Decompress and decode response body
          let body = '';
          try {
            const rawBuffer = Buffer.concat(chunks);
            const encoding = res.headers['content-encoding'];
            if (encoding === 'gzip' || encoding === 'x-gzip') {
              body = require('zlib').gunzipSync(rawBuffer).toString('utf8');
            } else if (encoding === 'deflate') {
              body = require('zlib').inflateSync(rawBuffer).toString('utf8');
            } else if (encoding === 'br') {
              body = require('zlib').brotliDecompressSync(rawBuffer).toString('utf8');
            } else {
              body = rawBuffer.toString('utf8');
            }
          } catch {
            body = Buffer.concat(chunks).toString('utf8');
          }

          // Truncate very large bodies (keep enough for JSON structure)
          if (body.length > 10000) {
            body = body.substring(0, 10000);
          }

          // Build action capture for this HTTP request
          const parsedUrl = safeParseUrl(url);
          const shortPath = parsedUrl ? parsedUrl.pathname : url;
          const title = `${method} ${shortPath}`;

          sendCapture({
            type: 'action:capture',
            sessionId: process.env.PW_CAPTURE_SESSION || 'default',
            timestamp: endTime,
            data: {
              type: 'APIRequestContext',
              method: 'fetch',
              title: title,
              timing: { startTime, endTime, durationMs },
              network: {
                requests: [{
                  method: method,
                  url: url,
                  status: res.statusCode,
                  statusText: res.statusMessage || '',
                  durationMs: durationMs,
                  startTime: startTime,
                  endTime: endTime,
                  resourceType: 'fetch',
                  responseBody: body,
                  requestPostData: postData || undefined,
                }],
                summary: `${res.statusCode} ${method} ${shortPath} (${durationMs}ms)`,
              },
              console: [],
              snapshot: {},
            },
          }).catch(() => {});

          // Also send action:start retroactively for the progress indicator
          sendCapture({
            type: 'action:start',
            sessionId: process.env.PW_CAPTURE_SESSION || 'default',
            timestamp: startTime,
            data: {
              type: 'APIRequestContext',
              method: 'fetch',
              title: title,
              startTime: startTime,
            },
          }).catch(() => {});
        });
      });

      req.on('error', (err) => {
        const endTime = Date.now();
        sendCapture({
          type: 'action:capture',
          sessionId: process.env.PW_CAPTURE_SESSION || 'default',
          timestamp: endTime,
          data: {
            type: 'APIRequestContext',
            method: 'fetch',
            title: `${method} ${url}`,
            timing: { startTime, endTime, durationMs: endTime - startTime },
            network: {
              requests: [{
                method: method,
                url: url,
                status: null,
                durationMs: endTime - startTime,
                startTime: startTime,
                endTime: endTime,
                resourceType: 'fetch',
              }],
              summary: `FAILED ${method} ${url}`,
            },
            console: [],
            snapshot: {},
            error: { message: err.message },
          },
        }).catch(() => {});
      });

      return req;
    };
  }

  http.request = wrapRequest(http.request, 'http:');
  https.request = wrapRequest(https.request, 'https:');

  // Also patch http.get and https.get
  const originalHttpGet = http.get;
  http.get = function(...args) {
    const req = http.request(...args);
    req.end();
    return req;
  };

  const originalHttpsGet = https.get;
  https.get = function(...args) {
    const req = https.request(...args);
    req.end();
    return req;
  };
}

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function sendCapture(event) {
  if (!endpoint) return;

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
    });
  } catch {
    // Ignore failures
  }
}
