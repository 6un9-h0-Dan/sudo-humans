var hyperstream = require('hyperstream');
var hyperquest = require('hyperquest');
var duplexer = require('duplexer2');
var through = require('through2');
var layout = require('../lib/layout.js');
var post = require('../lib/post.js');
var xtend = require('xtend');
var once = require('once');
var async = require('async');
var payment = require('../lib/payment.js');
var membership = require('../lib/membership.js');
var userFromX = require('../lib/user_from_x.js');
var Stripe = require('stripe');
var streamEach = require('../lib/stream_each.js');

function monthsAgo(months) {
    var d = new Date;
    d.setMonth(d.getMonth() - months);
    return Math.floor(d.valueOf() / 1000);
}

function getStripeCharges(collective, opts, settings, cb) {
    if(typeof opts == 'function') {
        cb = opts;
        opts = {};
    }
    opts = opts || {};

    var stripe = Stripe(settings.collectives[collective].stripe_api_key);

    var qOpts = {
        created: {
            gte: monthsAgo(1)
        },
        limit: 100, // TODO this is the highest stripe supports :(
        expand: ['data.balance_transaction']
    };
    if(opts.prev) {
        qOpts.starting_after = opts.prev;
    }
    stripe.charges.list(qOpts, function(err, obj) {
        if(err) return cb(err);
        var charges = obj.data;
        if(opts.charges) {
            charges = opts.charges.concat(charges);
        }
        // stripe only lets us fetch up to 100 charges at a time
        // so keep getting more until we're done
        if(obj.has_more) {
            return getStripeCharges(collective, {
                prev: obj.data[obj.data.length - 1].id,
                charges: charges
            }, settings, cb);
        }
        cb(null, charges);
    })
}

module.exports = function (index, users, auth, blob, settings) {
    return function (req, res, m) {
        if (!m.session) return m.error(401, 'You must be signed in to use this page.');

        users.get(m.session.data.id, function (err, adminUser) {
            if(err) return m.error(500, err);
            if(!adminUser) return m.error(401, "You are not logged in");

            userFromX(index, 'name', m.params.username, function (err, user) {
                if(err) return m.error(500, err);
                if(!user) return m.error(404, "No such user");

                // find collectives that user is part of
                // and adminUser is admin of

                var collectives = {};
                var col;
                for(col in user.collectives) {
                    if(membership.hasPriv(adminUser, col, 'admin')) {
                        collectives[col] = user.collectives[col];
                    }
                }
                if(Object.keys(collectives).length < 1) {
                    return m.error(401, "You are not an admin of any of the collectives that this user has joined.");
                }

                if (req.method === 'POST') {
                    return post(save)(req, res, m);
                }
                
                layout(auth, settings)('user_admin.html', show)(req, res, m, users, adminUser, user, collectives);

            });
        });
    };

    function show (req, res, m, users, adminUser, user, collectives) {
        var input = through(), output = through();

        input.pipe(page(users, adminUser, user, collectives)).pipe(output)
        return duplexer(input, output);
    }


    function page(users, adminUser, user, collectives) {

        if(!user.stripe) {
            user.stripe = {};
        }

        var chtml = '\n<table><tr><th>Collective</th><th>Privileges</th>';
        var col, priv, privName;
        for(col in collectives) {
            chtml += '<tr><td>'+settings.collectives[col].name+'</td><td><ul>'
            for(priv in settings.collectives[col].privs) {
                privName = settings.collectives[col].privs[priv];
                chtml += '<li>'+privName;
                chtml += '<input type="checkbox" name="priv['+col+']['+privName+']" ';
                if(user.collectives[col].privs.indexOf(privName) >= 0) {
                    chtml += 'checked';
                }
                chtml += '/>';
                chtml += '</li>';
            }
            chtml += '</ul></td></tr>\n';
        }
        chtml += "</table>";

        var props = {
            '[key=privs]': { _appendHtml: chtml },
            '[key=user-name]': { _text: user.name }
        };

        return hyperstream(props);

    }
        

};
