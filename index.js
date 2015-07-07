'use strict';
var ProxyCache = require('./lib/ProxyCache'),
    ProxyCacheMiddleware = function(options){
        var pc = new ProxyCache(options);
        return pc.createMiddleware;
    };

module.exports = ProxyCacheMiddleware;
