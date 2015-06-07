'use strict';

(function(){

    var verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {},
        http = require('http'),
        httpProxy = require('http-proxy'),
        stream = require("stream"),
        MobileDetect = require('mobile-detect'),
        Promise = require('bluebird'),
        ProxyCache = function(adapter, options){
            var proxyCache = this,
                /**
                 * Cache Object to store proxy response
                 *
                 * @param cacheKey
                 * @param input The input can be either a serialized CachedObject or a http.ServerResponse
                 * @returns {ProxyCache.CacheObject}
                 * @constructor
                 */
                CacheObject = function(cacheKey, input){
                    var co = this,
                        res = (input instanceof stream.Readable)? input : null,
                        jsonString = (typeof input ===  'string')? input : null,
                        deserialized = (jsonString)? JSON.parse(jsonString) : {},
                        d = Promise.defer();

                    co.cacheKey = cacheKey;
                    co.dateISOString = deserialized.dateISOString || new Date().toISOString();
                    co.statusCode = deserialized.statusCode || undefined;
                    co.headers = deserialized.headers || null;
                    co.data = (deserialized.data)? new Buffer(deserialized.data, 'base64') : null;
                    co.buffers = [];
                    co.hits = 0;
                    co.ready = d.promise;
                    co.res = res;

                    // If input is a http.ServerResponse, we create and cache the data when the response finishes
                    if (res){
                        verboseLog("Creating new cache object from http.ServerResponse stream.");
                        // Data available from proxy response -- save it
                        res.on('data', function(chunk){
                            co.appendChunk(chunk);
                        });
                        // Proxy response ended -- save the response status, headers and concat the data buffers collected above
                        res.on('end', function(){
                            verboseLog("Response ended for cache key %s", cacheKey);
                            verboseLog("Caching Response code:", res.statusCode);
                            co.setStatusCode(res.statusCode);
                            verboseLog("Caching Response headers:", res.headers);
                            co.setHeaders(res.headers);
                            // Concat buffers
                            co.data = Buffer.concat(co.buffers);
                            // Set external cache
                            if(proxyCache.adapter.setCache){
                                verboseLog("Saving cache object to adapter storage...");
                                proxyCache.adapter.setCache(cacheKey, co)
                                    .then(function(res){
                                        console.log("Externally cached: %s", cacheKey);
                                        d.resolve(co);
                                    });
                            } else {
                                d.resolve(co);
                            }
                        });
                    } else if (jsonString) {
                        verboseLog("Creating new cache object from serialized cache...");
                        d.resolve(co);
                    } else {
                        d.reject(new Error("CacheObject must be created from a http.ServerResponse or a serialized CacheObject instance."));
                    }

                    co.ready.then(function(res){
                        verboseLog("[%s] Cache object ready", cacheKey);
                    });

                    return co;
                };

            // Cache Object Prototypes

            CacheObject.prototype.toJSON = function() {
                var co = this,
                    serializedData = co.data.toString('base64'), // base64 encode buffer data
                    jsonObject = {
                        dateISOString: co.dateISOString,
                        statusCode: co.statusCode,
                        headers: co.headers,
                        data: serializedData // this is why we need the custom toJSON implementation
                    };

                return JSON.stringify(jsonObject);
            };

            CacheObject.prototype.appendChunk = function(chunk) {
                var co = this;
                co.buffers.push(chunk);
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

            proxyCache.adapter = adapter;
            proxyCache.options = options || {};

            proxyCache.proxyTarget = options.targetHost || "localhost:80";
            proxyCache.ignoreRegex = (options.ignoreRegex)?
                new RegExp(options.ignoreRegex) : undefined;
            proxyCache.proxy = httpProxy.createProxyServer({ // Creates the proxy server
                hostRewrite: false // true
            });

            proxyCache.cacheCollection = {};

            // Proxy Event Listeners

            proxyCache.proxy.on('proxyRes', function(proxyRes, req, res){
                var shouldCache = ( // Conditions of when to apply cache
                ( ! proxyCache.ignoreRegex || ! proxyCache.ignoreRegex.test(req.url) ) || // Case when URL Should be ignored
                ( ! (proxyRes.statusCode > 200) ) ); // Case when upstream response is not 200

                // Ignore Status Codes > 200
                if(proxyRes.statusCode > 200){
                    console.log("[%s] Proxy Response Status Code (%s) > 200, won't cache.", getCacheKey(req), proxyRes.statusCode);
                } else {
                    // Create the cache object
                    new CacheObject(getCacheKey(req), proxyRes)
                        .ready
                        .then(function(co){
                            proxyCache.cacheCollection[co.cacheKey] = co;
                            console.log("Cached %s", co.cacheKey)
                        });
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

            proxyCache.server = http.createServer(function (req, res) {
                verboseLog("IN: %s", req.url);
                verboseLog("Client Request headers:", req.headers);
                var co = proxyCache.cacheCollection[getCacheKey(req)],
                    shouldCache = ( ! proxyCache.ignoreRegex || ! proxyCache.ignoreRegex.test(req.url) );

                if ( co ) {
                    // Cache hit
                    co.countHit();
                    proxyCache.resEndCached(req, res, co);
                    console.log("HIT: (%s times) %s",co.hits, co.cacheKey);
                } else {
                    // Cache miss -- check external cache
                    console.log("MISS: %s", getCacheKey(req));
                    // Try to find external cache
                    if(adapter.getCache && shouldCache){
                        adapter.getCache(getCacheKey(req))
                            .then(function(serializedCo){
                                if(serializedCo){
                                    // Cache found in external cache
                                    console.log("HIT (external): %s", getCacheKey(req));
                                    // Create cache object from serialized data
                                    var co = proxyCache.cacheCollection[getCacheKey(req)] = new CacheObject(getCacheKey(req), serializedCo);
                                    proxyCache.resEndCached(req, res, co);
                                } else {
                                    // Cache not found in external cache
                                    proxyCache.resEndProxied(req, res);
                                }
                            });
                    } else {
                        // No external cache adapter
                        proxyCache.resEndProxied(req, res);
                    }
                }
            }).listen(options.proxyPort || 8181);

            proxyCache.clearAll = function(){
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
        res.setHeader("X-Cache-Date", co.dateISOString);
        res.setHeader("X-Cache-Hits", co.hits);

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
