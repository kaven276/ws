var http = require('http')
  , https = require('https')
  , WebSocket = require('../')
  , WebSocketServer = WebSocket.Server
  , fs = require('fs')
  , should = require('should');

var port = 20000;

function getArrayBuffer(buf) {
  var l = buf.length;
  var arrayBuf = new ArrayBuffer(l);
  for (var i = 0; i < l; ++i) {
    arrayBuf[i] = buf[i];
  }
  return arrayBuf;
}

function areArraysEqual(x, y) {
  if (x.length != y.length) return false;
  for (var i = 0, l = x.length; i < l; ++i) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

describe('WebSocketServer', function() {
  describe('#ctor', function() {
    it('throws an error if no option object is passed', function() {
      var gotException = false;
      try {
        var wss = new WebSocketServer();
      }
      catch (e) {
        gotException = true;
      }
      gotException.should.be.ok;
    });

    it('throws an error if no port or server is specified', function() {
      var gotException = false;
      try {
        var wss = new WebSocketServer({});
      }
      catch (e) {
        gotException = true;
      }
      gotException.should.be.ok;
    });

    it('does not throw an error if no port or server is specified, when the noServer option is true', function() {
      var gotException = false;
      try {
        var wss = new WebSocketServer({noServer: true});
      }
      catch (e) {
        gotException = true;
      }
      gotException.should.eql(false);
    });

    it('emits an error if http server bind fails', function(done) {
      var wss = new WebSocketServer({port: 1});
      wss.on('error', function() { done(); });
    });

    it('starts a server on a given port', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var ws = new WebSocket('ws://localhost:' + port);
      });
      wss.on('connection', function(client) {
        wss.close();
        done();
      });
    });

    it('uses a precreated http server', function (done) {
      var srv = http.createServer();
      srv.listen(++port, function () {
        var wss = new WebSocketServer({server: srv});
        var ws = new WebSocket('ws://localhost:' + port);

        wss.on('connection', function(client) {
          wss.close();
          srv.close();
          done();
        });
      });
    });

    it('can have two different instances listening on the same http server with two different paths', function(done) {
      var srv = http.createServer();
      srv.listen(++port, function () {
        var wss1 = new WebSocketServer({server: srv, path: '/wss1'})
          , wss2 = new WebSocketServer({server: srv, path: '/wss2'});
        var doneCount = 0;
        wss1.on('connection', function(client) {
          wss1.close();
          if (++doneCount == 2) {
            srv.close();
            done();
          }
        });
        wss2.on('connection', function(client) {
          wss2.close();
          if (++doneCount == 2) {
            srv.close();
            done();
          }
        });
        var ws1 = new WebSocket('ws://localhost:' + port + '/wss1');
        var ws2 = new WebSocket('ws://localhost:' + port + '/wss2?foo=1');
      });
    });

    it('cannot have two different instances listening on the same http server with the same path', function(done) {
      var srv = http.createServer();
      srv.listen(++port, function () {
        var wss1 = new WebSocketServer({server: srv, path: '/wss1'});
        try {
          var wss2 = new WebSocketServer({server: srv, path: '/wss1'});
        }
        catch (e) {
          wss1.close();
          srv.close();
          done();
        }
      });
    });
  });

  describe('#close', function() {
    it('will close all clients', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var ws = new WebSocket('ws://localhost:' + port);
        ws.on('close', function() {
          if (++closes == 2) done();
        });
      });
      var closes = 0;
      wss.on('connection', function(client) {
        client.on('close', function() {
          if (++closes == 2) done();
        });
        wss.close();
      });
    });

    it('does not close a precreated server', function(done) {
      var srv = http.createServer();
      var realClose = srv.close;
      srv.close = function() {
        should.fail('must not close pre-created server');
      }
      srv.listen(++port, function () {
        var wss = new WebSocketServer({server: srv});
        var ws = new WebSocket('ws://localhost:' + port);
        wss.on('connection', function(client) {
          wss.close();
          srv.close = realClose;
          srv.close();
          done();
        });
      });
    });

    it('cleans up websocket data on a precreated server', function(done) {
      var srv = http.createServer();
      srv.listen(++port, function () {
        var wss1 = new WebSocketServer({server: srv, path: '/wss1'})
          , wss2 = new WebSocketServer({server: srv, path: '/wss2'});
        (typeof srv._webSocketPaths).should.eql('object');
        Object.keys(srv._webSocketPaths).length.should.eql(2);
        wss1.close();
        Object.keys(srv._webSocketPaths).length.should.eql(1);
        wss2.close();
        (typeof srv._webSocketPaths).should.eql('undefined');
        srv.close();
        done();
      });
    });
  });

  describe('connection establishing', function() {
    it('does not accept connections with no sec-websocket-key', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket'
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          res.statusCode.should.eql(400);
          wss.close();
          done();
        });
      });
      wss.on('connection', function(ws) {
        done(new Error('connection must not be established'));
      });
      wss.on('error', function() {});
    });

    it('does not accept connections with no sec-websocket-version', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          res.statusCode.should.eql(400);
          wss.close();
          done();
        });
      });
      wss.on('connection', function(ws) {
        done(new Error('connection must not be established'));
      });
      wss.on('error', function() {});
    });

    it('does not accept connections with invalid sec-websocket-version', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 12
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          res.statusCode.should.eql(400);
          wss.close();
          done();
        });
      });
      wss.on('connection', function(ws) {
        done(new Error('connection must not be established'));
      });
      wss.on('error', function() {});
    });

    it('client can be denied', function(done) {
      var wss = new WebSocketServer({port: ++port, verifyClient: function(o) {
        return false;
      }}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 8,
            'Sec-WebSocket-Origin': 'http://foobar.com'
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          res.statusCode.should.eql(401);
          process.nextTick(function() {
            wss.close();
            done();
          });
        });
      });
      wss.on('connection', function(ws) {
        done(new Error('connection must not be established'));
      });
      wss.on('error', function() {});
    });

    it('client can be accepted', function(done) {
      var wss = new WebSocketServer({port: ++port, verifyClient: function(o) {
        return true;
      }}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 13,
            'Origin': 'http://foobar.com'
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          res.statusCode.should.eql(401);
        });
      });
      wss.on('connection', function(ws) {
          ws.terminate();
          wss.close();
          done();
      });
      wss.on('error', function() {});
    });

    it('verifyClient gets client origin', function(done) {
      var wss = new WebSocketServer({port: ++port, verifyClient: function(info) {
        info.origin.should.eql('http://foobarbaz.com');
        return false;
      }}, function() {
        var options = {
          port: port,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 13,
            'Origin': 'http://foobarbaz.com'
          }
        };
        var req = http.request(options);
        req.end();
        req.on('response', function(res) {
          wss.close();
          done();
        });
      });
      wss.on('error', function() {});
    });

    it('verifyClient has secure:true for ssl connections', function(done) {
      var options = {
        key: fs.readFileSync('test/fixtures/key.pem'),
        cert: fs.readFileSync('test/fixtures/certificate.pem')
      };
      var app = https.createServer(options, function (req, res) {
        res.writeHead(200);
        res.end();
      });
      var success = false;
      var wss = new WebSocketServer({
        server: app, 
        verifyClient: function(info) {
          success = info.secure === true;
          return true;
        }
      });
      app.listen(++port, function() {
        var ws = new WebSocket('wss://localhost:' + port);
      });
      wss.on('connection', function(ws) {
        app.close();
        ws.terminate();
        wss.close();
        success.should.be.ok;
        done();
      });
    });

    it('verifyClient has secure:false for non-ssl connections', function(done) {
      var app = http.createServer(function (req, res) {
        res.writeHead(200);
        res.end();
      });
      var success = false;
      var wss = new WebSocketServer({
        server: app, 
        verifyClient: function(info) {
          success = info.secure === false;
          return true;
        }
      });
      app.listen(++port, function() {
        var ws = new WebSocket('ws://localhost:' + port);
      });
      wss.on('connection', function(ws) {
        app.close();
        ws.terminate();
        wss.close();
        success.should.be.ok;
        done();
      });
    });
  });

  it('can send data', function(done) {
    var wss = new WebSocketServer({port: ++port}, function() {
      var ws = new WebSocket('ws://localhost:' + port);
      ws.on('message', function(data, flags) {
        data.should.eql('hello!');
        wss.close();
        done();
      });
    });
    wss.on('connection', function(client) {
      client.send('hello!');
    });
  });

  describe('client properties', function() {
    it('protocol is exposed', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var ws = new WebSocket('ws://localhost:' + port, {protocol: 'hi'});
      });
      wss.on('connection', function(client) {
        client.protocol.should.eql('hi');
        wss.close();
        done();
      });
    });

    it('protocolVersion is exposed', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var ws = new WebSocket('ws://localhost:' + port, {protocolVersion: 8});
      });
      wss.on('connection', function(client) {
        client.protocolVersion.should.eql(8);
        wss.close();
        done();
      });
    });

    it('upgradeReq is the original request object', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        var ws = new WebSocket('ws://localhost:' + port, {protocolVersion: 8});
      });
      wss.on('connection', function(client) {
        client.upgradeReq.httpVersion.should.eql('1.1');
        wss.close();
        done();
      });
    });
  });

  describe('#clients', function() {
    it('returns a list of connected clients', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        wss.clients.length.should.eql(0);
        var ws = new WebSocket('ws://localhost:' + port);
      });
      wss.on('connection', function(client) {
        wss.clients.length.should.eql(1);
        wss.close();
        done();
      });
    });

    it('is updated when client terminates the connection', function(done) {
      var ws;
      var wss = new WebSocketServer({port: ++port}, function() {
        ws = new WebSocket('ws://localhost:' + port);
      });
      wss.on('connection', function(client) {
        client.on('close', function() {
          wss.clients.length.should.eql(0);
          wss.close();
          done();
        });
        ws.terminate();
      });
    });

    it('is updated when client closes the connection', function(done) {
      var ws;
      var wss = new WebSocketServer({port: ++port}, function() {
        ws = new WebSocket('ws://localhost:' + port);
      });
      wss.on('connection', function(client) {
        client.on('close', function() {
          wss.clients.length.should.eql(0);
          wss.close();
          done();
        });
        ws.close();
      });
    });
  });

  describe('#options', function() {
    it('exposes options passed to constructor', function(done) {
      var wss = new WebSocketServer({port: ++port}, function() {
        wss.options.port.should.eql(port);
        wss.close();
        done();
      });
    });
  });

  describe('#handleUpgrade', function() {
    it('can be used for a pre-existing server', function (done) {
      var srv = http.createServer();
      srv.listen(++port, function () {
        var wss = new WebSocketServer({noServer: true});
        srv.on('upgrade', function(req, socket, upgradeHead) {
          var client = wss.handleUpgrade(req, socket, upgradeHead);
          client.send('hello');
        });
        var ws = new WebSocket('ws://localhost:' + port);
        ws.on('message', function(message) {
          message.should.eql('hello');
          wss.close();
          srv.close();
          done();
        })
      });
    });
  });

});
