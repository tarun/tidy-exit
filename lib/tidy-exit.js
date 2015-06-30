/**
 * API to listen to process shutdown signals, allowing one to perform cleanup activities before actually exiting the node process.
 *
 * @module tidy-exit
 *
 * @requires events
 *
 * @example
 * var tidy_exit = require('tidy-exit');
 *
 */

var EventEmitter = require('events').EventEmitter;

// ----------------------------------------------------------------------------
/**
 * // Flow of all functions in a tidy-exit lifecycle
 * // Load
 * var tidy_exit = require('tidy-exit');
 * _init();
 *
 * // Register
 * tidy_exit.addTidyExitHandler(function callback(err, done) {}, 'some info', 1020);
 *  _registerExitListeners();
 * _addExitHandler();
 *
 * // Shutdown
 * process.emit('SIGTERM');
 * _emittidyExitEvent();
 * _registerDefaultTimeoutHandler();
 * getTimeout();
 * event tidy_exit
 * callback
 *
 * // Actual Shutdown
 * event GRACEFUL_DONE
 * _checkHandlersDone
 * process.exit();
 */
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------
/**
  * Operating System signals which should be trapped to initiate a graceful exit.
  * For a full list of signals, plese run `kill -l` on a *nix machine.
  *
  * @private
  * @constant
  * @see {@link _registerExitListeners}
  */
var SYSTEM_EXIT_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGBREAK'];

/**
  * Default timeout for graceful exit handlers to complete before forcing a shutdown.
  *
  * @private
  * @constant
  * @see {@link setMaxTimeout}
  * @see {@link getTimeout}
  */
var DEFAULT_GRACEFUL_TIMEOUT = 2 * 60 * 1000; // 2 MINUTES

/** Constant whose value is the event name used to notify all tidy-exit handlers to shutdown.
 *
 * @private
 * @constant
 * @see {@link _emittidyExitEvent}
 */
var tidy_exit = 'tidyExit';


/**
 * Constant whose value is the event name used by tidy-exit handler callback to say that it is done executing.
 *
 * @private
 * @constant
 * @see {@link _checkHandlersDone}
 */
var GRACEFUL_DONE = 'done';

/**
 * Constant whose value is the property name set on the express app showing the current graceful exit state.
 *
 * @private
 * @constant
 * @see {@link _checkHandlersDone}
 */
var tidy_exit_STATE = 'tidy_exit_state';

// ----------------------------------------------------------------------------
// Variables
// ----------------------------------------------------------------------------
var default_logger = function(){}; // console.log;
var log;


var tidy_exit_event;
var registered_handlers_count;
var exit_signal_handlers;
var listening_to_exit;
var handler_callback_registry;

var max_timeout; // Direct Max Timeout set using setTimeout() - trumps max_handler_timeout
var max_handler_timeout; // Max timeout value specified during exit handlers registration

var default_exit_timer;

/**
 * Set the logger function which needs to be invoked to print status information.
 * By default does not log anything (a noop function). This logger is global to tidy-exit and cannot be set per handler.
 *
 * @public
 * @param {function} logger the function to which a string is passed to print information.
 *
 * @example
 * setLogger(console.log);
 */
function setLogger(logger) {
    log = logger;
}

// ----------------------------------------------------------------------------
// Listen To Shutdown
// ----------------------------------------------------------------------------

/**
 * Helper method to be called when a a shutdown signal is detected.
 * This records a snapshot of the number of tidy-exit listeners which will be used later to determine if all the callback handlers have completed or not.
 *
 *
 * @private
 * @param {string} signal the name of the signal source which triggered the exit flow.
 * @fires tidyExit to notify all the listening tidy-exit handlers
 *
 * @example
 * _emittidyExitEvent('SIGTERM');
 */
function _emittidyExitEvent(signal) {
    _registerDefaultTimeoutHandler(); // Lazy binding default handler - for better timeout period calculation
    registered_handlers_count = EventEmitter.listenerCount(tidy_exit_event, tidy_exit);
    tidy_exit_event.emit(tidy_exit, signal);
}

