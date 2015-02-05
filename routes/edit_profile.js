var hyperstream = require('hyperstream');
var duplexer = require('duplexer2');
var through = require('through2');
var layout = require('../lib/layout.js');
var post = require('../lib/post.js');
var xtend = require('xtend');

module.exports = function (users, auth, blob) {
    return function (req, res, m) {
        if (!m.session) {
            m.error(401, 'You must be signed in to use this page.');
        }
        else if (req.method === 'POST') {
            post(save)(req, res, m);
        }
        else layout(auth)('edit_profile.html', show)(req, res, m)
    };
    
    function show (req, res, m) {
        var input = through(), output = through();
        users.get(m.session.data.id, function (err, user) {
            if (err) return m.error(err);
            input.pipe(showUser(user, m.error)).pipe(output);
        });
        return duplexer(input, output);
    }
    
    function showUser (user, error) {
        var props = {
            '#edit-profile': { action: '/~' + user.name + '/edit' },
            '[name=nym]': { value: user.name },
            '[name=email]': { value: user.email },
            '[name=full-name]': { value: user.fullName },
            '[name=avatar]': { value: user.avatar },
            '[name=about]': { _text: readblob(user.about) },
            '[name=ssh]': { _text: readblob(user.ssh) },
            '[name=gpg]': { _text: readblob(user.gpg) }
        };
        var opkey = '[name=visibility] option[value="' + user.visibility + '"]';
        props[opkey] = { selected: true };
        return hyperstream(props);
        
        function readblob (hash) {
            if (!hash) return '';
            var r = blob.createReadStream(hash);
            r.on('error', error);
            return r;
        }
    }
    
    function save (req, res, m) {
        var pending = 4;
        var doc = {
            name: m.params.nym,
            email: m.params.email,
            fullName: m.params['full-name'],
            visibility: m.params.visibility
        };
        //m.params['avatar-url']
        //m.params['avatar-file']
        //m.params.link
        
        users.get(m.session.data.id, function (err, user) {
            if (err) return m.error(500, err);
            if (!user) return m.error(404, 'no user data');
            
            doc = xtend(user, doc);
            if (user.name !== doc.name && !m.params.password) {
                m.error(401, 'password required when updating a sudonym');
            }
            else if (user.name !== doc.name) {
                updateLogin(function (err) {
                    if (err) return m.error(500, err)
                    m.session.update({ name: doc.name }, function (err) {
                        if (err) m.error(500, err)
                        else done()
                    });
                });
            }
            else if (m.params.password) {
                updateLogin(function (err) {
                    if (err) m.error(500, err);
                    else done();
                });
            }
            else done();
        });
        wsave('about');
        wsave('ssh');
        wsave('gpg');
        
        function updateLogin (cb) {
            var id = m.session.data.id;
            users.removeLogin(id, 'basic', function (err) {
                if (err) return cb(err);
                users.addLogin(id, 'basic', {
                    username: m.params.nym,
                    password: m.params.password
                }, cb);
            });
        }
        
        function wsave (key) {
            blob.createWriteStream().end(m.params[key], function () {
                doc[key] = this.key;
                done();
            });
        }
        function done () {
            if (-- pending !== 0) return;
            users.put(m.session.data.id, doc, function (err) {
                if (err) return m.error(500, err);
                res.statusCode = 302;
                res.setHeader('location', '/~' + doc.name);
                res.end('redirect');
            });
        }
    }
};
