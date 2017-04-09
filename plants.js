var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var async = require('async');
var jadeStatic = require('connect-jade-static');
// create application/json parser
var jsonParser = bodyParser.json()

var port = process.env.PORT || 9811

var sqlite3 = require('sqlite3');
var db = new sqlite3.Database('plants.sqlite');

db.serialize(function() {
  db.run("CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
  db.run('CREATE TABLE IF NOT EXISTS plants (id INTEGER PRIMARY KEY AUTOINCREMENT, place INTEGER REFERENCES places (id) NOT NULL, name TEXT, interval INTEGER DEFAULT NULL, hidden BOOLEAN NOT NULL DEFAULT 0)');
  db.run('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, plant INTEGER REFERENCES plants (id) NOT NULL, d DATE NOT NULL)');
});

var router = express.Router()

var baseUrl = 'api';

router.get('/', function(req, res) {
  res.json({message: 'api ready to pleasure you!'});
});

function getPlaces(callback) {
  var sql = 'SELECT id FROM places';
  db.all(sql, function(err, rows) {
    rows = rows.map(function(x) { return x.id; });
    async.map(rows, getPlace, function(err, results) {
      callback(err, results);
    });
  });
}

router.route('/places')
  .get(function(req, res) {
    getPlaces(function(err, result) {
      res.json({ places: result });
    });
  });

function getPlace(placeId, callback) {
  async.series({
    id: function(callback) {
      callback(null, placeId);
    },
    url: function(callback) {
      callback(null, baseUrl + '/places/' + placeId);
    },
    name: function(callback) {
      var sql = 'SELECT name FROM places WHERE id=?';
      db.get(sql, [placeId], function(err, row) {
        if (row) {
          callback(err, row.name);
        } else {
          callback(err, row);
        }
      });
    },
    plants: function(callback) {
      getPlants(placeId, callback);
    }
  }, function(err, results) {
    callback(err, results);
  });
}

router.route('/places/:place_id')
  .get(function(req, res) {
    getPlace(req.params.place_id, function(err, result) {
      res.json({place: result});
    });
  });

function getPlants(placeId, plantsCallback) {
  var sql = 'SELECT id FROM plants WHERE place=?';
  db.all(sql, [placeId], function(err, rows) {
    rows = rows.map(function(x) { return x.id; });
    async.map(rows, getPlant, function(err, results) {
      plantsCallback(err, results);
    });
  });
}

router.route('/places/:place_id/plants')
  .get(function(req, res) {
    getPlants(req.params.place_id, function(err, rows) {
      res.json({ plants: rows});
    });
  })
  .post(jsonParser, function (req, res) {
    var sql = 'INSERT INTO plants (name, place, hidden) VALUES (?, ?, 0)';
    db.run(sql, [req.body.name, req.params.place_id], function (err) {
      if (err) {
        res.status(400).end();
      } else {
        getPlant(this.lastID, function (err, plant) {
          res.json({ plant: plant });
        });
      }
    });
  });

function getPlant(plantId, callback) {
  async.series({
    id: function(callback) {
      callback(null, plantId);
    },
    url: function(callback) {
      callback(null, baseUrl + '/plants/' + plantId);
    },
    name: function(callback) {
      var sql = 'SELECT name FROM plants WHERE id=?';
      db.get(sql, [plantId], function (err, row) {
        if (row) {
          callback(err, row.name);
        } else {
          callback(err, row);
        }
      });
    },
    hidden: function(callback) { /* Yeah, inefficient. Merge with above? */
      var sql = 'SELECT hidden FROM plants WHERE id=?';
      db.get(sql, [plantId], function (err, row) {
        if (row) {
          callback(err, row.hidden == 1);
        } else {
          callback(err, row);
        }
      });
    },
    dates: function(callback) {
      getDates(plantId, callback);
    }
  }, function(err, results) {
    callback(err, results);
  });
}

router.route('/plants/:plant_id')
  .get(function(req, res) {
    getPlant(req.params.plant_id, function(err, plant) {
      res.json({ plant: plant });
    });
  })
  .put(jsonParser, function (req, res) {
    var sql = 'UPDATE plants SET name=?,hidden=? WHERE id=?';
    db.run(sql, [req.body.name, !!req.body.hidden, req.params.plant_id], function (err) {
      if (err) {
        res.status(400).end();
      } else {
        res.status(204).end();
      }
    });
  })
  .delete(function (req, res) {
    // delete plant including its events.
    var plantId = req.params.plant_id;
    var sql1 = 'DELETE FROM events WHERE plant=?';
    var sql2 = 'DELETE FROM plants WHERE id=?';
    db.run(sql1, [plantId], function (err) {
      if (err) {
        res.status(400).end();
      } else {
        db.run(sql2, [plantId], function (err) {
          if (err) {
            res.status(400).end();
          } else {
            res.status(204).end();
          }
        });
      }
    });
  });

function getDates(plantId, callback) {
  var sql = 'SELECT d FROM events WHERE plant=? ORDER BY d';
  db.all(sql, [plantId], function(err, rows) {
    if (err) {
      callback(err, null);
    } else {
      var dates = rows.map(function(x) { return x.d; });
      callback(null, dates);
    }
  });
}

router.route('/plants/:plant_id/dates')
  .get(function(req, res) {
    getDates(req.params.plant_id, function(err, dates) {
      res.json({ dates: dates });
    });
  })
  .post(jsonParser, function(req, res) {
    var sql = 'INSERT INTO events (plant, d) VALUES (?,?)';
    db.run(sql, [req.params.plant_id, req.body.date], function (err) {
      if (err) {
        res.status(400).end();
      } else {
        res.status(204).end();
      }
    });
  });

router.route('/plants/:plant_id/dates/:date')
  .delete(function (req, res) {
    var sql = 'DELETE FROM events WHERE plant=? AND id IN (' +
      'SELECT id FROM events e WHERE plant=? AND e.d=? LIMIT 1)';
    db.run(sql, [req.params.plant_id, req.params.plant_id, req.params.date], function (err) {
      if (err) {
        res.status(400).end();
      } else {
        res.status(204).end();
      }
    });
  });

app.use('/' + baseUrl, router);
// Serve static files.
app.use(express.static(__dirname + '/public'));

app.use(jadeStatic({
  baseDir: __dirname + '/public',
  baseUrl: '/',
  maxAge: 86400
}));

app.listen(port);
console.log('Plants server listening on port ' + port);

