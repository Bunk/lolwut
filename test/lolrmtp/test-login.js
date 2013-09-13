var login = require('../../lib/lolrmtp/login');

exports['login'] = function (test) {
    var config = {
        host: 'lq.na1.lol.riotgames.com',
        username: '-----',
        password: '-----'
    };

    login.getAuthKey(config, function (err, data) {
        if (err)
            console.log(err);

        if (data)
            console.log(data);
    });
};