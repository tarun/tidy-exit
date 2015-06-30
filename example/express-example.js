var http = require('http'),
    express = require('express'),
    tidy_exit = require('..'); // should be require('tidy-exit')


var port = parseInt(process.env.PORT, 10) || 3000;
var ip = process.env.IP || '';

var app = express();
tidy_exit.hookExpressApp(app);

app.use('/test/hello', function(req, res) {
    var delay = Math.floor(Math.random() * 5000);
    setTimeout(function() {
        res.status(200).send('hello, world (after ' + delay + ' milliseconds).');
    }, delay);
});

app.set('port', port);
var server = http.createServer(app);
tidy_exit.hookHttpServer(server);
server.listen(port, ip);

tidy_exit.addTidyExitHandler(function(err, done) {
    console.log('Shutting down');
    done();
});

console.log('Listening on Port ' + port);
console.log('http://' + ((ip) ? ip : 'localhost') + ':' + port + '/test/hello');
