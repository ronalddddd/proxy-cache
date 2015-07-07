var Promise = require('bluebird'),
    verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {};

function ProxyCacheTTL(proxyCache, options){
    var adapter = this,
        d = Promise.defer();

    options = options || {};
    adapter.proxyCache = proxyCache;
    adapter.lastPubDate = new Date();
    adapter.ttl = (process.env.npm_config_ttl )? parseInt(process.env.npm_config_ttl) :  600000; // defaults to 10 minutes

    adapter.watcher = setInterval(function(){
        verboseLog("proxy-cache-ttl: Clearing cache now");
        adapter.proxyCache.clearAll();
    }, adapter.ttl);

    console.log("TTL set to %sms", adapter.ttl);
    return adapter;
}

module.exports = ProxyCacheTTL;
