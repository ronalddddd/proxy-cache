var ProxyCache = require('./index.js'),
    Promise = require('bluebird'),
    MongoClient = Promise.promisifyAll(require('mongodb').MongoClient),
    builtInAdapter = (process.env.npm_config_mongodb_url)? './lib/adapters/proxy-cache-mongo' : './lib/adapters/proxy-cache-ttl',
    selectedAdapter = process.env.npm_config_adapter || builtInAdapter,
    Driver = require(selectedAdapter);

var adapter = new Driver(),
    proxyCache,
    watchInterval = (process.env.npm_config_watch_interval)? parseInt(process.env.npm_config_watch_interval) : 30000,
    watcher;

function StopWatching() {
    if (watcher){
        clearInterval(watcher);
        console.log("Stopped watcher for stale checking.");
    }
}

function StartWatching(){
    console.log("Started watcher for stale checking.");
    watcher = setInterval(function(){
        adapter.checkIfStale()
            .then(function(isStale){
                if (isStale){
                    proxyCache.clearAll();
                }
            });
    }, watchInterval);
}

// MAIN
console.log("Using adapter %s",selectedAdapter);
adapter.ready.then(function(){
    console.log("Adapter is ready.");
    proxyCache = new ProxyCache(adapter, {
        targetHost: process.env.npm_config_target_host || "localhost",
        ignoreRegex: process.env.npm_config_ignore_regex || undefined,
        proxyPort: (process.env.npm_config_proxy_port)?
            parseInt(process.env.npm_config_proxy_port) : undefined
    });
    StartWatching();
});