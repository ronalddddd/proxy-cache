# Proxy Cache

An express middleware compatible proxy cache with an extensible adapter interface. Comes with a TTL adapter and a MongoDB adapter.

# Install

    npm install rn-proxy-cache


# Usage

## Simple TTL Caching

    npm start \
    --target-host="www.google.com:80" \
    --proxy-port=8080 \
    --ttl=30000

## Using the built-in MongoDB adapter with some additional settings

    npm start \
    --target-host="localhost:8081" \
    --proxy-port=8080 \
    --ignore-regex="^\/assets" \
    --mongodb-url="mongodb://localhost:27017/test" \
    --use-external-cache \
    --watch-interval=5000 \
    --mem-usage \
    --verbose-log

## Required Settings

- `--target-host`: The host and port you're proxying to.
- `--proxy-port`: The port this proxy will serve on.

## Optional Settings

- `--ignore-regex`: Regular expression of a URL pattern to bypass cache.
- `--ttl`: TTL caching in milliseconds, defaults to 600000ms (10 minutes).
- `--mongodb-url`: Supply this to use the MongoDB adapter.
- `--use-external-cache`: Enables storing cached objects in the external storage interface provided by the adapter, useful if you run multiple instances of the proxy.
- `--watch-interval`: How long between each stale-cache check. Defaults to 30sec.
- `--mem-usage`: Shows memory usage info every 30sec.
- `--verbose-log`: Verbose logging for debugging.

## Express middleware

    var ProxyCache = require('rn-proxy-cache');
    proxyCache = new ProxyCache(options);
    proxyCache.ready.then(function(){
        app.use(proxyCache);
    });

Optionally add a middleware in front of this and set `req.shouldCache` to let ProxyCache know if this request should be cached

# MongoDB Adapter

The MongoDB adapter watches a "PublishSchedule" collection that stores a "publish_date" field indicating when the next publish will happen and hence invalidate existing cache.

The MongoDB adapter also implements the external cache storage interfaces and stores cached data in the "ProxyCache" collection.
The methods implemented are `setCache(key, value)`, `getCache(key)`, `clearCache()`, all returning a promise that resolves when the task is completed.
Use the `--use-external-cache` option to enable it.

# Notes

- "host-rewrite" option is disabled for redirects.
- Response status codes from upstream that's greater than 200 are not cached.
- Empty response bodies are not cached.

# TODOs

- DONE - Change naive implementation of response caching -- how to cache images and binary data properly?
- Write tests
- Add feature to cleanup cache objects after a set memory threshold
- DONE - Add feature to allow request pooling
- Add feature to serve stale cache while making new proxy request to update cache
- Add feature to regenerate cache (precache), generating the ones with the most cache hits first
- DONE - Add a basic TTL cache adapter
- Allow custom getCacheKey method
- Enable library usage and create API
- Enable middleware to pass through properly and cache response stream instead of making a proxy call
- Update readme to include all options
