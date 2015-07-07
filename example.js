var ProxyCache = require('./index.js'),
    express = require('express'),
    app = express();

var proxyCache = new ProxyCache({
    targetHost: "www.apple.com:80",
    spoofHostHeader: true
});

app.use(proxyCache.createMiddleware());

proxyCache.ready.then(function() {
    app.listen(8181, function () {
        console.log("ProxyCache server is ready");
    });
});
