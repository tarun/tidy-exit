# Introduction
 NodeJS Tidy Exit - api hooks to detect shutdown and perform cleanup actions for a graceful tidy application exit.

# Goal
Successfully finish processing in-progress requests before shutting down instead of abruptly abandoning them.

# Approach
* Listen to process shutdown events
* When  an event occurs
 * stop accepting new requests
 * close existing connections
 * wait to finish processing exisitng requests
* exit process after a timeout or when all requests are done

# Library Integration
* ExpressJS
* NodeJS Net Server

# Usage

    var tidy_exit = require('tidy-exit');

    tidy_exit.addtidyExitHandler(function(err, done) {
        console.log('Shutting down');
        done();
    });

    var app = express();
    tidy_exit.hookExpressApp(app);

    var server = http.createServer(app);
    tidy_exit.hookHttpServer(server);


# Inspiration & References
[https://github.com/mathrawka/express-tidy-exit]()

[http://glynnbird.tumblr.com/post/54739664725/graceful-server-shutdown-with-node-js-and-express]()

[http://blog.argteam.com/coding/hardening-node-js-for-production-part-3-zero-downtime-deployments-with-nginx/]()
