(function(){
    var Promise = require('bluebird'),
        MongoClient = Promise.promisifyAll(require('mongodb').MongoClient),
        verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {};

    function ProxyCacheMongoDriver(){
        var driver = this;

        driver.db = undefined;
        driver.cacheCollection = undefined;
        driver.pubSchedule = undefined;
        driver.lastPubDate = undefined;
        // Every driver must set the `ready` property that is a promise which resolves to indicate the driver is ready for use
        driver.ready = MongoClient
            .connectAsync(process.env.npm_config_mongodb_url || "mongodb://localhost:27017/test")
            .then(function(res){
                driver.db = res;
                // Get collections
                driver.cacheCollection = Promise.promisifyAll(driver.db.collection(process.env.npm_config_db_cache_collection || 'ProxyCache'));
                driver.pubSchedule = Promise.promisifyAll(driver.db.collection(process.env.npm_config_db_schedule_collection || 'PublishSchedule'));

                return Promise.all([
                    // Ensure Indexs
                    driver.cacheCollection.ensureIndexAsync("key")
                ]);
            })
            .catch(function(err){
                console.error("Error connecting to DB: ",err);
                throw err;
            });

        return driver;
    }

    // Every driver must implement the checkIfStale function that returns a promise that resolves to a boolean indicating whether cache is stale
    ProxyCacheMongoDriver.prototype.checkIfStale = function(){
        var driver = this;

        if(!driver.lastPubDate){
            verboseLog("Publish date not set.");
            return driver.pubSchedule
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
                    driver.lastPubDate = (res)? res.publish_date : new Date().toISOString();
                    verboseLog("Last Publish Date set to: %s", driver.lastPubDate);
                    return false;
                });
        } else {
            return driver.pubSchedule
                .findOneAsync({
                    "publish_date": {
                        $lte: new Date().toISOString(),
                        $gt: driver.lastPubDate
                    }
                },{},{
                    sort: { publish_date: -1 }
                })
                .then(function(res){
                    if(res){
                        driver.lastPubDate = res.publish_date;
                        verboseLog("Last Publish Date set to: %s", driver.lastPubDate);
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
            var driver = this;
            return driver.cacheCollection.updateAsync({key: key},{key: key, value: JSON.stringify(cacheObject)},{upsert: true});
        };

        ProxyCacheMongoDriver.prototype.getCache = function(key) {
            var driver = this;
            return driver.cacheCollection.findOneAsync({key: key})
                .then(function(res){
                    return (res)? res.value : null;
                });
        };

        ProxyCacheMongoDriver.prototype.clearCache = function() {
            var driver = this;
            return driver.cacheCollection.removeAsync()
                .then(function(res){
                    console.log("External mongodb cache cleared.");
                });
        };
    }

    module.exports = ProxyCacheMongoDriver;
}());