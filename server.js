var ProxyCache = require('./lib/ProxyCache'),
    express = require('express'),
    compression = require('compression'),
    builtInAdapter = (process.env.npm_config_mongodb_url)? './lib/adapters/proxy-cache-mongo' : './lib/adapters/proxy-cache-ttl',
    selectedAdapter = process.env.npm_config_adapter || builtInAdapter,
    Adapter = require(selectedAdapter),
    proxyPort = (process.env.npm_config_proxy_port)? parseInt(process.env.npm_config_proxy_port) : 8181,
    targetHost = process.env.npm_config_target_host || "localhost:8080",
    spoofHostHeader = (process.env.npm_config_spoof_host_header !== undefined),
    staleCaching = (process.env.npm_config_stale_caching !== undefined),
    ignorePattern = process.env.npm_config_ignore_pattern,
    ignoreList = [],
    app = express();

if (ignorePattern){
    ignorePatternArray = ignorePattern.split(',');
    ignorePatternArray.forEach(function(ignorePatternString) {
        ignoreList.push(new RegExp(ignorePatternString));
    })
    console.log('Using ignore list:', ignoreList);
}

console.log("Using adapter %s",selectedAdapter);
console.log("Creating proxy to %s", targetHost);
var proxyCache = new ProxyCache({
    Adapter: Adapter,
    targetHost: targetHost,
    spoofHostHeader: spoofHostHeader,
    allowStaleCache: true, //staleCaching,
    ignoreList: ignoreList
});

app.use(compression());
app.use(proxyCache.createMiddleware());

proxyCache.ready.then(function(){
    console.log("Starting Proxy Cache Server...");
    app.listen(proxyPort, function(){
        console.log("ProxyCache server is ready");
    });
});
