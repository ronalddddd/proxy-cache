var ProxyCache = require('./lib/ProxyCache'),
    Promise = require('bluebird'),
    MongoClient = Promise.promisifyAll(require('mongodb').MongoClient),
    http = require('http'),
    builtInAdapter = (process.env.npm_config_mongodb_url)? './lib/adapters/proxy-cache-mongo' : './lib/adapters/proxy-cache-ttl',
    selectedAdapter = process.env.npm_config_adapter || builtInAdapter,
    Adapter = require(selectedAdapter),
    proxyPort = (process.env.npm_config_proxy_port)? parseInt(process.env.npm_config_proxy_port) : 8181,
    targetHost = process.env.npm_config_target_host || "localhost:8080",
    watchInterval = (process.env.npm_config_watch_interval)? parseInt(process.env.npm_config_watch_interval) : 30000;

console.log("Using adapter %s",selectedAdapter);
console.log("Creating proxy to %s", targetHost);
var proxyCache = new ProxyCache({
    Adapter: Adapter,
    targetHost: targetHost,
    ignoreRegex: process.env.npm_config_ignore_regex || undefined
});

proxyCache.ready.then(function(){
    console.log("Starting Proxy Cache Server...");
    http.createServer(function (req, res) {
        proxyCache.handleRequest(req, res);
    }).listen(proxyPort, function(){
        console.log("ProxyCache server is ready");
    });
});
