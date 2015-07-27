var tidy_exit = require('../');
var sinon = require('sinon'),
    chai = require('chai'),
    expect = chai.expect,
    assert = chai.assert;

var http = require('http'),
    express = require('express');

var supertest = require('supertest');

describe('test http tidyExit', function() {
    var sinon_sandbox;
    var mock_process;

    var handler;
    var request;
    var exit_handles;

    function pExit() {
        process.emit('message', 'shutdown');
    }

    function createServer(http_handler) {
        handler = http_handler;
        var server = http.createServer(handler);
        exit_handles.push(tidy_exit.hookHttpServer(server));
        request = supertest(server);
        return request;
    }

    function createExpressApp(app) {
        function expressHandler(req, res, next) {
            var delay = req.params.delay || Math.floor(Math.random() * 1000);
            setTimeout(function() {
                res.status(200).send('hello, world (after ' + delay + ' milliseconds).');
                next();
            }, delay);

            if (req.originalUrl.indexOf('Exit') > 0) {
                pExit();
            }
        }

        app = app || express();
        app.use('/test/:delay', expressHandler);
        app.use('/testExit/:delay', expressHandler);
        return app;
    }

    // ------------------------------------------------------------
    // Mock Lifecycle (similar to tidy-exit.lib.js)
    // ------------------------------------------------------------

    before(function() {
        // tidy_exit.setLogger(console.log);
        sinon_sandbox = sinon.sandbox.create();
    });
    beforeEach(function() {
        mock_process = sinon_sandbox.mock(process);
        exit_handles = [];
    });
    afterEach(function () {
        exit_handles = null;
        sinon_sandbox.restore(mock_process);
        tidy_exit._reset(); // This reset must be in the afterEach block. if in the before block - it will leak listeners on mocha repeats tests while watching the file.
    });
    after(function(){
        sinon_sandbox = sinon.sandbox.restore();
    });

    // ------------------------------------------------------------
    // Test all permutations of using tidy-exit on express and node server objects.
    // ------------------------------------------------------------

    describe('test httpServer tidyExit (native handler, without express)', function () {
        function httpHandler(req, res) {
            var url_parts = req.url.split('/');
            var delay = parseInt(url_parts[url_parts.length - 1], 10) || Math.floor(Math.random() * 1000);

            setTimeout(function() {
                res.statusCode = 200;
                res.end('hello, world (after ' + delay + ' milliseconds).');
            }, delay);

            if (req.url.indexOf('Exit') > 0) {
                pExit();
            }
        }

        beforeEach('prepare httpServer', function () {
            createServer(httpHandler);
        });

        testServer();
    });

    describe('test removing express tidyExit listener upon close', function() {
        var app = createExpressApp();
        var exit_handle = tidy_exit.hookExpressApp(app);
        expect(exit_handle).to.exist;
        assert.isFunction(exit_handle.close);
        exit_handle.close();
    });

    describe('test express tidyExit is last handler', function () {
        beforeEach('prepare express app', function () {
            var app = createExpressApp();
            exit_handles.push(tidy_exit.hookExpressApp(app));
            request = supertest(app);
        });

        testServer();
    });

    describe('test express tidyExit is first handler', function () {
        beforeEach('prepare express app', function () {
            var app = express();
            exit_handles.push(tidy_exit.hookExpressApp(app));
            app = createExpressApp(app);
            request = supertest(app);
        });

        testServer();
    });

    describe('test express and httpServer tidyExit is last handler and http tidyExit handler is after express', function () {
        beforeEach('prepare express app', function () {
            var app = createExpressApp();
            exit_handles.push(tidy_exit.hookExpressApp(app));
            createServer(app);
        });

        testServer();
    });

    describe('test express and httpServer tidyExit is first handler and http tidyExit handler is after express', function () {
        beforeEach('prepare express app', function () {
            var app = express();
            exit_handles.push(tidy_exit.hookExpressApp(app));
            app = createExpressApp(app);
            createServer(app);
        });

        testServer();
    });

    describe('test express and httpServer tidyExit is last handler and http tidyExit handler is before express', function () {
        beforeEach('prepare express app', function () {
            var app = createExpressApp();
            createServer(app);
            exit_handles.push(tidy_exit.hookExpressApp(app));
        });

        testServer();
    });

    describe('test express and httpServer tidyExit is first handler and http tidyExit handler is before express', function () {
        beforeEach('prepare express app', function () {
            var app = express();
            exit_handles.push(tidy_exit.hookExpressApp(app));
            app = createExpressApp(app);
            createServer(app);
            exit_handles.push(tidy_exit.hookExpressApp(app));
        });

        testServer();
    });

    describe('test express and httpServer tidyExit when express is bound via http server listeners', function () {
        beforeEach('prepare httpServer with Express app', function () {
            var app = createExpressApp();
            createServer(app);
        });

        testServer();
    });

    /**
     * Test if the server exits gracefully for all time periods.
     */
    function testServer() {
        it('should work fine without any exits', function(done) {
            request.get('/test/10').expect(200, done);
        });

        var delays = [100, 500, 1000, 1500];
        delays.forEach(function(delay) {
            it('should finish processing request before exiting', function(done) {
                mock_process.expects('exit').once().withArgs(0);
                request.get('/testExit/' + delay)
                .expect('connection', 'close')
                .expect(200, function() {
                    setTimeout(function() {
                        mock_process.verify();
                        done();
                    }, 50);
                });
            });
        });

        it('should finish processing all requests before exiting', function(done) {
            mock_process.expects('exit').once().withArgs(0);
            var i = 0;
            var exiting = false;
            delays.forEach(function(delay) {
                request.get('/test/' + delay)
                .set('connection', 'keep-alive')
                .expect('connection', exiting ? 'close' : 'keep-alive')
                .expect(200)
                .end(function(req, res) {
                    i++;
                    if (i > delays.length / 2) {
                        pExit();
                        exiting = true;
                    }
                });
            });

            var testDelay = Math.max.apply(null, delays) + 100;
            setTimeout(function() {
                expect(i).to.equal(delays.length);
                if (typeof handler.get === 'function') {
                    var tidy_exit_state = handler.get('tidy_exit_state');
                    expect(tidy_exit_state).to.be.true;
                }
                mock_process.verify();
                done();
            }, testDelay);
        });

        it('should set express app property', function() {
            if (typeof handler.get === 'function') {
                var tidy_exit_state = handler.get('tidy_exit_state');
                expect(tidy_exit_state).to.be.false; // no exit request made yet
            }
        });

        it('should remove exit listeners upon calling handle.close', function(done) {
            mock_process.expects('exit').never();
            expect(exit_handles).to.be.not.empty;
            exit_handles.forEach(function(exit_handle) {
                if (exit_handle) { // repeated bindings have empty handles
                    exit_handle.close();
                }
            });

            request.get('/testExit/' + 10)
            .expect('connection', 'close')
            .expect(200, function() {
                setTimeout(function() {
                    mock_process.verify();
                    done();
                }, 50);
            });
        });
    }


    describe('test hookHttpServer hook_apps', function() {
        var app;

        function getExitState() {
            return app.get('tidy_exit_state');
        }

        beforeEach(function() {
            app = express();
        });

        it('should bind app by default', function() {
            var server = http.createServer(app);
            tidy_exit.hookHttpServer(server);
            expect(getExitState()).to.exist;
        });

        it('should bind app if hook_app is true', function() {
            var server = http.createServer(app);
            tidy_exit.hookHttpServer(server, true);
            expect(getExitState()).to.exist;
        });

        it('should not bind app if hook_app is false', function() {
            var server = http.createServer(app);
            tidy_exit.hookHttpServer(server, false);
            expect(getExitState()).to.not.exist;
        });

        it('should not bind app twice', function() {
            var server = http.createServer(app);
            tidy_exit.hookHttpServer(server);
            expect(getExitState()).to.exist;
            expect(tidy_exit.hookExpressApp(app)).to.be.undefined;
        });
    });
});