/*
 * Register the given handler function as a listener to the @param signal event on 'process'.
 * This also saves the handler so that we can remove the listeners as part of a cleanup.
 *
 * @private
 * @param {string} signal the process signal event name
 * @param {function} handler the callback handler to be executed when the signal occurs.
 * @see {@link _cleanupExitListeners}
 */
function _addExitHandler(signal, handler) {
    if (!exit_signal_handlers) {
        exit_signal_handlers = {};
    }
    var handlers = exit_signal_handlers[signal];
    if (!handlers) {
        handlers = [];
    }
    process.once(signal, handler);
    handlers.push(handler);
    exit_signal_handlers[signal] = handlers;
}

/*
 * Register listeners on events which indicate that the process needs to exit.
 * Please note that registering our customer listeners - disables the default node process exit listeners and therefore we have add another default timeout listener.
 *
 * @private
 * @see {@link _defaultExitHandler}
 */
function _registerExitListeners() {
    if (listening_to_exit !== true) {
        // From process handlers like PM2, Naught, etc.
        _addExitHandler('message', function(message) {
            if (message == 'shutdown') {
                _emittidyExitEvent(message);
            }
        });

        // System Signals // https://nodejs.org/api/process.html#process_signal_events
        SYSTEM_EXIT_SIGNALS.forEach(function(signal) {
            _addExitHandler(signal, function() {
                _emittidyExitEvent(signal);
            });
        });

        listening_to_exit = true; // Prevent Duplicate Binding
    }
}

/**
 * Remove all listeners on _process_ registered by tidy-exit.
 *
 * @private
 * @see {@link _addExitHandler}
 */
function _cleanupExitListeners() {
    if (exit_signal_handlers) {
        Object.getOwnPropertyNames(exit_signal_handlers).forEach(function(signal) {
            var signalHandlers = exit_signal_handlers[signal];
            if (signalHandlers && signalHandlers.length > 0) {
                signalHandlers.forEach(function(handler) {
                    try {
                        process.removeListener(signal, handler);
                    } catch(e) {
                         // removing listener on SIGTERM event breaks if the listener does not exist
                         // other event names behave fine (SIGINT, SIGBREAK, etc.)
                        log('Error while removing handler on process.' + signal, e);
                    }
                });
            }
            signalHandlers = exit_signal_handlers[signal] = null;
        });
        listening_to_exit = false;
    }
}

// ----------------------------------------------------------------------------
// Generic Shutdown Handlers
// ----------------------------------------------------------------------------
/**
 * The main tidy-exit method which registers an application exit handler.
 *
 * @public
 * @param {function} appExitHandler the callback function to be invoked when an application shutdown is detected. This function should handle all the cleanup tasks and execute the callback provided to it when done.
 * @param {string} [desc] a short description of this exit handler. used only for logging purposes.
 * @param {number} [timeout] the timeout for this exit handler as provided by the application. the caller does not expect and wants to restrict their callback to the given timeout.
 *
 * @example
 * var tidy_exit = require('tidy-exit');
 * tidy_exit.addTidyExitHandler(function(err, done) {
 *   if (!err) {
 *        // perform cleanup code
 *        done();
 *    }
 * }, 'cleanup my app', 200);
 */
function addTidyExitHandler(appExitHandler, desc, timeout) {
    _registerExitListeners();
    tidy_exit_event.once(tidy_exit,
        function(source) {
            var handler_number = handler_callback_registry.push(0);
            log('Graceful exit triggered by ' + source + ' for ' + desc);
            appExitHandler(null, function() {
                tidy_exit_event.emit(GRACEFUL_DONE, handler_number);
            });
        });

    if (timeout > max_handler_timeout) {
        max_handler_timeout = timeout;
    }
}

/**
 * Check if all the graceful exit handlers are done.
 * If all of them are done, exit the application (without having to wait for the overall timeout).
 * Given a Handler number, mark that handler callback as done.
 *
 * @private
 * @param {number} handler_number the index number assigned to the graceful exit handler to identify which handler callback is done.
 */
