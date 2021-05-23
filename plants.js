require('dotenv').config()

const express = require('express')
const path = require('path')
const pRouter = require('express-promise-router')

const { Pool, types } = require('pg')

const app = express()
const jsonParser = express.json()
const pool = new Pool()
const port = process.env.PORT || 9811

// Disable node-postgres automatic convertion of DATE column to Javascript Date-object
const TYPE_DATE = 1082
types.setTypeParser(TYPE_DATE, date => date)

;(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS places (id SERIAL, name TEXT NOT NULL, PRIMARY KEY (id))')
  await pool.query('CREATE TABLE IF NOT EXISTS plants (id SERIAL, place INTEGER REFERENCES places (id) NOT NULL, name TEXT, interval INTEGER DEFAULT NULL, hidden BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (id))')
  await pool.query('CREATE TABLE IF NOT EXISTS events (id SERIAL, plant INTEGER REFERENCES plants (id) NOT NULL, d DATE NOT NULL, PRIMARY KEY (id))')
})()

const baseUrl = 'api'
const router = pRouter()

router.get('/', (req, res) => res.json({ message: 'api ready to pleasure you!' }))

function NotFoundError (message) {
  this.message = message
  this.stack = Error().stack
}
NotFoundError.prototype = Object.create(Error.prototype)
NotFoundError.prototype.name = 'NotFoundError'

async function getPlaces () {
  const { rows } = await pool.query('SELECT id FROM places')
  return Promise.all(rows.map(r => getPlace(r.id)))
}

router.get('/places', async (req, res) => {
  res.json({ places: await getPlaces() })
})

async function getPlace (placeId) {
  const { rows } = await pool.query('SELECT name FROM places WHERE id=$1', [placeId])
  if (rows.length === 1) {
    return {
      id: placeId,
      url: `${baseUrl}/places/${placeId}`,
      name: rows[0].name,
      plants: await getPlants(placeId)
    }
  } else {
    throw new NotFoundError(404, 'No such place!')
  }
}

router.get('/places/:place_id', async (req, res) => {
  res.json({ place: await getPlace(req.params.place_id) })
})

async function getPlants (placeId) {
  const { rows } = await pool.query('SELECT id FROM plants WHERE place=$1', [placeId])
  return Promise.all(rows.map(r => getPlant(r.id)))
}

router.route('/places/:place_id/plants')
  .get(async (req, res) => {
    res.json({ plants: await getPlants(req.params.place_id) })
  })
  .post(jsonParser, async (req, res) => {
    try {
      const sql = 'INSERT INTO plants (name, place, hidden) VALUES ($1, $2, FALSE) RETURNING id'
      const { rows: [{ id }] } = await pool.query(sql, [req.body.name, req.params.place_id])
      res.json({ plant: await getPlant(id) })
    } catch (e) {
      console.error('Failed to insert plant. Got error:', e)
      res.sendStatus(400)
    }
  })

async function getPlant (plantId) {
  try {
    const { rows: [{ hidden, name }] } = await pool.query('SELECT name, hidden FROM plants WHERE id=$1', [plantId])
    return {
      id: plantId,
      url: `${baseUrl}/plants/${plantId}`,
      name,
      hidden: !!hidden,
      dates: await getDates(plantId)
    }
  } catch (e) {
    throw new NotFoundError('No such plant!')
  }
}

router.route('/plants/:plant_id')
  .get(async (req, res) => {
    res.json({ plant: await getPlant(req.params.plant_id) })
  })
  .put(jsonParser, async (req, res) => {
    try {
      const sql = 'UPDATE plants SET name=$1,hidden=$2 WHERE id=$3'
      await pool.query(sql, [req.body.name, !!req.body.hidden, req.params.plant_id])
      res.sendStatus(204)
    } catch (e) {
      res.sendStatus(400)
    }
  })
  .delete(async (req, res) => {
    // delete plant including its events.
    const plantId = req.params.plant_id
    await pool.query('DELETE FROM events WHERE plant=$1', [plantId])
    await pool.query('DELETE FROM plants WHERE id=$1', [plantId])
    res.sendStatus(204)
  })

async function getDates (plantId) {
  const { rows } = await pool.query('SELECT d FROM events WHERE plant=$1 ORDER BY d', [plantId])
  return rows.map(r => r.d)
}

router.route('/plants/:plant_id/dates')
  .get(async (req, res) => {
    const dates = await getDates(req.params.plant_id)
    res.json({ dates })
  })
  .post(jsonParser, async (req, res) => {
    const sql = 'INSERT INTO events (plant, d) VALUES ($1, $2)'
    await pool.query(sql, [req.params.plant_id, req.body.date])
    res.sendStatus(204)
  })

router.route('/plants/:plant_id/dates/:date')
  .delete(async (req, res) => {
    const sql = `DELETE FROM events WHERE plant=$1 AND id IN (
      SELECT id FROM events e WHERE plant=$2 AND e.d=$3 LIMIT 1)`
    await pool.query(sql, [req.params.plant_id, req.params.plant_id, req.params.date])
    res.sendStatus(204)
  })

app.use('/' + baseUrl, router)
app.set('view engine', 'pug')

// The only pug-file is the index html.
app.get('/', (req, res) => res.render(path.join(__dirname, 'public', 'index')))

// Serve static files.
app.use(express.static(path.join(__dirname, '/public')))

// Error handlers.
function notFoundErrorHandler (err, req, res, next) {
  if (err instanceof NotFoundError) {
    res.sendStatus(404)
  } else {
    next(err)
  }
}

function errorHandler (err, req, res, next) {
  res.sendStatus(500)
  console.error('Returned HTTP 500 because of error: ', err)
}

app.use(notFoundErrorHandler)
app.use(errorHandler)

app.listen(port)
console.log('Plants server listening on port ' + port)
