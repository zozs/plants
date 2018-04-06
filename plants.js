const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const jadeStatic = require('connect-jade-static')
const path = require('path')
const util = require('util')

// create application/json parser
const jsonParser = bodyParser.json()

const port = process.env.PORT || 9811

const sqlite3 = require('sqlite3')
const db = new sqlite3.Database('plants.sqlite')
db.allP = util.promisify(db.all)
db.getP = util.promisify(db.get)
db.runP = util.promisify(db.run)

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)')
  db.run('CREATE TABLE IF NOT EXISTS plants (id INTEGER PRIMARY KEY AUTOINCREMENT, place INTEGER REFERENCES places (id) NOT NULL, name TEXT, interval INTEGER DEFAULT NULL, hidden BOOLEAN NOT NULL DEFAULT 0)')
  db.run('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, plant INTEGER REFERENCES plants (id) NOT NULL, d DATE NOT NULL)')
})

const router = express.Router()

const baseUrl = 'api'

router.get('/', (req, res) => res.json({message: 'api ready to pleasure you!'}))

async function getPlaces () {
  let placeIds = await db.allP('SELECT id FROM places')
  return Promise.all(placeIds.map(r => getPlace(r.id)))
}

router.route('/places')
  .get(async (req, res) => {
    res.json({ places: await getPlaces() })
  })

async function getPlace (placeId) {
  let row = await db.getP('SELECT name FROM places WHERE id=?', [placeId])
  if (row) {
    let place = {
      id: placeId,
      url: baseUrl + '/places/' + placeId,
      name: row.name,
      plants: await getPlants(placeId)
    }
    return place
  } else {
    throw new Error('No such plant!')
  }
}

router.route('/places/:place_id')
  .get(async (req, res) => {
    res.json({ place: await getPlace(req.params.place_id) })
  })

async function getPlants (placeId) {
  let plantIds = await db.allP('SELECT id FROM plants WHERE place=?', [placeId])
  return Promise.all(plantIds.map(r => getPlant(r.id)))
}

router.route('/places/:place_id/plants')
  .get(async (req, res) => {
    res.json({ plants: await getPlants(req.params.place_id) })
  })
  .post(jsonParser, (req, res) => { // TODO: promisify, but tricky since we need this.lastID
    const sql = 'INSERT INTO plants (name, place, hidden) VALUES (?, ?, 0)'
    db.run(sql, [req.body.name, req.params.place_id], async function (err) {
      if (err) {
        res.status(400).end()
      } else {
        res.json({ plant: await getPlant(this.lastID) })
      }
    })
  })

async function getPlant (plantId) {
  const { hidden, name } = await db.getP('SELECT name, hidden FROM plants WHERE id=?', [plantId])
  return {
    id: plantId,
    url: baseUrl + '/plants/' + plantId,
    name: name,
    hidden: !!hidden,
    dates: await getDates(plantId)
  }
}

router.route('/plants/:plant_id')
  .get(async (req, res) => {
    res.json({ plant: await getPlant(req.params.plant_id) })
  })
  .put(jsonParser, async (req, res) => {
    try {
      const sql = 'UPDATE plants SET name=?,hidden=? WHERE id=?'
      await db.runP(sql, [req.body.name, !!req.body.hidden, req.params.plant_id])
      res.sendStatus(204)
    } catch (e) {
      res.sendStatus(400)
    }
  })
  .delete(async (req, res) => {
    // delete plant including its events.
    const plantId = req.params.plant_id
    try {
      await db.runP('DELETE FROM events WHERE plant=?', [plantId])
      await db.runP('DELETE FROM plants WHERE id=?', [plantId])
      res.sendStatus(204)
    } catch (e) {
      res.sendStatus(400)
    }
  })

async function getDates (plantId) {
  let rows = await db.allP('SELECT d FROM events WHERE plant=? ORDER BY d', [plantId])
  return rows.map(r => r.d)
}

router.route('/plants/:plant_id/dates')
  .get(async (req, res) => {
    let dates = await getDates(req.params.plant_id)
    res.json({ dates: dates })
  })
  .post(jsonParser, async (req, res) => {
    const sql = 'INSERT INTO events (plant, d) VALUES (?,?)'
    try {
      await db.runP(sql, [req.params.plant_id, req.body.date])
      res.sendStatus(204)
    } catch (e) {
      res.sendStatus(400)
    }
  })

router.route('/plants/:plant_id/dates/:date')
  .delete(async (req, res) => {
    const sql = `DELETE FROM events WHERE plant=? AND id IN (
      SELECT id FROM events e WHERE plant=? AND e.d=? LIMIT 1)`
    try {
      await db.runP(sql, [req.params.plant_id, req.params.plant_id, req.params.date])
      res.sendStatus(204)
    } catch (e) {
      res.sendStatus(400)
    }
  })

app.use('/' + baseUrl, router)
// Serve static files.
app.use(express.static(path.join(__dirname, '/public')))

app.use(jadeStatic({
  baseDir: path.join(__dirname, '/public'),
  baseUrl: '/',
  maxAge: 86400
}))

app.listen(port)
console.log('Plants server listening on port ' + port)
