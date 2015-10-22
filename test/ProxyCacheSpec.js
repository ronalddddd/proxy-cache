"use strict";
var expect = require('chai').expect,
    ProxyCache = require('../lib/ProxyCache'),
    adapter = require('../lib/adapters/proxy-cache-ttl'),
    http = require('http'),
    Promise = require('bluebird'),
    request = Promise.promisifyAll(require('request')),
    MD = require('mobile-detect'),
    crypto = require('crypto'),
    _ = require('lodash'),

    builtInAdapter = (process.env.npm_config_mongodb_url)? '../lib/adapters/proxy-cache-mongo' : '../lib/adapters/proxy-cache-ttl',
    selectedAdapter = process.env.npm_config_adapter || builtInAdapter,
    Adapter = require(selectedAdapter);

var memGiBThreshold = 0.25,
    randomDataSizeBytes = memGiBThreshold *1024*1024*1024 / 16,
    ignoreList = [];

process.env.npm_config_verbose_log = true;

function printMemUsage(){
    console.log("Memory usage after requests: %s GiB",process.memoryUsage().rss / 1073741824);
}

describe("ProxyCache.js", function () {
    describe("A proxyCache instance", function(){
        var proxyCache,
            proxyCacheServer,
            timeout = 0,
            prevStatus = 200,
            target = http.createServer(function(req, res){
                console.log(req.url, req.headers);
                switch(req.url){
                    case '/emptyResponse':
                        res.end('');
                        break;
                    case '/hello':
                        res.end('hello');
                        break;
                    case '/dateISOString':
                        res.end(new Date().toISOString());
                        break;
                    case '/mobileDetect':
                        timeout += 500; // every subsequent call will take longer to return
                        setTimeout(function(){
                            var md = new MD(req.headers['user-agent']),
                                device = ((md.phone())? 'phone' : 'not_phone');
                            res.end(device);
                        }, timeout);
                        break;
                    case '/code404':
                        res.statusCode = 404;
                        res.end('');
                        break;
                    case '/code500':
                        res.statusCode = 500;
                        res.end('');
                        break;
                    case '/200then500':
                        res.statusCode = prevStatus;
                        prevStatus = (prevStatus === 200)? 500 : 200;
                        res.end('200then500');
                        break;
                    case '/delay':
                        setTimeout(function(){res.end('delayed')}, 1000);
                        break;
                    default:
                        if (req.url.indexOf("/randomData") == 0){
                            res.end(crypto.randomBytes(randomDataSizeBytes)); // 268435456 Bytes (0.25 GiB) divided by 16
                        } else if (req.url.indexOf("/echo") == 0){
                            var message = req.url.split('/');

                            message = (message.length > 2)? message[2] : "NO MESSAGE";
                            res.end(message);
                        } else {
                            throw new Error("UNEXPECTED URL");
                        }
                }
            }).listen(8801),
            resetProxyCache = function(options, ready){
                timeout = 0;

                if (proxyCacheServer) {
                    proxyCacheServer.close();
                }

                proxyCache = new ProxyCache(options);

                proxyCacheServer = http.createServer(function (req, res) {
                    proxyCache.handleRequest(req, res);
                }).listen(8181);

                proxyCache.ready.then(function(){
                    ready();
                });
            };

        beforeEach(function(ready){
            resetProxyCache({
                Adapter: Adapter,
                targetHost: "localhost:8801",
                memGiBThreshold: memGiBThreshold,
                memCheckIntervalMs: 0,
                ignoreList: ignoreList
            }, ready);
        });

        afterEach(function(done){
            ignoreList = [];
            done();
        });

        it("should not cache an empty response", function(done){
            request.getAsync('http://localhost:8181/emptyResponse')
                .then(function(res){
                    expect(proxyCache.cacheCollection["not_phone:localhost:8181:/emptyResponse"]).not.to.exist; // check that empty upstream responses are not cached
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should not cache responses with HTTP codes > 200", function(done){
            Promise.all([
                    request.getAsync('http://localhost:8181/code404')
                        .then(function(res){
                            expect(proxyCache.cacheCollection["not_phone:localhost:8181:/code404"]).not.to.exist; // check that empty upstream responses are not cached
                        }),
                    request.getAsync('http://localhost:8181/code500')
                        .then(function(res){
                            expect(proxyCache.cacheCollection["not_phone:localhost:8181:/code500"]).not.to.exist; // check that empty upstream responses are not cached
                        })
                ])
                .then(function(res){
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should cache the right device types (not_phone)", function(done){ // try to fool the server to cache a mobile site and serve it to desktop
            request.getAsync('http://localhost:8181/mobileDetect', {
                headers: {
                    'User-Agent': "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4"
                }
            });
            request.getAsync('http://localhost:8181/mobileDetect', {
                headers: {
                    'User-Agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.124 Safari/537.36"
                }
            })
                .then(function(res){
                    var co = proxyCache.cacheCollection["not_phone:localhost:8181:/mobileDetect"];
                    expect(co).to.exist;
                    expect(new Buffer(co.data, 'base64').toString()).to.equal("not_phone");
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should cache the right device types (phone)", function(done){
            request.getAsync('http://localhost:8181/mobileDetect', {}); // try to fool the server to cache a desktop site and serve it to mobile
            request.getAsync('http://localhost:8181/mobileDetect', {headers: {
//                'User-Agent': "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4"
                'User-Agent': "Mozilla/5.0 (Linux; Android 5.0.2; SM-G9250 Build/LRX22G; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/43.0.2357.121 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/35.0.0.48.273;]" // MD detect fails to detect this as phone in versions > 0.4.3
            }})
                .then(function(res){
                    var co = proxyCache.cacheCollection["phone:localhost:8181:/mobileDetect"];
                    expect(co).to.exist;
                    expect(new Buffer(co.data, 'base64').toString()).to.equal("phone");
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should be able to clear memory cache by calling `clearAll()`", function(done){
            request.getAsync('http://localhost:8181/hello', {})
                .then(function(res){
                    return request.getAsync('http://localhost:8181/hello', {})
                })
                .then(function(res2){
                    var co = proxyCache.cacheCollection["not_phone:localhost:8181:/hello"];
                    expect(co).to.exist;
                    expect(co.hits).to.equal(1);
                    proxyCache.clearAll();
                    expect(proxyCache.cacheCollection["not_phone:localhost:8181:/hello"]).not.to.exist;
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should pool requests to the same URL", function(done){
            proxyCache.clearAll();
            var test = function(){
                console.log("Testing cache pooling...");
                Promise.all([
                        request.getAsync('http://localhost:8181/delay', {}),
                        request.getAsync('http://localhost:8181/delay', {}),
                        request.getAsync('http://localhost:8181/delay', {}),
                        request.getAsync('http://localhost:8181/delay', {})
                    ])
                    .then(function(res){
                        done();
                    })
                    .catch(function(err){
                        done(err);
                    });

                setTimeout(function checkCacheObjectPool(){
                    //console.log(proxyCache.cacheCollection);
                    var co = proxyCache.cacheCollection["not_phone:localhost:8181:/delay"];
                    expect(co).to.exist;
                    expect(co.pooled).to.be.greaterThan(0);
                }, 300);
            };
            setTimeout(test, 500); // wait for adapter cache to clear (i.e. mongodb adapter)
        });

        it("should respond to all pooled requests when proxy response completes.", function(done){
            var request1 = request.getAsync('http://localhost:8181/delay')
                    .spread(function(res, body){
                        expect(body).to.equal('delayed');
                    }),
                request2 = request.getAsync('http://localhost:8181/delay')
                    .spread(function(res, body){
                        expect(body).to.equal('delayed');
                    });

            Promise.all([request1, request2])
                .then(function(){
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should asynchronously update cache if allowStaleCache option is enabled", function(done){
            var prevData,
                url = 'http://localhost:8181/dateISOString',
                expectedCacheKey = "not_phone:localhost:8181:/dateISOString";
            timeout = 0;

            if (proxyCacheServer) {
                proxyCacheServer.close();
            }

            proxyCache = new ProxyCache({
                Adapter: Adapter,
                targetHost: "localhost:8801",
                ignoreRegex: undefined,
                allowStaleCache: true
            });

            proxyCache.ready.then(function(){
                proxyCacheServer = http.createServer(function (req, res) {
                    proxyCache.handleRequest(req, res);
                }).listen(8181);

                request.getAsync({
                    url: url,
                    headers: {foo: "bar"}
                })
                    .then(function(res){
                        return request.getAsync(url, {}); // create the cache entry
                    })
                    .then(function(res2){
                        var co = proxyCache.cacheCollection[expectedCacheKey];
                        expect(co).to.exist;
                        expect(co.hits).to.equal(1);
                        proxyCache.clearAll();
                        expect(co.stale).to.exist.and.equal(true);
                        expect(proxyCache.cacheCollection[expectedCacheKey]).to.exist;
                        console.log(proxyCache.cacheCollection[expectedCacheKey].data);

                        prevData = co.data;

                        console.log("Triggering update.");
                        return request.getAsync(url, {}); // trigger the update
                    })
                    .then(function(res3){
                        expect(proxyCache.cacheCollection[expectedCacheKey]).to.exist;
                        expect(proxyCache.cacheCollection[expectedCacheKey].stale).to.exist.and.equal(true);
                        expect(proxyCache.cacheCollection[expectedCacheKey].data).to.exist.and.equal(prevData); // confirm that we've been served the staled cache first
                        console.log(proxyCache.cacheCollection[expectedCacheKey].data);

                        expect(proxyCache.cacheCollection[expectedCacheKey]._updatePromise).to.exist;
                        return proxyCache.cacheCollection[expectedCacheKey]._updatePromise
                            .then(function(res){
                                console.log("Cache should be done updating.");
                                // Make the request again and check if the cache has been updated
                                return request.getAsync(url, {});
                            });
                    })
                    .spread(function(res4, body){
                        var co = proxyCache.cacheCollection[expectedCacheKey];
                        expect(co).to.exist;
                        expect(co.stale).to.exist.and.equal(false);
                        expect(co.data).to.exist.and.not.equal(prevData); // confirm that cache data has been updated
                        expect(co.statusCode).to.exist.and.lte(200); // "OK" status code should be set
                        expect(co.dateISOString).to.exist; // cache date should be set
                        expect(co.lastUpdated).to.exist; // last updated date should be set
                        expect(res4.headers["x-cache-updated"]).to.exist; // last updated date header should be set
                        console.log(co.data);
                        done();
                    })
                    .catch(function(err){
                        done(err);
                    });
            });
        });

        it("checkMemory() should invoke freeMemory() if threshold is reached (memGiBThreshold is set at "+memGiBThreshold+" for this test)", function(done){
            this.timeout(35000);
            var requestArr = [],
                lastCacheCount = 0,
                expectedCacheCountRemaining = 1;

            console.log("Memory usage before requests: %s GiB",process.memoryUsage().rss / 1073741824);

            for(var i=0; i < (memGiBThreshold * 1024 * 1024 * 1024 / randomDataSizeBytes) + expectedCacheCountRemaining; i++){ // make just enough request to exceed `proxyCache.options.memGiBThreshold`
                requestArr.push(request.getAsync('http://localhost:8181/randomData?sequence='+i, {})); // 268435456 Bytes (0.25 GiB) divided by 16
            }

            Promise.all(requestArr)
                .then(function(res){
                    lastCacheCount = _.size(proxyCache.cacheCollection);
                    console.log("Memory usage after requests: %s GiB",process.memoryUsage().rss / 1073741824);
                    console.log("Calling memory check");
                    proxyCache.checkMemory(); // invoke this manually
                    if(global.gc){
                        global.gc();
                        console.log("Memory usage after GC: %s GiB",process.memoryUsage().rss / 1073741824);
                    }
                    expect(_.size(proxyCache.cacheCollection)).to.not.equal(lastCacheCount);
                    done();
                });
        });

        it("freeMemory() should remove just enough cache items to meet requested memory to free)", function(done){
            this.timeout(35000);
            var requestArr = [],
                lastCacheCount = 0,
                expectedCacheCountRemaining = 1;

            console.log("Memory usage before requests: %s GiB",process.memoryUsage().rss / 1073741824);

            for(var i=0; i < (memGiBThreshold * 1024 * 1024 * 1024 / randomDataSizeBytes) + expectedCacheCountRemaining; i++){ // make just enough request to exceed `proxyCache.options.memGiBThreshold`
                requestArr.push(request.getAsync('http://localhost:8181/randomData?sequence='+i, {}));
            }

            Promise.all(requestArr)
                .then(function(res){
                    lastCacheCount = _.size(proxyCache.cacheCollection);
                    console.log("Memory usage after requests: %s GiB",process.memoryUsage().rss / 1073741824);
                    console.log("Calling freeMemory");
                    proxyCache.freeMemory(memGiBThreshold * 1024 * 1024 * 1024); // should free up memGiBThreshold / randomDataSizeBytes worth of cache objects
                    if(global.gc){
                        global.gc();
                        console.log("Memory usage after GC: %s GiB",process.memoryUsage().rss / 1073741824);
                    }
                    expect(_.size(proxyCache.cacheCollection)).to.equal(expectedCacheCountRemaining);
                    done();
                });
        });

        it("should invoke checkMemory at set intervals and free up cache items when memory threshold is exceeded)", function(done){
            this.timeout(45000);
            var requestArr = [],
                lastCacheCount = 0,
                expectedCacheCountRemaining = 1,
                numberOfRequests = (memGiBThreshold * 1024 * 1024 * 1024 / randomDataSizeBytes) + expectedCacheCountRemaining,
                memCheckIntervalMs = numberOfRequests * 1500; // assuming 1 request takes about 1.5seconds to complete

            resetProxyCache({
                Adapter: Adapter,
                targetHost: "localhost:8801",
                memGiBThreshold: memGiBThreshold,
                memCheckIntervalMs: memCheckIntervalMs
            }, function(){
                console.log("Memory usage before requests: %s GiB",process.memoryUsage().rss / 1073741824);

                for(var i=0; i < numberOfRequests; i++){ // make just enough request to exceed `proxyCache.options.memGiBThreshold`
                    requestArr.push(request.getAsync('http://localhost:8181/randomData?sequence='+i, {})
                        .then(function(res){
                            lastCacheCount = _.size(proxyCache.cacheCollection); // update the last cache count immediately
                        }));
                }

                Promise.all(requestArr)
                    .then(function(res){
                        // Wait for the memory check to happen and clear up cache objects
                        setTimeout(function(){
                            console.log("Memory usage after requests: %s GiB",process.memoryUsage().rss / 1073741824);
                            expect(_.size(proxyCache.cacheCollection)).to.be.lt(lastCacheCount); // some cache objects should be deleted by now
                            done();
                        }, memCheckIntervalMs * 0.7); // guessing wait time for the memory check interval
                    });
            });

        });

        it("should delete cache object if the request response in updateCacheObject() has a response code greater than 200", function(done){
            var prevData,
                url = 'http://localhost:8181/200then500',
                expectedCacheKey = "not_phone:localhost:8181:/200then500";
            timeout = 0;

            if (proxyCacheServer) {
                proxyCacheServer.close();
            }

            proxyCache = new ProxyCache({
                Adapter: Adapter,
                targetHost: "localhost:8801",
                ignoreRegex: undefined,
                allowStaleCache: true
            });

            proxyCache.ready.then(function(){
                proxyCacheServer = http.createServer(function (req, res) {
                    proxyCache.handleRequest(req, res);
                }).listen(8181);

                request.getAsync({
                    url: url,
                    headers: {foo: "bar"}
                })
                    .then(function(res){
                        return request.getAsync(url, {}); // create the cache entry
                    })
                    .then(function(res2){
                        var co = proxyCache.cacheCollection[expectedCacheKey];
                        expect(co).to.exist;
                        expect(co.hits).to.equal(1);
                        proxyCache.clearAll();
                        expect(co.stale).to.exist.and.equal(true);
                        expect(proxyCache.cacheCollection[expectedCacheKey]).to.exist;
                        console.log(proxyCache.cacheCollection[expectedCacheKey].data);

                        prevData = co.data;

                        console.log("Triggering update.");
                        return request.getAsync(url, {}); // trigger the update
                    })
                    .then(function(res3){
                        expect(proxyCache.cacheCollection[expectedCacheKey]).to.exist;
                        expect(proxyCache.cacheCollection[expectedCacheKey].stale).to.exist.and.equal(true);
                        expect(proxyCache.cacheCollection[expectedCacheKey].data).to.exist.and.equal(prevData); // confirm that we've been served the staled cache first
                        console.log(proxyCache.cacheCollection[expectedCacheKey].data);

                        expect(proxyCache.cacheCollection[expectedCacheKey]._updatePromise).to.exist;
                        return proxyCache.cacheCollection[expectedCacheKey]._updatePromise
                            .catch(function(res){ // expect the update to fail because of the 500 status code
                                console.log("Expected failure for cache update.");
                                return request.getAsync(url, {}); // make another request, which should return 200
                            });
                    })
                    .spread(function(res4, body){
                        var co = proxyCache.cacheCollection[expectedCacheKey];
                        expect(co).to.exist;
                        expect(co.stale).to.not.exist;
                        expect(co.statusCode).to.exist.and.lte(200); // "OK" status code should be set
                        expect(co.dateISOString).to.exist; // cache date should be set
                        expect(co.lastUpdated).to.not.exist; // last updated date should be set
                        expect(res4.headers["x-cache-updated"]).to.not.exist; // should be a brand new cache object
                        console.log(co.data);
                        done();
                    })
                    .catch(function(err){
                        done(err);
                    });
            });
        });

        it("clearAll(keyRegex) should only clear regex matching cache objects when regex is given", function(done){ // try to fool the server to cache a mobile site and serve it to desktop
            this.timeout(45000);
            var requests = [],
                context = this;

            requests.push(request.getAsync('http://localhost:8181/delay', {}));
            requests.push(request.getAsync('http://localhost:8181/hello', {}));
            Promise.all(requests)
                .then(function(res){
                    context.res = res;
                    proxyCache.clearAll(/.*\/hello/);
                    return new Promise(function(resolve, reject){
                        setTimeout(function(){ // wait for clearAll to finish clearing external cache, which is async.
                            resolve(this.res);
                        }.bind(context), 3000);
                    });
                })
                .then(function(res){
                    var coDelay = proxyCache.cacheCollection["not_phone:localhost:8181:/delay"];
                    var coHello = proxyCache.cacheCollection["not_phone:localhost:8181:/hello"];
                    expect(coDelay).to.exist;
                    expect(coHello).not.to.exist;
                    done();
                })
                .catch(function(err){
                    done(err);
                });
        });

        it("should not cache routes specified in the ProxyCache#ignoreList", function(done){
            this.timeout(5000);
            var requests = [],
                context = this,
                reset = new Promise(function(resolve, reject){
                    resetProxyCache({
                        Adapter: Adapter,
                        targetHost: "localhost:8801",
                        memGiBThreshold: memGiBThreshold,
                        memCheckIntervalMs: 0,
                        ignoreList: [/\/echo\/?$/]
                    }, function (){
                        resolve();
                    }.bind(this));
                });

            reset.then(function(){
                console.log('ignoreList: ', proxyCache.ignoreList);
                requests.push(request.getAsync('http://localhost:8181/echo', {}));
                requests.push(request.getAsync('http://localhost:8181/echo/', {}));
                requests.push(request.getAsync('http://localhost:8181/echo/foo', {}));
                Promise.all(requests)
                    .then(function(res){
                        var coEcho1 = proxyCache.cacheCollection["not_phone:localhost:8181:/echo"];
                        var coEcho2 = proxyCache.cacheCollection["not_phone:localhost:8181:/echo/"];
                        var coEcho3 = proxyCache.cacheCollection["not_phone:localhost:8181:/echo/foo"];
                        expect(coEcho1).not.to.exist;
                        expect(coEcho2).not.to.exist;
                        expect(coEcho3).to.exist;
                        done();
                    })
                    .catch(function(err){
                        done(err);
                    });
            });
        });
    });
});
