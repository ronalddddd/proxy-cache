var verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {},
    format = require('util').format,
    http = require('http'),
    httpProxy = require('http-proxy'),
    MobileDetect = require('mobile-detect'),
    CacheObject = require('./CacheObject'),
    DefaultAdapter = require('./adapters/proxy-cache-ttl');

/**
 * ProxyCache Server Constructor
 *
 * @param options
 * @return {ProxyCache}
 * @constructor
 */
var ProxyCache = function(options){
    var proxyCache = this;

    proxyCache.options = options || {};
    proxyCache.adapter = options.adapter || new DefaultAdapter();
    proxyCache.httpProxyOptions = options.httpProxyOptions || { // TODO: document this option
        hostRewrite: false
    };

    proxyCache.proxyTarget = options.targetHost || "localhost:80";
    proxyCache.ignoreRegex = (options.ignoreRegex)? new RegExp(options.ignoreRegex) : undefined;
    proxyCache.proxy = httpProxy.createProxyServer(proxyCache.httpProxyOptions);

    proxyCache.cacheCollection = {}; // getCacheKey(req) => CacheObject instance

    proxyCache.watchInterval = options.watchInterval || 30000;
    proxyCache.watcher = undefined;

    // Proxy Event Listeners

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

    proxyCache.proxy.on('error', function (err, req, res) {
        console.error(err);

        res.writeHead(500, {
            'Content-Type': 'text/plain'
        });

        res.end('');
    });

    // Create the cache server
    console.log("Creating Proxy Cache Server...");
    proxyCache.server = http.createServer(function (req, res) {
        //verboseLog("IN: %s", req.url);
        //verboseLog("Client Request headers:", req.headers);

        proxyCache.handleRequest(req, res);
    }).listen(options.proxyPort || 8181);

    if (process.env.npm_config_mem_usage !== undefined){
        setInterval(function(){
            // TODO: delete some cached objects if memory usage is over threshold
            verboseLog("Memory usage (resident): %s MB", process.memoryUsage().rss / 1024 / 1024);
        }, 30000);
    }

    // Start the stale-checking watcher
    proxyCache.watcher = setInterval(function(){
        adapter.checkIfStale()
            .then(function(isStale){
                if (isStale){
                    proxyCache.clearAll();
                }
            });
    }, proxyCache.watchInterval);

    return proxyCache;
};

ProxyCache.prototype.getCacheKey = function getCacheKey(req) {
    var md = new MobileDetect(req.headers['user-agent']);
    return format("%s:%s:%s",
        ((md.phone())? 'phone' : 'not_phone'),  // Device type
        req.headers.host,                       // Request host
        req.url);                               // Request URL
};

ProxyCache.prototype.clearAll = function(){
    var proxyCache = this;

    console.log("Clearing memory cache...");
    var deleteCount = 0;
    for (var k in proxyCache.cacheCollection){
        verboseLog("Deleting %s", k);
        delete proxyCache.cacheCollection[k];
        deleteCount++;
    }
    console.log("Deleted %s memory cache objects.",deleteCount);

    // Delete external cache
    if (proxyCache.adapter.clearCache){
        console.log("Clearing external cache...");
        proxyCache.adapter.clearCache();
    }
};

ProxyCache.prototype.respondWithCacheObject = function(req, res, co){
    for(var headerKey in co.headers){
        res.setHeader(headerKey, co.headers[headerKey]);
    }
    res.statusCode = co.statusCode || 500;
    res.setHeader("X-Cache-Key", co.cacheKey);
    res.setHeader("X-Cache-Date", co.dateISOString);
    res.setHeader("X-Cache-Hits", co.hits);

    return co.ready
        .then(function(){ // important -- ensures the cache is ready before sending
            res.end(co.data);
        })
        .catch(function(err){
            res.statusCode = 500;
            res.end("Sorry, an unknown error occurred.");
        });
};

ProxyCache.prototype.respondAndCache = function(req, res){
    var proxyCache = this,
        cacheKey = proxyCache.getCacheKey(req),
        co = proxyCache.cacheCollection[cacheKey];

    // Create a new cache object
    proxyCache.cacheCollection[cacheKey] = co = new CacheObject(cacheKey, null, req);
console.log("Proxying to %s",proxyCache.proxyTarget);
    // make the proxy request
    proxyCache.proxy.web(req, res, {
        target: (process.env.npm_config_http_protocol || 'http') + '://' + proxyCache.proxyTarget
    });

    return co.ready // When cache object is ready
        .then(function(co){
            console.log("[%s] Cached", co.cacheKey);
            // Save to external cache
            if(proxyCache.adapter.setCache){
                verboseLog("Saving cache object to adapter storage...");
                proxyCache.adapter.setCache(co.cacheKey, co)
                    .then(function(res){
                        console.log("Externally cached: %s", co.cacheKey);
                    });
            }
        })
        .catch(function(err){
            delete proxyCache.cacheCollection[cacheKey];
            console.warn("Error readying cache object, removed from cache collection");
        });
};

ProxyCache.prototype.handleRequest = function(req, res){
    var proxyCache = this,
        cacheKey = proxyCache.getCacheKey(req),
        co = proxyCache.cacheCollection[cacheKey],
        shouldCache = req.shouldCache = ( ! proxyCache.ignoreRegex || ! proxyCache.ignoreRegex.test(req.url) );

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
        // Try to find external cache
        return adapter.getCache(proxyCache.getCacheKey(req))
            .then(function(serializedCo){
                if(serializedCo){
                    // Cache found in external cache
                    console.log("HIT (external): %s", proxyCache.getCacheKey(req));
                    // Create a new cache object from serialized data
                    var co = proxyCache.cacheCollection[proxyCache.getCacheKey(req)] = new CacheObject(proxyCache.getCacheKey(req), serializedCo);
                    proxyCache.respondWithCacheObject(req, res, co);
                } else {
                    // Cache not found in external cache
                    proxyCache.respondAndCache(req, res);
                }
            });
    } else {
        return proxyCache.respondAndCache(req, res);
    }
};

// Express middleware
ProxyCache.prototype.middleware = function(req, res, next) {
    var proxyCache = this;

    proxyCache.handleRequest(req, res)
        .then(function(co){
            next();
        })
        .catch(function(err){
            next(err);
        });
};

ProxyCache.prototype.stopServer = function(){
    var proxyCache = this;
    proxyCache.server.close();
};

module.exports = ProxyCache;