/* eslint-env mocha */
// Run this specific test using:
// npm test -- -f memory
const http = require('http');
const path = require('path');
const url = require('url');
const fork = require('child_process').fork;
const chalk = require('chalk');
const winston = require('winston');
winston.level = process.env.LOG_LEVEL || 'info';

describe('memory usage', function() {
  let cors_api_url;

  let server;
  let cors_anywhere_child;
  before(function(done) {
    server = http.createServer(function(req, res) {
      res.writeHead(200);
      res.end();
    }).listen(0, function() {
      done();
    });
  });

  after(function(done) {
    server.close(function() {
      done();
    });
  });

  beforeEach(function(done) {
    let cors_module_path = path.join(__dirname, 'child');
    let args = [];
    // Uncomment this if you want to compare the performance of CORS Anywhere
    // with the standard no-op http module.
    // args.push('use-http-instead-of-cors-anywhere');
    cors_anywhere_child = fork(cors_module_path, args, {
      execArgv: ['--expose-gc']
    });
    cors_anywhere_child.once('message', function(cors_url) {
      cors_api_url = cors_url;
      done();
    });
  });

  afterEach(function() {
    cors_anywhere_child.kill();
  });

  /**
   * Perform N CORS Anywhere proxy requests to a simple test server.
   *
   * @param {number} n - number of repetitions.
   * @param {number} requestSize - Approximate size of request in kilobytes.
   * @param {number} memMax - Expected maximum memory usage in kilobytes.
   * @param {function} done - Upon success, called without arguments.
   *   Upon failure, called with the error as parameter.
   */
  function performNRequests(n, requestSize, memMax, done) {
    let remaining = n;
    let request = url.parse(
        cors_api_url + 'http://127.0.0.1:' + server.address().port);
    request.agent = false; // Force Connection: Close
    request.headers = {
      'Long-header': new Array(requestSize * 1e3).join('x')
    };
    (function requestAgain() {
      if (remaining-- === 0) {
        cors_anywhere_child.once('message', function(memory_usage_delta) {
          winston.info(chalk.green('Memory usage delta: ') + chalk.white(memory_usage_delta +
              ' (' + n + ' requests of ' + requestSize + ' kb each)'));
          if (memory_usage_delta > memMax * 1e3) {
            // Note: Even if this error is reached, always profile (e.g. using
            // node-inspector) whether it is a true leak, and not e.g. noise
            // caused by the implementation of V8/Node.js.
            // Uncomment args.push('use-http-instead-of-cors-anywhere') at the
            // fork() call to get a sense of what's normal.
            throw new Error('Possible memory leak: ' + memory_usage_delta +
                ' bytes was not released, which exceeds the ' + memMax +
                ' kb limit by ' +
                Math.round(memory_usage_delta / memMax / 10 - 100) + '%.');
          }
          done();
        });
        cors_anywhere_child.send(null);
        return;
      }
      http.request(request, function() {
        requestAgain();
      }).on('error', function(error) {
        done(error);
      }).end();
    })();
  }

  it('100 GET requests 50k', function(done) {
    // This test is just for comparison with the following tests.
    // On Node 0.10.x, the initial memory usage seems higher on Travis, so use
    // a higher maximum value to avoid flaky tests.
    let memMax = /^v0\./.test(process.version) ? 1200 : 550;
    performNRequests(100, 50, memMax, done);
  });

  // 100x 1k and 100x 50k for comparison.
  // Both should use about the same amount of memory if there is no leak.
  it('1000 GET requests 1k', function(done) {
    // Every request should complete within 10ms.
    this.timeout(1000 * 10);
    performNRequests(1000, 1, 2000, done);
  });
  it('1000 GET requests 50k', function(done) {
    // Every request should complete within 10ms.
    this.timeout(1000 * 10);
    performNRequests(1000, 50, 2000, done);
  });
});
