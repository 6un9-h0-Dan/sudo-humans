var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var alloc = require('tcp-bind');

var minimist = require('minimist');
var argv = minimist(process.argv.slice(2), {
    alias: { d: 'datadir', p: 'port', u: 'uid', g: 'gid' },
    default: {
        datadir: path.join(__dirname, 'sudoroom-data'),
        port: require('is-root')() ? 80 : 8000
    }
});

var fd = alloc(argv.port);
if (argv.gid) process.setgid(argv.gid);
if (argv.uid) process.setgid(argv.uid);

var hyperstream = require('hyperstream');
var ecstatic = require('ecstatic')({
    root: __dirname + '/static',
    gzip: true
});
var body = require('body/any');
var xtend = require('xtend');
var through = require('through2');

var level = require('level');
var sublevel = require('subleveldown');

var db = level(argv.datadir, { valueEncoding: 'json' });

var accountdown = require('accountdown');
var users = accountdown(sublevel(db, 'users'), {
    login: { basic: require('accountdown-basic') }
});

var router = require('routes')();
router.addRoute('/', layout('main.html'));
router.addRoute('/account/create/post', post(function (req, res, params) {
    var id = crypto.randomBytes(16).toString('hex');
    var opts = {
        login: { basic: { username: params.name, password: params.password } },
        value: { member: false, visibility: params.visibility }
    };
    users.create(id, opts, function (err) {
        if (err) return error(res, 400, err);
        res.writeHead(303, { location: '/account/welcome' });
        res.end();
    });
}));
router.addRoute('/account/create', layout('create_account.html'));
router.addRoute('/account/sign-in', layout('sign_in.html'));
router.addRoute('/account/welcome', layout('welcome.html'));

var server = http.createServer(function (req, res) {
    var m = router.match(req.url);
    if (m) m.fn(req, res, m.params);
    else ecstatic(req, res);
});
server.listen({ fd: fd }, function () {
    console.log('listening on :' + server.address().port);
});

function read (file) {
    return fs.createReadStream(path.join(__dirname, 'static', file));
}

function layout (page, fn) {
    if (!fn) fn = function () { return through() };
    return function (req, res) {
        res.setHeader('content-type', 'text/html');
        var hs = hyperstream({ '#content': read(page).pipe(fn(req)) });
        read('layout.html').pipe(hs).pipe(res);
    };
}

function post (fn) {
    return function (req, res, params) {
        if (req.method !== 'POST') {
            res.statusCode = 400;
            res.end('not a POST\n');
        }
        else body(req, res, function (err, pvars) {
            fn(req, res, xtend(pvars, params));
        });
    };
}

function error (res, code, err) {
    res.statusCode = code;
    layout('error.html', function () {
        return hyperstream({ '.error': { _text: err + '\n' } });
    })(null, res);
}
