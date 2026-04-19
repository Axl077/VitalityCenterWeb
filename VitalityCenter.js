const express = require('express');
const { Pool } = require('pg');
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/VitalityCenter',
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// Probar conexión
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error de conexión' });
  }
});

// Ver membresías disponibles
app.get('/api/membresias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id_membresia, nombre, duracion_dias, descuento_productos
      FROM membresia
      ORDER BY id_membresia
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener membresías' });
  }
});

app.post('/api/registro-completo', async (req, res) => {
  const { nombre, telefono, correo, id_membresia, fecha_inicio } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const clienteInsert = await client.query(
      `INSERT INTO cliente (nombre, telefono, correo)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, telefono, correo]
    );

    const cliente = clienteInsert.rows[0];

    const membresiaInfo = await client.query(
      `SELECT id_membresia, duracion_dias
       FROM membresia
       WHERE id_membresia = $1`,
      [id_membresia]
    );

    if (membresiaInfo.rows.length === 0) {
      throw new Error('La membresía seleccionada no existe');
    }

    const duracion = membresiaInfo.rows[0].duracion_dias;

    const membresiaInsert = await client.query(
      `INSERT INTO cliente_membresia
       (id_cliente, id_membresia, fecha_inicio, fecha_fin, estado)
       VALUES (
         $1,
         $2,
         $3::date,
         ($3::date + ($4 || ' days')::interval)::date,
         'activa'
       )
       RETURNING *`,
      [cliente.id_cliente, id_membresia, fecha_inicio, duracion]
    );

    await client.query('COMMIT');

    res.json({
      mensaje: 'Cliente y membresía registrados correctamente',
      cliente,
      cliente_membresia: membresiaInsert.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Error al registrar cliente con membresía',
      detalle: error.message
    });
  } finally {
    client.release();
  }
});

app.get('/api/buscar-clientes', async (req, res) => {
  const texto = req.query.texto || '';

  try {
    const result = await pool.query(
      `SELECT
         c.id_cliente,
         c.nombre,
         c.telefono,
         c.correo,
         m.nombre AS membresia,
         cm.fecha_inicio,
         cm.fecha_fin,
         cm.estado
       FROM cliente c
       LEFT JOIN cliente_membresia cm ON c.id_cliente = cm.id_cliente
       LEFT JOIN membresia m ON cm.id_membresia = m.id_membresia
       WHERE c.nombre ILIKE $1
          OR c.correo ILIKE $1
       ORDER BY c.id_cliente DESC`,
      [`%${texto}%`]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar clientes' });
  }
});

app.get('/api/clientes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id_cliente,
        c.nombre,
        c.telefono,
        c.correo,
        m.nombre AS membresia,
        cm.fecha_inicio,
        cm.fecha_fin,
        cm.estado
      FROM cliente c
      LEFT JOIN cliente_membresia cm ON c.id_cliente = cm.id_cliente
      LEFT JOIN membresia m ON cm.id_membresia = m.id_membresia
      ORDER BY c.id_cliente
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
