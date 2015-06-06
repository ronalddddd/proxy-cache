# Proxy Cache

A simple proxy cache with an adapter interface for stale-cache checking and external cache storage. Comes with a MongoDB adapter by default.

The default adapter implements the `checkIfStale()` method by checking a "PublishSchedule" collection in mongodb that stores a "publish_date" field
indicating when the next publish will happen and hence invalidate existing cache. The method should return a promise that resolves to a boolean value indicating if the cache should be considered stale.

The default adapter also implements the external cache storage interfaces and stores cached data in the "ProxyCache" collection. The methods implemented are `setCache(key, value)`, `getCache(key)`, `clearCache()`, all returning a promise that resolves when the task is completed.

# Install

    npm install rn-proxy-cache


# Usage

## Running as a server directly

    npm start \
    --target-host="localhost:8081" \
    --proxy-port=8080 \
    --ignore-regex="^\/assets" \
    --mongodb-url="mongodb://localhost:27017/test" \
    --use-external-cache \
    --watch-interval=5000 \
    --mem-usage \
    --verbose-log

## Options

- `--target-host`: The host and port you're proxying to.
- `--proxy-port`: The port this proxy will serve on.
- `--mongodb-url`: The default driver uses mongodb, so this is the mongodb url connection string.
- `--ignore-regex`: Regular expression of a URL pattern to bypass cache.
- `--use-external-cache`: Enables storing cached objects in the external storage interface provided by the driver, useful if you run multiple instances of the proxy.
- `--watch-interval`: How long between each stale-cache check.
- `--mem-usage`: Shows memory usage info every 30sec.
- `--verbose-log`: Verbose logging for debugging.

# TODO

- Change naive implementation of response caching -- how to cache images and binary data properly?
- Write tests
- Add feature to cleanup cache objects after a set memory threshold
- Add feature to allow request pooling
- Add feature to serve stale cache while making new proxy request to update cache
- Enable library usage and create API