function _checkHandlersDone(handler_number) {
    var all_done = false;
    var handler_count = handler_callback_registry.length;
    // Increment Handler Done Count
    if (handler_number) {
        if (handler_number <= handler_count) {
            handler_callback_registry[handler_number - 1]++;
        } else {
            log('Invalid callback handler number: ' + handler_number);
        }
    }

    // Check if all Handlers have been invoked
    if (registered_handlers_count <= handler_count) {
        // Check if all Handlers are done
        all_done = true;
        handler_callback_registry.forEach(function(callback_count) {
            if (callback_count < 1) {
                all_done = false;
            }
        });
        if (all_done === true) {
            process.exit(0);
        }
    }

    return all_done;
}

/**
 * To prevent waiting for a very long time upon exit.
 * Deterime how long to wait before exiting the process based on individual timeouts provided by the application tidy-exit handlers during registration and the max timeout.
 *
 * @returns {number} timeout value in milliseconds to wait before explicitly exiting the process.
 * @see {@link setMaxTimeout}
 */
function getTimeout() {
    var timeout;
    // Max registered handlers timeout - provided it does not exceed the value from setMaxTimeout.
    if (max_handler_timeout && ((!max_timeout) || (max_timeout > max_handler_timeout))) {
        timeout = max_handler_timeout;
    } else if (max_timeout) { // max_timeout set explicitly using setMaxTimeout
        timeout = max_timeout;
    } else { // Default timeout if the application code never specifies a timeout value.
        timeout = DEFAULT_GRACEFUL_TIMEOUT;
    }
    return timeout;
}
/**
 * The maximum amount of time to give to graceful shutdown handlers - before timing out and for exiting.
 * This timeout can be set independent of addTidyExitHandler(...) and this value will be the maximum timeout even if a larger number is passed to addTidyExitHandler.
 *
 * @param {number} timeout the timeout value in milliseconds
 */
function setMaxTimeout(timeout) {
    max_timeout = timeout;
}

/**
 * Default tidy-exit handler which starts a clock for the process to exit forcefully with exit code 1 if the handlers take too long to run.
 * This prevents tidy-exit from hanging the process up forever and never shutting down.
 * This is needed because the moment we start listening on system exit signals - node unbinds the default listeners which properly exit the process.
 *
 * @private
 * @param {error} err error info (falsy if no error)
 * @param {function} done callback function to be executed when done processing.
 */
function _defaultExitHandler(err, done) {
    if (!default_exit_timer) {
        // Suicide Timeout - if the exit handlers callbacks are not done by this time - force quit to prevent hanging forever.
        var timeout = getTimeout();
        default_exit_timer = setTimeout(function() {
            if (!_checkHandlersDone()) { // Check Done once More
                log('Timed out waiting for graceful exit. Quitting hard now');
                process.exit(1);
            }
        }, timeout);
    }
    done();
}

/**
 * Registers the _defaultExitHandler onto the tidy-exit chain.
 * This is done only after a process shutdown is initiated.
 *
 * @private
 * @see {@link _defaultExitHandler}
 * @see {@link _emittidyExitEvent}
 */
function _registerDefaultTimeoutHandler() {
    addTidyExitHandler(_defaultExitHandler, 'default timeout handler');
    tidy_exit_event.on(GRACEFUL_DONE, _checkHandlersDone); // Register Success Handler
}

/**
 * Reset the module to a clean state. Removes all listeners and resets all variables to initial values.
 * Used for initialization and also cleanup afterEach unit test.
 *
 * @protected
 * @name _reset
 */
function _init() {
    handler_callback_registry = [];
    registered_handlers_count = 0;
    if (tidy_exit_event)  {
        tidy_exit_event.removeAllListeners(tidy_exit);
        tidy_exit_event.removeAllListeners(GRACEFUL_DONE);
    }
    tidy_exit_event = new EventEmitter();

    log = default_logger;

    _cleanupExitListeners();

    max_timeout = 0;
    max_handler_timeout = 0;

    clearTimeout(default_exit_timer);
    default_exit_timer = null;
}

