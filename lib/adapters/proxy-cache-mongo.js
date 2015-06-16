(function(){
    var Promise = require('bluebird'),
        MongoClient = Promise.promisifyAll(require('mongodb').MongoClient),
        verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {};

    function ProxyCacheMongoDriver(){
        var adapter = this;

        adapter.db = undefined;
        adapter.cacheCollection = undefined;
        adapter.pubSchedule = undefined;
        adapter.lastPubDate = undefined;
        // Every adapter must set the `ready` property that is a promise which resolves to indicate the adapter is ready for use
        adapter.ready = MongoClient
            .connectAsync(process.env.npm_config_mongodb_url || "mongodb://localhost:27017/test")
            .then(function(res){
                adapter.db = res;
                // Get collections
                adapter.cacheCollection = Promise.promisifyAll(adapter.db.collection(process.env.npm_config_db_cache_collection || 'ProxyCache'));
                adapter.pubSchedule = Promise.promisifyAll(adapter.db.collection(process.env.npm_config_db_schedule_collection || 'PublishSchedule'));

                return Promise.all([
                    // Ensure Indexs
                    adapter.cacheCollection.ensureIndexAsync("key")
                ]);
            })
            .catch(function(err){
                console.error("Error connecting to DB: ",err);
                throw err;
            });

        return adapter;
    }

    // Every adapter must implement the checkIfStale function that returns a promise that resolves to a boolean indicating whether cache is stale
    ProxyCacheMongoDriver.prototype.checkIfStale = function(){
        var adapter = this;

        if(!adapter.lastPubDate){
            verboseLog("Publish date not set.");
            return adapter.pubSchedule
                .findOneAsync(
                {
                    "publish_date": {
                        $lte: new Date().toISOString()
                    }
                },{},{
                    sort: { publish_date: -1 }
                })
                .then(function(res){
                    verboseLog(res);
                    adapter.lastPubDate = (res)? res.publish_date : new Date().toISOString();
                    verboseLog("Last Publish Date set to: %s", adapter.lastPubDate);
                    return false;
                });
        } else {
            return adapter.pubSchedule
                .findOneAsync({
                    "publish_date": {
                        $lte: new Date().toISOString(),
                        $gt: adapter.lastPubDate
                    }
                },{},{
                    sort: { publish_date: -1 }
                })
                .then(function(res){
                    if(res){
                        adapter.lastPubDate = res.publish_date;
                        verboseLog("Last Publish Date set to: %s", adapter.lastPubDate);
                        return true;
                    } else {
                        verboseLog("Nothing to publish.");
                        return false;
                    }
                });
        }
    };

    // Optionally implement an external cache storage interfaces
    if (process.env.npm_config_use_external_cache !== undefined){
        ProxyCacheMongoDriver.prototype.setCache = function(key, cacheObject) {
            var adapter = this;
            return adapter.cacheCollection.updateAsync({key: key},{key: key, value: JSON.stringify(cacheObject), debug: cacheObject.debug || null},{upsert: true});
        };

        ProxyCacheMongoDriver.prototype.getCache = function(key) {
            var adapter = this;
            return adapter.cacheCollection.findOneAsync({key: key})
                .then(function(res){
                    return (res)? res.value : null;
                });
        };

        ProxyCacheMongoDriver.prototype.clearCache = function() {
            var adapter = this;
            return adapter.cacheCollection.removeAsync()
                .then(function(res){
                    console.log("External mongodb cache cleared.");
                });
        };
    }

    module.exports = ProxyCacheMongoDriver;
}());