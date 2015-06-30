var tidy_exit = require('../');
var sinon = require('sinon'),
    chai = require('chai'),
    expect = chai.expect,
    assert = chai.assert;

describe('tidy-exit', function () {

    // ------------------------------------------------------------
    // Mock Lifecycle
    // ------------------------------------------------------------
    var sinon_sandbox;
    var mock_process;

    before(function() {
        // Mocha runner listens to SIGINT to abort, emitting process.SIGINT event will abort the test runner.
        // Uncomment this to test SIGINT locally - mocha will have to be manually stopped (also uncomment SIGINT below).
        // process.removeAllListeners('SIGINT');
        sinon_sandbox = sinon.sandbox.create();
    });
    beforeEach(function() {
        mock_process = sinon_sandbox.mock(process);
    });
    afterEach(function () {
       sinon_sandbox.restore(mock_process);

       // This reset must be in the afterEach block. if in the before block - it will leak listeners on mocha repeats tests while watching the file.
       tidy_exit._reset();
    });
    after(function(){
        sinon_sandbox = sinon.sandbox.restore();
    });


    // ------------------------------------------------------------
    // The Tests
    // ------------------------------------------------------------
    describe('api signature check', function() {
        it('should check if api methods exist', function() {
            var API_METHODS = ['addtidyExitHandler', 'hookHttpServer', 'hookExpressApp', 'setMaxTimeout', 'getTimeout', 'setLogger', '_reset'];
            API_METHODS.forEach(function(functionName) {
                expect(tidy_exit).to.exist;
                assert.isFunction(tidy_exit[functionName], '"' + functionName + '" should be function on tidy_exit module exports/api.');
            });
        });
    });

    function buildTestExitHandler(customHandler, timeout) {
        return function(err, callback) {
            setTimeout(function() {
                customHandler();
                mock_process.verify();
            }, timeout || 1);
            callback();
        };
    }

    // Run the same test for multiple signals
    [{
        signal: 'message',
        invalidSignal: 'message',
        validArg: 'shutdown',
        invalidArg: 'not-shutdown'
    },
    { signal: 'SIGTERM' },
    { signal: 'SIGBREAK' }
    // , { signal: 'SIGINT' }
    ].forEach(function(event_info) {
        var signal = event_info.signal;
        describe('invoke graceful exit handler with process.' + signal, function() {

            it('should exit on shutdown message', function(done) {
                mock_process.expects('exit').once().withArgs(0);
                tidy_exit.addtidyExitHandler(buildTestExitHandler(done));

                process.emit(signal, event_info.validArg);
            });

            it('should not exit on message other than shutdown', function(done) {
                var handler = sinon.spy();
                mock_process.expects('exit').never();
                setTimeout(function() {
                    expect(handler.called).to.be.false;
                    mock_process.verify();
                    done();
                }, 200);
                tidy_exit.addtidyExitHandler(handler, 'test', 100);

                process.emit(event_info.invalidSignal, event_info.invalidArg);
            });

            it('should exit with error code when exitHandler times out', function(done) {
                var handler = sinon.spy();

                mock_process.expects('exit').once().withArgs(1);

                tidy_exit.addtidyExitHandler(handler, 'test no callback', 100);
                process.emit(signal, event_info.validArg);

                setTimeout(function() {
                    expect(handler.called).to.be.true;
                    mock_process.verify();
                    done();
                }, 200);
            });

        });

    });

    function pExit(exitCode) {
        mock_process.expects('exit').once().withArgs(exitCode || 0);
        process.emit('message', 'shutdown');
    }

    describe('exit timeout calculation', function() {
        it('should use default timeout', function() {
            expect(tidy_exit.getTimeout()).to.be.at.least(60 * 1000);
            pExit();
        });

        it('should use max timeout when set', function() {
            var max_timeout = 2421;
            tidy_exit.setMaxTimeout(max_timeout);
            expect(tidy_exit.getTimeout()).to.equal(max_timeout);
        });

        it('should use handler timeouts when specified', function() {
            var handler_timeout = 322;
            tidy_exit.addtidyExitHandler(null, null, handler_timeout);
            expect(tidy_exit.getTimeout()).to.equal(handler_timeout);
        });

        it('should use handler timeouts when specified, even if max timeout is set', function() {
            var max_timeout = 1231;
            var handler_timeout = 322;
            tidy_exit.addtidyExitHandler(null, null, handler_timeout);
            tidy_exit.setMaxTimeout(max_timeout);
            expect(tidy_exit.getTimeout()).to.equal(handler_timeout);
        });

        it('should use handler timeouts when specified, even if max timeout was set before handlers', function() {
            var max_timeout = 1231;
            var handler_timeout = 322;
            tidy_exit.setMaxTimeout(max_timeout);
            tidy_exit.addtidyExitHandler(null, null, handler_timeout);
            expect(tidy_exit.getTimeout()).to.equal(handler_timeout);

            tidy_exit.setMaxTimeout(null);
            expect(tidy_exit.getTimeout()).to.equal(handler_timeout);
        });

        it('should use max timeout if specified - if handler timeouts are larger then max timeout', function() {
            var max_timeout = 1231;
            var handler_timeout = max_timeout * 2;
            tidy_exit.addtidyExitHandler(null, null, handler_timeout);
            tidy_exit.setMaxTimeout(max_timeout);
            expect(tidy_exit.getTimeout()).to.equal(max_timeout);
        });

        it('should use max timeout if specified - if handler timeouts are larger then max timeout and max timeout was set before handlers', function() {
            var max_timeout = 1231;
            var handler_timeout = max_timeout * 2;
            tidy_exit.setMaxTimeout(max_timeout);
            tidy_exit.addtidyExitHandler(null, null, handler_timeout);
            expect(tidy_exit.getTimeout()).to.equal(max_timeout);
        });
    });

    describe('exit on timeout', function() {
        var sinon_clock;

        beforeEach(function() {
            sinon_clock = sinon_sandbox.useFakeTimers();
        });
        afterEach(function () {
            sinon_clock.restore();
        });

        it('should exit on set max timeout', function(done) {
            var spy = sinon_sandbox.spy();
            tidy_exit.setMaxTimeout(200);
            tidy_exit.addtidyExitHandler(spy, 'test max timeout', 1000);
            expect(tidy_exit.getTimeout()).to.equal(200);

            setTimeout(function() {
                expect(spy.called).to.be.true;
                mock_process.verify();
                done();
            }, 300);
            pExit(1);
            sinon_clock.tick(500);
        });

        it('should exit on provided handler timeout', function(done) {
            var override_timeout = 1000;
            var spy = sinon_sandbox.spy();

            tidy_exit.addtidyExitHandler(spy, 'test max timeout', override_timeout);
            expect(tidy_exit.getTimeout()).to.equal(override_timeout);

            setTimeout(function() {
                expect(spy.called).to.be.true;
                mock_process.verify();
                done();
            }, override_timeout + 100);

            pExit(1);
            sinon_clock.tick(1500);
        });

        it('should exit on or before default timeout when no ovverrides are specified', function(done) {
            var spy = sinon_sandbox.spy();
            var default_timeout = tidy_exit.getTimeout();

            expect(default_timeout).to.be.at.least(60 * 1000);

            tidy_exit.addtidyExitHandler(spy, 'test max timeout');
            setTimeout(function() {
                expect(spy.called).to.be.true;
                mock_process.verify();
                done();
            }, default_timeout + 100);

            pExit(1);

            // Time Travel
            sinon_clock.tick(default_timeout + 200);
        });
    });

    describe('set logger', function() {
        it('should print to my custom logger', function(done) {
            var spy = sinon_sandbox.spy();
            tidy_exit.setLogger(spy);
            tidy_exit.addtidyExitHandler(buildTestExitHandler(function() {
                expect(spy.called).to.be.true;
                done();
            }), 'test logger', 100);

            pExit();
        });

        it('should print to my custom logger (set after registering handler)', function(done) {
            var spy = sinon_sandbox.spy();
            tidy_exit.addtidyExitHandler(buildTestExitHandler(function() {
                expect(spy.called).to.be.true;
                done();
            }), 'test logger', 100);
            tidy_exit.setLogger(spy);
            pExit();
        });
    });

});
