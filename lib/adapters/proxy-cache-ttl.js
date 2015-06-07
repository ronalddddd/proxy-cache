(function(){
    var Promise = require('bluebird'),
        verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {};

    function ProxyCacheTTL(){
        var adapter = this,
            d = Promise.defer();

        adapter.lastPubDate = new Date();
        adapter.ttl = (process.env.npm_config_ttl )? parseInt(process.env.npm_config_ttl) :  600000; // defaults to 10 minutes

        // Every adapter must set the `ready` property that is a promise which resolves to indicate the adapter is ready for use
        adapter.ready = d.promise;

        d.resolve(adapter);
        return adapter;
    }

    // Every adapter must implement the checkIfStale function that returns a promise that resolves to a boolean indicating whether cache is stale
    ProxyCacheTTL.prototype.checkIfStale = function(){
        var adapter = this,
            d = Promise.defer(),
            cachedDurationMs = new Date().getTime() - adapter.lastPubDate.getTime(),
            hasExpired = (cachedDurationMs > adapter.ttl);
        console.log("%sms till cache expires.", adapter.ttl - cachedDurationMs);
        adapter.lastPubDate = (hasExpired)? new Date() : adapter.lastPubDate;

        d.resolve(hasExpired);
        return d.promise;
    };

    module.exports = ProxyCacheTTL;
}());