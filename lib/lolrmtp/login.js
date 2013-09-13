var logger = require('../logger');
var https = require('https');

exports.getAuthKey = function (config, callback) {
    tryLogin(config, function (err, data) {
        if (err) {
            return callback(err);
        }

        if (data.token) {
            return callback(data.token);
        }

        if (data.status === 'FAILED') {
            return callback('Error logging in: ' + data.reason);
        }

        var id = 0,
            current = 0;

        for (var i = 0; i < data.tickers.length; i++) {
            if (data.tickers[i].node != data.node)
                continue;

            id = data.tickers[i].id;
            current = data.tickers[i].current;
        }

        // Wait in the queue
        return tickQueue(config, data, id, current, callback);
    });
};

function tryLogin(config, callback) {
    var options = {
        host: config.host,
        port: 443, //ssh
        path: '/login-queue/rest/queue/authenticate',
        method: 'POST',
        rejectUnauthorized: false
    };

    logger.info('Requesting authentication');
    var payload = encodeURIComponent('user=' + config.username + ',password=' + config.password);
    var req = https
        .request(options, function (res) {
            res.on('data', function beginLoginData(data) {
                logger.info('Received: ' + data);
                data = JSON.parse(data);
                callback(null, data);
            });
        })
        .on('error', function beginLoginError(err) {
            callback(err);
        });

    req.write('payload=' + payload);
    req.end();
}

/**
 * @param {{host: string, username: string }} config
 * @param {{node: number, rate: number, champ: string, delay: number}} data
 *  node - the id of the queue
 *  champ - the name of the queue
 *  rate - how many tickets are processed every queue update
 *  delay - how often queue status updates
 * @param {number} id Our ticket in line
 * @param {number} current The current ticket being processed
 * @param callback
 */
function tickQueue(config, data, id, current, callback) {
    logger.info("In login queue (#" + (id - current) + " in line)");
    if (id - current <= data.rate) {
        return getAuthToken(config, data, 0, callback);
    }

    // Sleep until the queue updates
    return setTimeout(function () {
        var options = {
            host: config.host,
            port: 443,
            path: '/login-queue/rest/queue/ticker/' + data.champ,
            method: 'GET',
            rejectUnauthorized: false
        };

        https
            .request(options, function (result) {
                result.on('data', function checkLoginData(d) {
                    try {
                        logger.info('Received: ' + d);

                        var obj = JSON.parse(d.toString());
                        var next = parseInt(obj[data.node], 16); // convert from hex to int

                        logger.info("In login queue (#" + Math.max(1, id - current) + " in line)");
                        tickQueue(config, data, id, next, callback);
                    }
                    catch (err) {
                        logger.warn('Could not parse response', err);
                        tickQueue(config, data, id, current, callback);
                    }
                });
            })
            .on('error', function checkLoginError(err) {
                logger.error('Could not get ticker data from queue', err);
                return callback(err);
            });
    }, data.delay);
}

function getAuthToken(config, data, retryCount, callback) {
    if (data && data.token) {
        return callback(null, data.token);
    }

    if (retryCount > 5) {
        // todo: attempt to cancel the queue
        return callback('Retry limit exceeded.  Try again later.');
    }

    // repeatedly try to get the token
    return setTimeout(function () {
        var options = {
            host: config.host,
            port: 443,
            path: '/login-queue/rest/queue/authToken/' + config.username.toLowerCase(),
            method: 'GET',
            rejectUnauthorized: false
        };

        logger.info('Retrieving auth token for user: ' + config.username + ', Attempt: ' + retryCount);
        https
            .get(options, function (res) {
                res.on('data', function (d) {
                    logger.info('Received: ' + d);
                    try {
                        var auth = JSON.parse(d.toString('utf-8'));
                        getAuthToken(config, auth, retryCount, callback);
                    }
                    catch (err) {
                        logger.warn('Could not parse response, retrying.');
                        getAuthToken(config, data, retryCount + 1, callback);
                    }
                });
            })
            .on('error', function (err) {
                logger.error('Could not get auth token', err);
                return callback(err);
            });

    }, data.delay / 10);
}