const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DB_FILE = path.join(DIR, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI;

let dbMode = 'json';
let MongoClient, client, dbConn;

/* ====== DB INITIALIZATION ====== */
async function initDB() {
  if (MONGODB_URI) {
    try {
      MongoClient = require('mongodb').MongoClient;
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      dbConn = client.db();
      dbMode = 'mongo';
      console.log('📦 Connected to MongoDB Atlas');

      // ตรวจสอบและสร้าง Admin เริ่มต้นถ้ายังไม่มีใครในระบบ
      const userCount = await dbConn.collection('users').countDocuments();
      if (userCount === 0) {
        await dbConn.collection('users').insertOne({
          id: 1,
          username: 'admin',
          password: '8520',
          name: 'Administrator',
          role: 'admin'
        });
        await dbConn.collection('meta').updateOne({ id: 'main' }, { $set: { nextUserId: 2 } }, { upsert: true });
        console.log('👤 Created default admin user (admin/8520)');
      }
    } catch (e) {
      console.warn('⚠️ MongoDB connection failed, falling back to JSON file:', e.message);
      dbMode = 'json';
    }
  } else {
    console.log('🏠 Local mode: Using db.json');
  }
}

/* ====== DB HELPERS ====== */
async function getDB() {
  if (dbMode === 'mongo') {
    const users = await dbConn.collection('users').find().toArray();
    const records = await dbConn.collection('records').find().toArray();
    const meta = await dbConn.collection('meta').findOne({ id: 'main' }) || { nextUserId: 2 };
    return { users, records, nextUserId: meta.nextUserId };
  } else {
    if (!fs.existsSync(DB_FILE)) {
      const init = { users: [{ id: 1, username: 'admin', password: '8520', name: 'Administrator', role: 'admin' }], records: [], nextUserId: 2 };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
      return init;
    }
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch(e) { return { users: [], records: [], nextUserId: 1 }; }
  }
}

async function saveUser(user) {
  if (dbMode === 'mongo') {
    await dbConn.collection('users').insertOne(user);
    await dbConn.collection('meta').updateOne({ id: 'main' }, { $inc: { nextUserId: 1 } }, { upsert: true });
  } else {
    const db = await getDB();
    db.users.push(user);
    db.nextUserId++;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

async function updateUser(id, updateData) {
  if (dbMode === 'mongo') {
    await dbConn.collection('users').updateOne({ id: parseInt(id) }, { $set: updateData });
  } else {
    const db = await getDB();
    const u = db.users.find(u => u.id === parseInt(id));
    if (u) Object.assign(u, updateData);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

async function deleteUser(id) {
  if (dbMode === 'mongo') {
    await dbConn.collection('users').deleteOne({ id: parseInt(id) });
    await dbConn.collection('records').deleteMany({ user_id: String(id) });
  } else {
    const db = await getDB();
    db.users = db.users.filter(u => u.id !== parseInt(id));
    db.records = db.records.filter(r => String(r.user_id) !== String(id));
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

async function saveRecord(rec) {
  if (dbMode === 'mongo') {
    await dbConn.collection('records').replaceOne(
      { user_id: rec.user_id, date: rec.date }, 
      rec, 
      { upsert: true }
    );
  } else {
    const db = await getDB();
    const idx = db.records.findIndex(r => String(r.user_id) === rec.user_id && r.date === rec.date);
    if (idx >= 0) db.records[idx] = rec; else db.records.push(rec);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

async function deleteRecord(uid, date) {
  if (dbMode === 'mongo') {
    await dbConn.collection('records').deleteOne({ user_id: uid, date: date });
  } else {
    const db = await getDB();
    db.records = db.records.filter(r => !(String(r.user_id) === uid && r.date === date));
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

/* ====== MIME ====== */
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };

/* ====== BODY ====== */
function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end();
}

/* ====== SERVER ====== */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') return cors(res);

  if (pathname.startsWith('/api/')) {
    const db = await getDB();

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody(req);
      if (!body.username || !body.password || !body.name) return json(res, 400, { error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
      if (db.users.find(u => u.username === body.username)) return json(res, 400, { error: 'รหัสพนักงานนี้มีในระบบแล้ว' });
      const u = { id: db.nextUserId, username: body.username, password: body.password, name: body.name, role: 'user' };
      await saveUser(u);
      return json(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const u = db.users.find(u => u.username === body.username && u.password === body.password);
      if (!u) return json(res, 401, { error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
      return json(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role });
    }

    const dataMatch = pathname.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && dataMatch) {
      const rec = db.records.find(r => String(r.user_id) === dataMatch[1] && r.date === dataMatch[2]);
      return json(res, 200, rec ? JSON.parse(rec.data_json) : null);
    }

    if (req.method === 'POST' && dataMatch) {
      const body = await readBody(req);
      const [, uid, date] = dataMatch;
      const rec = { 
        user_id: uid, date, 
        opening_total: body.opening_total, 
        actual_total: body.actual_total, 
        transfer_total: body.transfer_total, 
        cash_pkg_total: body.cash_pkg_total, 
        drop_cash_total: body.drop_cash_total || 0,
        pkg_count: body.pkg_count, 
        status: body.status || 'draft',
        session_code: body.session_code || '',
        data_json: JSON.stringify(body.data_json) 
      };
      await saveRecord(rec);
      return json(res, 200, { success: true });
    }

    const histMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === 'GET' && histMatch) {
      const rows = db.records.filter(r => String(r.user_id) === histMatch[1]).sort((a, b) => b.date.localeCompare(a.date));
      return json(res, 200, rows);
    }

    if (req.method === 'GET' && pathname === '/api/admin/users') {
      return json(res, 200, db.users.filter(u => u.role !== 'admin').map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role })));
    }

    const userEditMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'POST' && userEditMatch) {
      const body = await readBody(req);
      const updateData = {};
      if (body.name) updateData.name = body.name;
      if (body.password && body.password.trim()) updateData.password = body.password.trim();
      await updateUser(userEditMatch[1], updateData);
      return json(res, 200, { success: true });
    }

    if (req.method === 'DELETE' && userEditMatch) {
      await deleteUser(userEditMatch[1]);
      return json(res, 200, { success: true });
    }

    if (req.method === 'GET' && pathname === '/api/admin/summary') {
      const result = db.records.map(r => {
        const u = db.users.find(u => String(u.id) === String(r.user_id)) || {};
        return { ...r, user_name: u.name || '?', username: u.username || '-' };
      }).sort((a, b) => b.date.localeCompare(a.date));
      return json(res, 200, result);
    }

    const recordDeleteMatch = pathname.match(/^\/api\/admin\/records\/([^/]+)\/([^/]+)$/);
    if (req.method === 'DELETE' && recordDeleteMatch) {
      await deleteRecord(recordDeleteMatch[1], recordDeleteMatch[2]);
      return json(res, 200, { success: true });
    }

    return json(res, 404, { error: 'Not found' });
  }

  let filePath = path.join(DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) { filePath = path.join(DIR, 'index.html'); }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(filePath).pipe(res);

});

// Start initialization then server
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\u2705 J&T Online System Ready: Port ${PORT}`);
  });
});
