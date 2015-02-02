#!/usr/bin/env node

var http = require('http');
var fs = require('fs');
var path = require('path');
var alloc = require('tcp-bind');

var minimist = require('minimist');
var argv = minimist(process.argv.slice(2), {
    alias: {
        d: 'datadir', p: 'port', u: 'uid', g: 'gid',
        h: 'help'
    },
    default: {
        datadir: 'sudoroom-data',
        port: require('is-root')() ? 80 : 8000
    }
});
if (argv.help || argv._[0] === 'help') {
    fs.createReadStream(__dirname + '/usage.txt').pipe(process.stdout);
    return;
}

var fd = alloc(argv.port);
if (argv.gid) process.setgid(argv.gid);
if (argv.uid) process.setgid(argv.uid);

var hyperstream = require('hyperstream');
var ecstatic = require('ecstatic')({
    root: __dirname + '/../static',
    gzip: true
});
var mkdirp = require('mkdirp');

var level = require('level');
var sublevel = require('subleveldown');

var dir = {
    data: path.join(argv.datadir, 'data'),
    index: path.join(argv.datadir, 'index'),
    session: path.join(argv.datadir, 'session')
};
mkdirp.sync(dir.data);

var ixfeed = require('index-feed');
var ixf = ixfeed({
    data: level(dir.data),
    index: level(dir.index),
    valueEncoding: 'json'
});

ixf.index.add(function (row, cb) {
    if (row.value && row.value.type === 'user') {
        cb(null, {
            'user.id': row.value.id,
            'user.name': row.value.name,
            'user.member': row.value.member,
            'user.visibility': row.value.visibility
        });
    }
    else cb()
});

var accountdown = require('accountdown');
var users = accountdown(sublevel(ixf.db, 'users'), {
    login: { basic: require('accountdown-basic') }
});

var auth = require('cookie-auth')({
    name: require('../package.json').name,
    sessions: level(dir.session)
});

var layout = require('../lib/layout.js')(auth);

var router = require('routes')();
router.addRoute('/', layout('main.html', require('../routes/main.js')(users)));
router.addRoute('/account/create', layout('create_account.html'));
router.addRoute('/account/create/post',
    require('../routes/create_account.js')(users, auth)
);
router.addRoute('/account/sign-in', layout('sign_in.html'));
router.addRoute('/account/sign-in/post', 
    require('../routes/sign_in.js')(users, auth)
);
router.addRoute('/account/sign-out/:token', 
    require('../routes/sign_out.js')(auth)
);
router.addRoute('/account/welcome', layout('welcome.html'));
router.addRoute('/~:name', require('../routes/profile.js')(auth, ixf));

var server = http.createServer(function (req, res) {
    var m = router.match(req.url);
    if (m) m.fn(req, res, { params: m.params, error: error });
    else ecstatic(req, res);
    
    function error (code, err) {
        res.statusCode = code;
        layout('error.html', function () {
            return hyperstream({ '.error': { _text: err + '\n' } });
        })(req, res);
    }
});
server.listen({ fd: fd }, function () {
    console.log('listening on :' + server.address().port);
});
