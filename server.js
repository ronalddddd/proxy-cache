var ProxyCache = require('./index.js'),
    Promise = require('bluebird'),
    MongoClient = Promise.promisifyAll(require('mongodb').MongoClient),
    Driver = require(process.env.npm_config_driver || './lib//drivers/proxy-cache-mongo');

var driver = new Driver(),
    proxyCache,
    watchInterval = (process.env.npm_config_watch_interval)? parseInt(process.env.npm_config_watch_interval) : 30000,
    watcher;

function StopWatching() {
    if (watcher){
        clearInterval(watcher);
        console.log("Stopped watching publish schedule.");
    }
}

function StartWatching(){
    console.log("Start watching publish schedule.");
    watcher = setInterval(function(){
        driver.checkIfStale()
            .then(function(isStale){
                if (isStale){
                    proxyCache.clearAll();
                }
            });
    }, watchInterval);
}

// MAIN

driver.ready.then(function(){
    proxyCache = new ProxyCache(driver, {
        targetHost: process.env.npm_config_target_host || "localhost",
        ignoreRegex: process.env.npm_config_ignore_regex || undefined,
        proxyPort: (process.env.npm_config_proxy_port)?
            parseInt(process.env.npm_config_proxy_port) : undefined
    });
    StartWatching();
});