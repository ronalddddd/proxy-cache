'use strict';
var ProxyCache = require('./lib/ProxyCache'),
    ProxyCacheMiddleware = function(adapter, options){
        var pc = new ProxyCache(adapter, options);
        return pc.middleware;
    };

module.exports = ProxyCacheMiddleware;