// ----------------------------------------------------------------------------
// Application Library/Object Specific Methods
// ----------------------------------------------------------------------------

/**
 * Express Middleware function to check if an app is exiting
 * and notify clients to close connection.
 *
 * @private
 */
function _expresstidyExitHandler(req, res, next) {
    var tidy_exit_state = req.app.get(tidy_exit_STATE);
    if (tidy_exit_state === true) {
        req.connection.setTimeout(1);
    }
    next();
}

/**
 * Bind a process shutdown listener on to the Express App.
 * Signals to clients still making requests to close their connections and reconnect.
 * When combined with hookHttpServer - will wait for a request to be completed and connection closed before exiting.
 *
 * @public
 * @param {express} app Express App object.
 * @see {@link http://expressjs.com/4x/api.html}
 * @example
 * var express = require('express'), tidy_exit = require('tidy-exit');
 *
 * var app = express();
 * tidy_exit.hookExpressApp(app);
 */
function hookExpressApp(app) {
    var tidy_exit_state = app.get(tidy_exit_STATE);
    if (typeof tidy_exit_state === "undefined") { // Don't double bind. Check if already bound

        // Express Middleware
        app.use(_expresstidyExitHandler);
        app.set(tidy_exit_STATE, false);

        // set tidy_exit_state on Express App
        addTidyExitHandler(function(err, done) {
            app.set(tidy_exit_STATE, true);
            done();
        }, 'expressApp');
    }
}

/**
 * Check if the given object looks like an express app - and if so - add tidyExit hook to it.
 *
 * @private
 * @param {object} listener a function/object listening to request which should be detected and processed as an express app.
 *
 * @example
 * server.listeners('request').forEach(_detectAndHookExpressApp);
 *
 * @example
 * _detectAndHookExpressApp(app);
 */
function _detectAndHookExpressApp(listener) {
    // Duck Typing detection if the listener is an express app (check if all the methods exist)
    var known_methods = ['use', 'set', 'get'];
    var is_express = known_methods.every(function(method_name) {
        return (typeof listener[method_name] === "function");
    });

    if (is_express) { // if all the needed express signature methods exist - register the tidyExitHandler on it.
        hookExpressApp(listener);
    }
}

/**
 * Bind a process shutdown listener on to the Http Server..
 * Notifies the server to close its listener so that the process can shutdown gracefully.
 * Will wait for a request to be completed and connection closed before exiting.
 *
 * @public
 * @param {net.Server} app nodejs server object (from http.createServer() call.()
 * @see {@link https://nodejs.org/api/net.html#net_class_net_server}
 *
 * @param {boolean} [hook_apps=true] whether to check and bind known handlers on the server instance.
 *
 * @example
 * var http = require('http'), tidy_exit = require('tidy-exit');
 *
 * var server = http.createServer();
 * tidy_exit.hookHttpServer(server);
 *
 * @example
 * var server = http.createServer(function(...));
 * tidy_exit.hookHttpServer(server, false);
 */
function hookHttpServer(server, hook_apps) {
    addTidyExitHandler(function(err, done) {
        server.close(done);
    }, 'httpServer');

    if (hook_apps !== false) { // default true (undefined = true)
        // Look for Express Apps and Bind on express();
        server.listeners('request').forEach(_detectAndHookExpressApp);
    }
}

// ----------------------------------------------------------------------------
// Prepare to be Executed
// ----------------------------------------------------------------------------
_init();

// ----------------------------------------------------------------------------
// Public API Exports
// ----------------------------------------------------------------------------
module.exports = {
    // Helper Methods
    _reset: _init,

    // Config Methods
    setLogger: setLogger,

    setMaxTimeout: setMaxTimeout,
    getTimeout: getTimeout,

    // Core API Methods
    addTidyExitHandler: addTidyExitHandler,

    // Application object specific methods
    hookExpressApp: hookExpressApp,
    hookHttpServer: hookHttpServer
};
