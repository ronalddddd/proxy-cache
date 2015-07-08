var verboseLog = (process.env.npm_config_verbose_log)? console.log : function() {},
    Promise = require('bluebird'),
    stream = require("stream");


/**
 * Cache Object to store proxy response
 *
 * @param cacheKey {string} - The unique identifier for this cache object
 * @param input {string | http.ServerResponse} - The input can be either a serialized CachedObject or a http.ServerResponse
 * @param req {http.ClientRequest=} - Optional http request object for debugging
 * @returns {CacheObject}
 * @constructor
 */
var CacheObject = function(cacheKey, input, req){
    var co = this,
        res = (input instanceof stream.Readable)? input : null,
        jsonString = (typeof input ===  'string')? input : null,
        deserialized = (jsonString)? JSON.parse(jsonString) : {},
        d = Promise.defer();

    // Save some debug info based about the original request
    if (req){
        co.debug = {
            req_url: req.url,
            req_headers: req.headers
        };
    }

    //console.log("debug jsonString", jsonString);
    //console.log("debug deserialized", deserialized);
    //console.log("debug typeof deserialized", typeof deserialized);

    co.cacheKey = cacheKey;
    co.dateISOString = deserialized.dateISOString || new Date().toISOString();
    co.statusCode = deserialized.statusCode || undefined;
    co.headers = deserialized.headers || null;
    co.data = (deserialized.data)? new Buffer(deserialized.data, 'base64') : null;
    co.buffers = [];
    co.hits = 0;
    co.pooled = 0;
    co._d = d;
    co.ready = d.promise;
    co.res = res;

    // HTTP Archive Request Object http://www.softwareishard.com/blog/har-12-spec/#request
    //console.log(req);
    co.request = req;

    //console.log("debug co", co);

    // If input is a http.ServerResponse, we create and cache the data when the response finishes
    if (res){
        verboseLog("Creating new cache object from http.ServerResponse stream.");
        co.setProxyResponseStream(res);
    } else if (jsonString) {
        verboseLog("Creating new cache object from serialized cache...");
        d.resolve(co);
    } else {
        verboseLog("Created new cache object with no upstream data. Cache Object will not be ready until upstream response is set with `setProxyResponseStream()`");
        //d.reject(new Error("CacheObject must be created from a http.ServerResponse or a serialized CacheObject instance."));
    }

    co.ready
        .then(function(res){
            verboseLog("[%s] Cache object ready", co.cacheKey);
            co.pooled = 0; // reset pooled counter;
        })
        .catch(function(err){
            console.warn("[%s] Cache object failed to ready: %s", co.cacheKey, err.toString());
        });

    return co;
};

CacheObject.prototype.setSerializedInput = function(input) {
    var co = this,
        deserialized = JSON.parse(input);

    co.dateISOString = deserialized.dateISOString || new Date().toISOString();
    co.statusCode = deserialized.statusCode || undefined;
    co.headers = deserialized.headers || null;
    co.data = (deserialized.data)? new Buffer(deserialized.data, 'base64') : null;

    co._d.resolve(co);
};

CacheObject.prototype.setProxyResponseStream = function(proxyRes) {
    var co = this;

    // Data available from proxy response -- save it
    proxyRes.on('data', function(chunk){
        co.appendChunk(chunk);
    });
    // Proxy response ended -- save the response status, headers and concat the data buffers collected above
    proxyRes.on('end', function(){
        verboseLog("Response ended for cache key %s", co.cacheKey);
        verboseLog("Caching Response code:", proxyRes.statusCode);
        co.setStatusCode(proxyRes.statusCode);
        verboseLog("Caching Response headers:", proxyRes.headers);
        co.setHeaders(proxyRes.headers);

        // Concat buffers
        co.data = Buffer.concat(co.buffers);

        // Validate data before caching
        if (!co.data || !co.data.length || co.data.length === 0){ // Empty response -- don't cache
            co._d.reject(new Error("Empty upstream response"));
        } else {
            co._d.resolve(co);
        }
    });
};

CacheObject.prototype.toJSON = function() {
    var co = this,
        serializedData = co.data.toString('base64'), // base64 encode buffer data
        jsonObject = {
            dateISOString: co.dateISOString,
            statusCode: co.statusCode,
            headers: co.headers,
            data: serializedData, // this is why we need the custom toJSON implementation,
            //request: co.request,
            debug: co.debug || {}
        };

    return jsonObject;
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

CacheObject.prototype.countPooled = function() {
    var co = this;
    co.pooled++;
};

module.exports = CacheObject;