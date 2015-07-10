# Proxy Cache

Programmable reverse caching proxy. Use as a stand-alone app or an express middleware. Comes with TTL and MongoDB adapters.

# Install

    npm install rn-proxy-cache


# Usage

## Stand-alone server with ttl caching

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

## Stand-alone server with MongoDB adapter

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

## Additional parameters

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

Optionally add a middleware in front of this and set `req.shouldCache` to let ProxyCache know if which requests should be cached

# Creating a custom Adapter

To implement a custom Adapter, create a node module with the following constructor interface: `CacheAdapter(proxyCache, options){ ... }`.

There are 2 things you can do with a custom adapter:

1. Decide when to invalidate the memory cache by calling `proxyCache.clearAll()`
2. Implement external cache storage with the following interfaces as CacheAdapter's prototype methods: `setCache(key, value)`, `getCache(key)`, `clearCache()`, all returning a promise that resolves when the task is completed.

Finally if you need to init the adapter asynchronously, you can set a `.ready` promise property on the adapter instance and resolve when ready.

# Features

- Request pooling: multiple requests with a cache miss will be pooled, i.e. only one request will be made upstream
- Fast in memory caching -- adapter cache are used as a second layer
- Extensible Adapter API
- Express middleware compatible
- Gzip compression when using the stand-alone server
- Stale-caching: serve stale cache while updating the cache object asynchronously in the background

# Notes

- "host-rewrite" option is disabled for redirects.
- Response status codes from upstream that's greater than 200 are not cached.
- Empty response bodies are not cached.

# TODOs

- Write more tests
- Add feature to cleanup cache objects after a set memory threshold
- Add feature to regenerate cache (precache), generating the ones with the most cache hits first
- Add feature to set custom getCacheKey method
- Enable middleware to pass through without using http-proxy
- Update readme to include all options

# Build statuses

## master
[![Build Status](https://travis-ci.org/ronalddddd/proxy-cache.svg?branch=master)](https://travis-ci.org/ronalddddd/proxy-cache)

## develop
[![Build Status](https://travis-ci.org/ronalddddd/proxy-cache.svg?branch=develop)](https://travis-ci.org/ronalddddd/proxy-cache)
