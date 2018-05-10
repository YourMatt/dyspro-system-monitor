
// load configuration values
require ("dotenv").config();

// include libraries from node modules
const bodyParser = require ("body-parser"),
    busboy = require ("connect-busboy"),
    compression = require ("compression"),
    ejs = require ("ejs"),
    express = require ("express"),
    mime = require ("mime"),
    moment = require ("moment"),
    session = require ("express-session");

// include local libraries
const api = require ("./apiprocessor"),
    middleware = require("./middleware"),
    sessionManager = require ("./sessionmanager"),
    queries = require("./queries/all");

// initialize express
let app = express ();
app.set ("port", (process.env.RUNTIME_PORT || 80));
app.set ("views", __dirname + "/views/layout");
app.engine ("ejs", ejs.renderFile);
app.use (bodyParser.urlencoded ({extended: false}));
app.use (compression({level: 1, threshold: 0})); // use fastest compression
app.use (express.static (__dirname + "/public"));
app.use (busboy ()); // allow file uploads
app.use (session ({secret: "dyspro-sess", resave: true, saveUninitialized: true}));
middleware.addAll(app);

// home page
app.get ("/", function (req, res) {
    res.render ("home.ejs",
        {
            page: "home",
            jsFiles: [],
            errorMessage: sessionManager.getOnce ("errorMessage"),
            successMessage: sessionManager.getOnce ("successMessage"),
            userId: sessionManager.data.user.userId
        }
    );
});

// dashboard page
app.get ("/dashboard", function (req, res) {
    if (! sessionManager.loggedIn ()) {
        res.redirect ("/");
        return;
    }
    queries.accounts.getEnvironments (sessionManager.data.user.accountId, function (environments) {
        res.render ("dashboard.ejs",
            {
                page: "dashboard",
                jsFiles: ["errors.js", "dashboard.js"],
                errorMessage: sessionManager.getOnce ("errorMessage"),
                successMessage: sessionManager.getOnce ("successMessage"),
                userId: sessionManager.data.user.userId,
                environments: environments,
                selectedEnvironment: environments[0] // TODO: Pull value from settings if exists
            }
        );
    });
});

// error occurrence detail page
app.get ("/errors/:errorId/occurrence/:errorOccurrenceId", function (req, res) {
    if (!sessionManager.loggedIn()) {
        res.redirect("/");
        return;
    }

    // load the error occurrence data
    queries.errorOccurrences.get(req.params.errorOccurrenceId, function (errorOccurrence) {
        if (!errorOccurrence) {
            sessionManager.set("errorMessage", "Error occurrence not found.");
            res.redirect(req.headers.referer);
            return;
        }

        // load the attachments for the error occurrence
        queries.errorAttachments.getAllByErrorOccurrence(
            errorOccurrence.errorOccurrenceId,
            function (attachments) {
                errorOccurrence.attachments = attachments;

                try {
                    var stackTraceJson = JSON.parse(errorOccurrence.stackTrace);
                    errorOccurrence.stackTrace = JSON.stringify(stackTraceJson, null, 2);
                }
                catch (e) {
                }

                // load the error details
                queries.errors.get(errorOccurrence.errorId, function (errorData) {

                    res.render("error-occurrence-detail.ejs",
                        {
                            page: "erroroccurrencedetail",
                            jsFiles: ["errors.js", "error-detail.js"],
                            errorMessage: sessionManager.getOnce("errorMessage"),
                            successMessage: sessionManager.getOnce("successMessage"),
                            userId: sessionManager.data.user.userId,
                            errorOccurrence: errorOccurrence,
                            error: errorData,
                            moment: moment
                        }
                    );

                });
            }
        );
    });
});

// error detail page
app.get ("/errors/:errorId", function (req, res) {
    if (!sessionManager.loggedIn()) {
        res.redirect("/");
        return;
    }

    // load the error data
    queries.get(req.params.errorId, function (error) {
        if (!error) {
            sessionManager.set("errorMessage", "Error not found.");
            res.redirect(req.headers.referer);
            return;
        }

        res.render("error-detail.ejs",
            {
                page: "errordetail",
                jsFiles: ["errors.js", "error-detail.js"],
                errorMessage: sessionManager.getOnce("errorMessage"),
                successMessage: sessionManager.getOnce("successMessage"),
                userId: sessionManager.data.user.userId,
                error: error
            }
        );
    });

});

// settings page
app.get ("/settings", function (req, res) {
    if (! sessionManager.loggedIn ()) {
        res.redirect ("/");
        return;
    }
    res.render ("settings.ejs",
        {
            page: "settings",
            jsFiles: [],
            errorMessage: sessionManager.getOnce ("errorMessage"),
            successMessage: sessionManager.getOnce ("successMessage"),
            userId: sessionManager.data.user.userId
        }
    );
});

// process login
app.post ("/login", function (req, res) {
    queries.users.getByLogin(req.body.email, req.body.password, function (userData) {

        // user not authenticated
        if (!userData) {
            sessionManager.set("errorMessage", "Incorrect email or password.");
            res.redirect(req.headers.referer);
            return;
        }

        // save user to session and forward to the dashboard
        sessionManager.set("user", userData);
        res.redirect("/dashboard");

    });
});

// process logout
app.get ("/logout", function (req, res) {
    sessionManager.set ("user", {});
    sessionManager.set ("successMessage", "You have successfully logged out.");
    res.redirect ("/");
});

// process attachment downloads
app.get ("/attachments/:errorOccurrenceId/:fileName", function (req, res) {
    queries.errorAttachments.get(
        req.params.errorOccurrenceId,
        req.params.fileName,
        function (file) {

            if (!file) { // TODO: Call standard 404 handler
                res.writeHead(404, {"Content-Type": "text/html"});
                res.end("not found");
                return;
            }

            /* // TODO: Add option to prompt download
            res.writeHead (200, {"Content-Disposition": "attachment filename=" + file.file_name + ";"});
            res.end (file.source);
            */

            // display the file
            res.writeHead(200, {"Content-Type": mime.getType(file.fileType), "Content-Length": file.source.length});
            res.end(file.source);

        }
    );
});

// expose api methods

app.get     ("/api/error/:errorId", api.error.getSingle);
app.get     ("/api/errors/:environment/:count?", api.error.getLatestForEnvironment);
app.post    ("/api/error", api.error.create);

app.get     ("/api/errornote/:errorNoteId", api.errorNotes.getSingle);
app.get     ("/api/errornotes/:errorId", api.errorNotes.getAllForError);
app.post    ("/api/errornote", api.errorNotes.create);
app.put     ("/api/errornote/:errorNoteId", api.errorNotes.update);
app.delete  ("/api/errornote/:errorNoteId", api.errorNotes.delete);

app.get     ("/api/monitor/:monitorId", api.monitor.getSingle);
app.get     ("/api/monitors", api.monitor.getAllInAccount);
app.post    ("/api/monitor", api.monitor.create);
app.put     ("/api/monitor/:monitorId", api.monitor.update);
app.delete  ("/api/monitor/:monitorId", api.monitor.delete);

app.get     ("/api/user/:userId", api.user.getSingle);
app.get     ("/api/users", api.user.getAllInAccount);
app.post    ("/api/user", api.user.create);
app.put     ("/api/user/:userId", api.user.update);
app.delete  ("/api/user/:userId", api.user.delete);

// start server
app.listen (app.get ("port"));
console.log ("Server started.");
