var verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {},
    format = require('util').format,
    Promise = require('bluebird'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    MobileDetect = require('mobile-detect'),
    CacheObject = require('./CacheObject'),
    DefaultAdapter = require('./adapters/proxy-cache-ttl'),
    request = require('request'),
    requestAsync = Promise.promisify(request),
    _ = require('lodash'),
    pkg = require('../package.json');

/**
 * ProxyCache Constructor
 *
 * @param options
 * @return {ProxyCache}
 * @constructor
 */
var ProxyCache = function(options){
    var proxyCache = this;

    proxyCache.options = options || {};
    proxyCache.options.memGiBThreshold = proxyCache.options.memGiBThreshold || 2;
    console.log("Max memory threshold set at %s GiB", proxyCache.options.memGiBThreshold);
    proxyCache.adapter = (options.Adapter)? new options.Adapter(proxyCache, options.adapterOptions || {}) : new DefaultAdapter(proxyCache, options.adapterOptions || {});
    proxyCache.httpProxyOptions = options.httpProxyOptions || {
        hostRewrite: false
    };

    proxyCache.proxyTarget = options.targetHost || "localhost:80";
    proxyCache.proxy = httpProxy.createProxyServer(proxyCache.httpProxyOptions);

    proxyCache.cacheCollection = {}; // getCacheKey(req) => CacheObject instance

    // Upstream response handler
    proxyCache.proxy.on('proxyRes', function(proxyRes, req, res){
        var cacheKey = proxyCache.getCacheKey(req),
            co = proxyCache.cacheCollection[cacheKey],
            shouldCache = ( proxyRes.statusCode <= 200 && req.shouldCache);

        if(!shouldCache){
            // Cache conditions not met
            console.log("[%s] Will not cache: %s %s", cacheKey, proxyRes.statusCode, req.url);
            delete proxyCache.cacheCollection[cacheKey];
        } else if ( co && !co.ready.isResolved() ) {
            // Tell the cache object to use this proxy response stream
            co.setProxyResponseStream(proxyRes); // TODO: this is implying that co exists and response stream has not been set -- bad design?
        } else {
            console.error("[%s] Cache object does not exist or is already readied!", cacheKey);
        }
    });

    // Upstream request error handler
    proxyCache.proxy.on('error', function (err, req, res) {
        var cacheKey = proxyCache.getCacheKey(req);

        delete proxyCache.cacheCollection[cacheKey];
        console.log("[%s] Proxy request error: deleted cache object. Error detail: ", cacheKey, err);

        res.writeHead(500, {
            'Content-Type': 'text/plain'
        });

        res.end('Proxy request error.');
    });

    // Set interval to handle memory usage
    if(proxyCache.options.memCheckIntervalMs === undefined || (proxyCache.options.memCheckIntervalMs !== undefined && proxyCache.options.memCheckIntervalMs > 0)){
        setInterval(proxyCache.checkMemory.bind(proxyCache), proxyCache.options.memCheckIntervalMs || 30000);
    } else {
        console.warn("Memory check disabled!");
    }

    // Set Promise that indicates ready state
    proxyCache.ready = Promise.all([
        proxyCache.adapter.ready || proxyCache.adapter // wait for adapter to be ready
    ])
        .then(function(res){
            console.log("ProxyCache instance is ready");
        });

    return proxyCache;
};

ProxyCache.prototype.freeMemory = function(memToFree){
    var proxyCache = this,
        sortedCacheItems = _.sortByOrder(proxyCache.cacheCollection, ['hits','data.lenth'], ['desc','asc']), // less used and big cache data gets sorted at the end
        cacheToDelete = sortedCacheItems.pop(),
        cacheDataSize = 0,
        totalMemFreed = 0,
        coDeleteCount = 0;

    console.log("Items in cache: %s", _.size(proxyCache.cacheCollection));
    console.log("Will try to free %s bytes", memToFree);

    // Keep removing objects from cache collection until desired memory to free has been reached
    while(cacheToDelete && totalMemFreed < memToFree){
        console.log("Removing [%s]",cacheToDelete.cacheKey);
        cacheDataSize = (cacheToDelete.data)? cacheToDelete.data.length : 0;
        totalMemFreed += cacheDataSize;
        delete proxyCache.cacheCollection[cacheToDelete.cacheKey];
        console.log("[%s] removed from cache collection, data size is %s Bytes",cacheToDelete.cacheKey,cacheDataSize);
        cacheToDelete = sortedCacheItems.pop();
        coDeleteCount++;
    }

    console.log("Total cache objects deleted: %s, total size of data: %s GiB", coDeleteCount, totalMemFreed / 1073741824);
};

ProxyCache.prototype.checkMemory = function(){
    var proxyCache = this,
        memUsedGiB = process.memoryUsage().rss / 1073741824; // 1073741824 is 1 GiB
    console.log("Memory usage (resident): %s GB", memUsedGiB);
    if (memUsedGiB > proxyCache.options.memGiBThreshold){
        proxyCache.freeMemory((memUsedGiB - proxyCache.options.memGiBThreshold) * 1073741824);
    } else {
        console.log("Memory usage within threshold");
    }
};

/**
 * Create the cache key using the incoming client request in the format of "[phone | not_phone]:<req.host>:<req.url>"
 *
 * @param req {http.ClientRequest}
 * @return {String} The cache key
 */
ProxyCache.prototype.getCacheKey = function getCacheKey(req) {
    var md = new MobileDetect(req.headers['user-agent']);
    return format("%s:%s:%s",
        ((md.phone())? 'phone' : 'not_phone'),  // Device type
        req.headers.host,                       // Request host
        req.url);                               // Request URL
};

/**
 * Clear all cache
 */
ProxyCache.prototype.clearAll = function(){
    var proxyCache = this,
        clearMethod = (!proxyCache.options.allowStaleCache)?
            function deleteCache(key) {
                delete proxyCache.cacheCollection[key];
                console.log("[%s] deleted", key);
            } :
            function setStale(key) {
                var co = proxyCache.cacheCollection[key];
                if (co) {
                    co.stale = true;
                    console.log("[%s] set as stale", key);
                }
            };

    console.log("Clearing memory cache...");
    var clearCount = 0;
    for (var k in proxyCache.cacheCollection){
        verboseLog("Clearing %s", k);
        //delete proxyCache.cacheCollection[k];
        clearMethod(k);
        clearCount++;
    }
    console.log("Cleared %s memory cache objects.",clearCount);

    // Delete external cache
    if (proxyCache.adapter.clearCache){
        console.log("Clearing external cache...");
        proxyCache.adapter.clearCache();
    }
};

/**
 * Respond to the client request by sending back the cached data
 *
 * @param req {http.ClientRequest}
 * @param res {http.ServerResponse}
 * @param co {CacheObject}
 * @return {*}
 */
ProxyCache.prototype.respondWithCacheObject = function(req, res, co){
    var proxyCache = this;

    for(var headerKey in co.headers){
        res.setHeader(headerKey, co.headers[headerKey]);
    }
    res.statusCode = co.statusCode || 500;
    res.setHeader("X-Cache-Server-Version", pkg.version);
    res.setHeader("X-Cache-Key", co.cacheKey);
    res.setHeader("X-Cache-Date", co.dateISOString);
    if(co.lastUpdated){ res.setHeader("X-Cache-Updated", co.lastUpdated); }
    res.setHeader("X-Cache-Hits", co.hits);

    // Asynchronously update the cache data if it's marked as stale
    if (co.stale === true) {
        console.log("[%s] Cache Object is stale, updating....", co.cacheKey);
        proxyCache.updateCacheObject(co)
            .then(function(res){
                console.log("[%s] Cache Object Updated.", co.cacheKey);
                // Save to external cache
                if(proxyCache.adapter.setCache){
                    verboseLog("[%s] Updating adapter cache...", co.cacheKey);
                    proxyCache.adapter.setCache(co.cacheKey, co)
                        .then(function(res){
                            console.log("[%s] Updated adapter cache", co.cacheKey);
                        })
                        .catch(function(err){
                            console.error("Failed to update adapter cache: ", err);
                        });
                }
            })
            .catch(function(err){
                delete proxyCache.cacheCollection[co.cacheKey];
                console.error("[%s] Cache Object failed to update. Deleted from the cache collection.", co.cacheKey);
                console.error(err);
            });
    }

    return co.ready
        .then(function(){ // important -- ensures the cache is ready before sending
            res.end(co.data);
        })
        .catch(function(err){
            res.statusCode = 500;
            res.end("Sorry, an unknown error occurred.");
        });
};

/**
 * Finish processing the request and cache the response
 *
 * @param req {http.ClientRequest}
 * @param res {http.ServerResponse}
 * @return {Promise} A promise that resovles to a {CacheObject} instance
 */
ProxyCache.prototype.respondAndCache = function(req, res){
    var proxyCache = this,
        cacheKey = proxyCache.getCacheKey(req),
        co = proxyCache.cacheCollection[cacheKey] = proxyCache.cacheCollection[cacheKey] || new CacheObject(cacheKey, null, req); // Creates a new cache object

    // make the proxy request
    proxyCache.proxy.web(req, res, {
        target: (proxyCache.options.httpProtocol || 'http') + '://' + proxyCache.proxyTarget
    });

    return co.ready // When cache object is ready
        .then(function(co){
            console.log("[%s] Cached", co.cacheKey);
            // Save to external cache
            if(proxyCache.adapter.setCache){
                verboseLog("Saving cache object to adapter storage...");
                return proxyCache.adapter.setCache(co.cacheKey, co)
                    .then(function(res){
                        console.log("Saved to adapter cache storage: %s", co.cacheKey);
                    })
                    .catch(function(err){
                        console.error("Failed to save to adapter cache storage: ", err);
                    });
            }
        })
        .catch(function(err){
            delete proxyCache.cacheCollection[cacheKey];
            console.warn("Error readying cache object, removed from cache collection");
        });
};

/**
 * Updates the cache object by replaying the original request.
 *
 * @param co {CacheObject}
 * @return {Promise} A promise that indicates an update is in progress
 */
ProxyCache.prototype.updateCacheObject = function(co) {
    var proxyCache = this;

    // If there's an unresolved update in progress, return that, otherwise create a new update promise
    co._updatePromise = (co._updatePromise && !co._updatePromise.isResolved())? co._updatePromise :
        co.setProxyResponseStream(request({
            method: co.request.method,
            url: (proxyCache.options.httpProtocol || 'http') + '://' + proxyCache.proxyTarget + co.request.url,
            headers: co.request.headers
            // TODO: post data, http version, etc?
        }));

    return co._updatePromise;
};

/**
 * Handle an incoming request callback
 *
 * @param req {http.ClientRequest}
 * @param res {http.ServerResponse}
 * @return {Promise}
 */
ProxyCache.prototype.handleRequest = function(req, res){
    var proxyCache = this;

    if (proxyCache.options.spoofHostHeader){
        req.headers.host = proxyCache.proxyTarget;
    }

    var cacheKey = proxyCache.getCacheKey(req),
        co = proxyCache.cacheCollection[cacheKey],
        //shouldCache = req.shouldCache = ( ! proxyCache.ignoreRegex || ! proxyCache.ignoreRegex.test(req.url) );
        shouldCache = req.shouldCache  = (req.shouldCache !==undefined)? req.shouldCache : true;

    if (co){
        if(!co.ready.isResolved()){
            // cache object created but not ready (pooled request)
            co.countPooled();
            console.log("[%s] Pooled: %s times",co.cacheKey,co.pooled);
        } else {
            // cached and ready
            co.countHit();
            console.log("[%s] HIT: %s times",co.cacheKey,co.hits);
        }
        return proxyCache.respondWithCacheObject(req, res, co);
    } else if(proxyCache.adapter.getCache && shouldCache){
        // Create a new cache object first (so that further requests get pooled) and then populate it later with `CacheObject.setSerializedInput()`, which will ready it.
        co = proxyCache.cacheCollection[cacheKey] = new CacheObject(cacheKey, null, req);

        // Try to find external cache
        return proxyCache.adapter.getCache(proxyCache.getCacheKey(req))
            .then(function(serializedCo){
                if(serializedCo){
                    // Cache found in external cache
                    console.log("[%s] HIT (external)", cacheKey);
                    // Create a new cache object from serialized data
                    //var co = proxyCache.cacheCollection[proxyCache.getCacheKey(req)] = new CacheObject(proxyCache.getCacheKey(req), serializedCo);
                    co.setSerializedInput(serializedCo);
                    return proxyCache.respondWithCacheObject(req, res, co);
                } else {
                    console.log("[%s] MISS (memory + external)", cacheKey);
                    // Cache not found in external cache
                    return proxyCache.respondAndCache(req, res);
                }
            });
    } else {
        console.log("[%s] MISS (memory)", cacheKey);
        return proxyCache.respondAndCache(req, res);
    }
};

/**
 * Generate an express-compatible middleware
 *
 * @return {function(req, res, next)}
 */
ProxyCache.prototype.createMiddleware = function() {
    var proxyCache = this;

    return function proxyCacheMiddleware(req, res, next) {
        proxyCache.handleRequest(req, res)
            .then(function (co) {
                next();
            })
            .catch(function (err) {
                next(err);
            });
    };
};

module.exports = ProxyCache;