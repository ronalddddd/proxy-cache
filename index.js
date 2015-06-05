'use strict';

(function(){

    var verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {},
        http = require('http'),
        httpProxy = require('http-proxy'),
        MobileDetect = require('mobile-detect'),
        ProxyCache = function(driver, options){
            var proxyCache = this,
                CacheObject = function(jsonString){
                    var co = this,
                        deserialized = (jsonString)? JSON.parse(jsonString) : {};
                    verboseLog("Deserialized cache object: ", deserialized);
                    co.headers = deserialized.headers || null;
                    co.data = deserialized.data || "";
                    co.statusCode = deserialized.statusCode || undefined;
                    co.hits = 0;

                    //if(deserialized) console.log(co);

                    return co;
                };

            // Cache Object Prototypes

            CacheObject.prototype.appendData = function(data) {
                var co = this;
                co.data += data;
            };

            CacheObject.prototype.setHeaders = function(headers) {
                var co = this;
                co.headers = headers;
            };

            CacheObject.prototype.setStatusCode = function(statusCode) {
                var co = this;
                co.statusCode = statusCode;
            };

            CacheObject.prototype.countHit = function() {
                var co = this;
                co.hits++;
            };

            // Helpers
            function getCacheKey(req) {
                var md = new MobileDetect(req.headers['user-agent']),
                    cacheKey = ((md.mobile())? '_mobile_' : '') + req.url;

                return cacheKey;
            }

            // Var init

            proxyCache.driver = driver;
            proxyCache.options = options || {};

            proxyCache.proxyTarget = options.targetHost || "localhost:80";
            proxyCache.ignoreRegex = (options.ignoreRegex)?
                    new RegExp(options.ignoreRegex) : undefined;
            proxyCache.proxy = httpProxy.createProxyServer({ // Creates the proxy server
                hostRewrite: true
            });

            proxyCache.urlCache = {};

            // Proxy Event Listeners

            proxyCache.proxy.on('proxyRes', function(proxyRes, req, res){
                proxyRes.on('data', function(chunk){
                    var co = proxyCache.urlCache[getCacheKey(req)];
                    if(co){
                        co.appendData(chunk);
                    }
                });
                proxyRes.on('end', function(){
                    verboseLog("Proxy Response ended for request %s", req.url);
                    var co = proxyCache.urlCache[getCacheKey(req)];
                    if(co){
                        verboseLog("Caching Response code:", proxyRes.statusCode);
                        co.setStatusCode(proxyRes.statusCode);
                        verboseLog("Caching Response headers:", proxyRes.headers);
                        co.setHeaders(proxyRes.headers);
                        // Set external cache
                        if(proxyCache.driver.setCache){
                            verboseLog("Saving cache object to driver storage...");
                            proxyCache.driver.setCache(getCacheKey(req), co)
                                .then(function(res){
                                    console.log("Externally cached: %s", getCacheKey(req));
                                });
                        }
                        console.log("Cached: %s", getCacheKey(req));
                    }
                });
            });

            proxyCache.proxy.on('error', function (err, req, res) {
                console.error(err);

                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });

                res.end('');
            });

            // Create the cache server

            proxyCache.server = http.createServer(function (req, res) {
                verboseLog("IN: %s", req.url);
                verboseLog("Client Request headers:", req.headers);
                var co = proxyCache.urlCache[getCacheKey(req)],
                    shouldCache = ( !proxyCache.ignoreRegex || !proxyCache.ignoreRegex.test(req.url));


                if (!shouldCache) {
                // Skip Cache
                    console.log("SKIP CACHE: %s", req.url);
                    proxyCache.resEndProxied(req, res);
                } else if ( co && co.headers && !/^image\//.test(co.headers["content-type"]) ) { // TODO: how to properly cache images and binary data?
                // Cache hit
                    co.countHit();
                    console.log("HIT: (%s times) %s",co.hits, getCacheKey(req));
                    proxyCache.resEndCached(req, res, co);
                } else {
                // Cache miss -- check external cache if available, if not, make proxy request.
                    console.log("MISS: %s", getCacheKey(req));
                    if (shouldCache){
                        // Try to find external cache
                        if(driver.getCache){
                            driver.getCache(getCacheKey(req))
                                .then(function(serializedCo){
                                    if(serializedCo){
                                        // Cache found in external cache
                                        console.log("HIT (external): %s", getCacheKey(req));
                                        var co = proxyCache.urlCache[getCacheKey(req)] = new CacheObject(serializedCo);
                                        proxyCache.resEndCached(req, res, co);
                                    } else {
                                        // Cache not found in external cache
                                        proxyCache.urlCache[getCacheKey(req)] = new CacheObject(serializedCo);
                                        proxyCache.resEndProxied(req, res);
                                    }
                                });
                        } else {
                        // No external cache source
                            proxyCache.urlCache[getCacheKey(req)] = new CacheObject();
                            proxyCache.resEndProxied(req, res);
                        }
                    }
                }
            }).listen(options.proxyPort || 8181);

            proxyCache.clearAll = function(){
                console.log("Clearing memory cache...");
                var deleteCount = 0;
                for (var k in proxyCache.urlCache){
                    verboseLog("Deleting %s", k);
                    delete proxyCache.urlCache[k];
                    deleteCount++;
                }
                console.log("Deleted %s memory cache objects.",deleteCount);

                // Delete external cache
                if (proxyCache.driver.clearCache){
                    console.log("Clearing external cache...");
                    proxyCache.driver.clearCache();
                }
            };

            if (process.env.npm_config_mem_usage !== undefined){
                setInterval(function(){
                    // TODO: delete some cached objects if memory usage is over threshold
                    verboseLog("Memory usage (resident): %s MB", process.memoryUsage().rss / 1024 / 1024);
                }, 30000);
            }

            return proxyCache;
        };

    ProxyCache.prototype.resEndCached = function(req, res, co){
        for(var headerKey in co.headers){
            res.setHeader(headerKey, co.headers[headerKey]);
        }
        res.statusCode = co.statusCode || 500;
        res.setHeader("X-Cache-Hit", "true");

        res.end(co.data);
    };

    ProxyCache.prototype.resEndProxied = function(req, res){
        var proxyCache = this;
        proxyCache.proxy.web(req, res, {
            target: (process.env.npm_config_http_protocol || 'http') + '://' + proxyCache.proxyTarget
        });
    };

    module.exports = ProxyCache;
}());
