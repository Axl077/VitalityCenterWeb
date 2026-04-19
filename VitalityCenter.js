const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// conexión postgres (Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// servir frontend
app.use(express.static(path.join(__dirname, 'public')));

// =====================
// 🔹 CLIENTES
// =====================

// registrar cliente
app.post('/api/clientes', async (req, res) => {
  const { nombre, telefono, email } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO clientes(nombre, telefono, email) VALUES($1,$2,$3) RETURNING *',
      [nombre, telefono, email]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creando cliente");
  }
});

// buscar cliente
app.get('/api/clientes/:telefono', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM clientes WHERE telefono = $1',
      [req.params.telefono]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error");
  }
});

// =====================
// 🔹 SUSCRIPCIONES
// =====================

// agregar o renovar
app.post('/api/suscripciones', async (req, res) => {
  const { cliente_id, tipo, fecha_fin } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO suscripciones(cliente_id, tipo, fecha_fin, activa)
       VALUES($1,$2,$3,true) RETURNING *`,
      [cliente_id, tipo, fecha_fin]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// cancelar
app.post('/api/cancelar', async (req, res) => {
  const { id } = req.body;

  try {
    await pool.query(
      'UPDATE suscripciones SET activa=false WHERE id=$1',
      [id]
    );
    res.send("Cancelado");
  } catch (err) {
    res.status(500).send("Error");
  }
});

// listar todo (ADMIN)
app.get('/api/admin/listado', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id as cliente_id, c.nombre, c.telefono,
             s.id as sub_id, s.tipo, s.fecha_fin, s.activa
      FROM clientes c
      LEFT JOIN suscripciones s ON c.id = s.cliente_id
      ORDER BY c.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error");
  }
});

// =====================
// 🔹 LOGIN ADMIN
// =====================
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;

  if (user === 'admin' && pass === 'admin123') {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

// =====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Servidor en puerto", PORT);
});