[![Build Status](https://travis-ci.org/ronalddddd/proxy-cache.svg?branch=master)](https://travis-ci.org/ronalddddd/proxy-cache)
[![Code Climate](https://codeclimate.com/github/ronalddddd/proxy-cache/badges/gpa.svg)](https://codeclimate.com/github/ronalddddd/proxy-cache)
# Proxy Cache

Programmable reverse caching proxy. Use as a stand-alone app or an express middleware. Comes with TTL and MongoDB adapters.

# Features

- Request pooling: multiple requests with a cache miss will be pooled, i.e. only one request will be made upstream
- Fast in memory caching -- adapter cache are used as a second layer
- Extensible Adapter API
- Express middleware compatible
- Gzip compression when using the stand-alone server
- Stale-caching: serve stale cache while updating the cache object asynchronously in the background
- Remove cache objects (largest and least hit ones first) after a set memory threshold (defaults to 2GiB)

# Install

    npm install rn-proxy-cache


# Usage

## Stand-alone server with simple global-TTL caching

Note the `--spoof-host-header` option rewrites your "Host" header value to match the target host value. You probably won't use this in a normal proxy-cache setup unless you're running some sort of mirror site.

    npm start \
    --target-host="highscalability.com:80" \
    --proxy-port=8080 \
    --spoof-host-header \
    --ttl=30000

- `--target-host="www.google.com:80"`: your upstream host.
- `--proxy-port=8080`: the port for this proxy server.
- `--spoof-host-header`: use this to rewrite `Host` header value to the `--target-host` value. Only useful if your upstream application needs to use the domain specified by the `--target-host` value.
- `--ttl=30000`: TTL caching in milliseconds, defaults to 600000ms (10 minutes)

## Stand-alone server using MongoDB as a global cache expire schedule and persistent cache storage

    npm start \
    --target-host="www.apple.com:80" \
    --proxy-port=8080 \
    --spoof-host-header \
    --mongodb-url="mongodb://localhost:27017/test" \
    --use-external-cache \
    --watch-interval=60000 \

- `--mongodb-url`: Supply this to use the MongoDB adapter. Will watch the `PublishSchedule` collection that contains documents with the `publish_date` ISO Date string field and clears cache accordingly.
- `--use-external-cache`: Enables storing cached objects in the external storage interface provided by the adapter, useful if you run multiple instances of the proxy or surviving restarts
- `--watch-interval`: How long between each time it checks the PublishSchedule collection. Defaults to 30sec.

## Additional parameters when running as a stand-alone server

- `--mem-usage`: Shows memory usage info every 30sec.
- `--verbose-log`: Verbose logging for debugging.

## Express middleware

    var ProxyCache = require('rn-proxy-cache'),
        express = require('express'),
        app = express();

    var proxyCache = new ProxyCache({
        targetHost: "highscalability.com:80",
        spoofHostHeader: true // again, doubt you need to enable this if you're running your own site
    });

    app.use(proxyCache.createMiddleware());

    proxyCache.ready.then(function() {
        app.listen(8181, function () {
            console.log("ProxyCache server is ready");
        });
    });

Use `new ProxyCache(options)` to create a new instance of the proxy cache. `options` are:

- `targetHost`: the upstream host to proxy to. Defaults to `"localhost:80"`
- `httpProtocol`: `"http"` or `"https"`, defaults to `"http"`.
- `Adapter`: the cache adapter module to use, see `lib/adapters` for examples. Defaults to the TTL adapter.
- `adapterOptions`: adapters are passed these options when constructed, i.e. `new Adapter(proxyCacheInstance, options)`
- `httpProxyOptions`: upstream proxy requests are made using [http-proxy](https://github.com/nodejitsu/node-http-proxy),
these options are passed to the `httpProxy.createProxyServer()` method.
- `allowStaleCache`: allow stale cache to be served while asynchronously making a request upstream to update the cache object.
- `spoofHostHeader`: rewrite the upstream request header `Host` value to match `targetHost`
- `memGiBThreshold`: the maximum memory threshold before cleaning up some less hit cache objects to free memory

Optionally set `req.shouldCache` to let ProxyCache know if a request should be cached.

# Creating a custom Adapter

To implement a custom Adapter, create a node module with the following constructor interface: `CacheAdapter(proxyCache, options){ ... }`.

There are 2 things you can do with a custom adapter:

1. Decide when to invalidate the memory cache by calling `proxyCache.clearAll()`
2. Implement external cache storage with the following interfaces as CacheAdapter's prototype methods: `setCache(key, value)`, `getCache(key)`, `clearCache()`, all returning a promise that resolves when the task is completed.

Finally if you need to init the adapter asynchronously, you can set a `.ready` promise property on the adapter instance and resolve when ready.

# Notes

- "host-rewrite" option is disabled for redirects.
- Response status codes from upstream that's greater than 200 are not cached.
- Empty response bodies are not cached.
- [mobile-detect](https://www.npmjs.com/package/mobile-detect) is used to generate part of the cache key prefix: `phone` or `not_phone`.
This should be the most common case of upstream response variations. Ideally, we should use `Vary` headers provided by upstream responses.

# TODOs

Pull requests are welcome :)

- Write more tests
- Add feature to regenerate cache (precache), generating the ones with the most cache hits first
- Add option to override `ProxyCache.prototype.getCacheKey` method
- Add option to rewrite upstream path with a generated middleware -- e.g. `app.use('/path', proxyCache.createMiddleware({rewrite: rewritePathMethod }))`
- Add option to allow use of middleware response as upstream (instead of proxying with http-proxy)
- Support [ETag](https://en.wikipedia.org/wiki/HTTP_ETag) for browsers and [Vary](https://www.fastly.com/blog/best-practices-for-using-the-vary-header/) for upstream response variations. See [RFC2616](https://www.ietf.org/rfc/rfc2616.txt) for more.
- Dockerfile, systemd unitfile templates, and other proc management files
- How to handle very large response bodies?
- Avoid double compression?
