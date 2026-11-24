const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const read = () => JSON.parse(fs.readFileSync('data.json', 'utf8'));
const save = (d) => fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

app.post('/api/register', (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) return res.status(400).json({ ok: false, msg: 'Nama & nomor wajib diisi' });
  const data = read();
  if (data.users.find(u => u.phone === phone)) return res.status(400).json({ ok: false, msg: 'Nomor sudah terdaftar' });
  const user = { id: Date.now(), phone, name, balance: 0, pin: '123456', createdAt: new Date().toISOString() };
  data.users.push(user);
  save(data);
  res.json({ ok: true, user });
});

app.post('/api/login', (req, res) => {
  const { phone, pin } = req.body;
  const data = read();
  const user = data.users.find(u => u.phone === phone && u.pin === pin);
  if (!user) return res.status(401).json({ ok: false, msg: 'Nomor atau PIN salah' });
  res.json({ ok: true, user });
});

app.post('/api/topup', (req, res) => {
  const { phone, amount } = req.body;
  const data = read();
  const user = data.users.find(u => u.phone === phone);
  if (!user) return res.status(404).json({ ok: false, msg: 'User tidak ditemukan' });
  user.balance += Number(amount);
  data.transactions.push({ id: Date.now(), userId: user.id, type: 'topup', amount: Number(amount), desc: 'Top up saldo', date: new Date().toISOString() });
  save(data);
  res.json({ ok: true, balance: user.balance });
});

app.post('/api/buy', (req, res) => {
  const { phone, productCode, target } = req.body;
  const data = read();
  const user = data.users.find(u => u.phone === phone);
  const product = data.products.find(p => p.code === productCode);
  if (!user) return res.status(404).json({ ok: false, msg: 'User tidak ditemukan' });
  if (!product) return res.status(400).json({ ok: false, msg: 'Produk tidak ada' });
  if (user.balance < product.price) return res.status(400).json({ ok: false, msg: 'Saldo tidak cukup' });
  user.balance -= product.price;
  const sn = 'SN' + Date.now();
  data.transactions.push({ id: Date.now(), userId: user.id, type: 'purchase', amount: product.price, desc: 'Beli ' + product.name + ' ke ' + target, sn, date: new Date().toISOString() });
  save(data);
  res.json({ ok: true, sn, balance: user.balance, product: product.name });
});

app.get('/api/balance/:phone', (req, res) => {
  const data = read();
  const user = data.users.find(u => u.phone === req.params.phone);
  if (!user) return res.status(404).json({ ok: false, msg: 'User tidak ditemukan' });
  res.json({ ok: true, phone: user.phone, name: user.name, balance: user.balance });
});

app.get('/api/history/:phone', (req, res) => {
  const data = read();
  const user = data.users.find(u => u.phone === req.params.phone);
  if (!user) return res.status(404).json({ ok: false, msg: 'User tidak ditemukan' });
  const history = data.transactions.filter(t => t.userId === user.id).reverse();
  res.json({ ok: true, history });
});

app.get('/api/products', (req, res) => {
  res.json({ ok: true, products: read().products });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Server jalan di port ' + PORT));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>PPOB Simpel</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
  body { background: #f0f2f5; padding: 20px; }
  .container { max-width: 500px; margin: 0 auto; }
  .card { background: white; padding: 20px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { color: #1a73e8; margin-bottom: 10px; }
  h2 { color: #333; margin-bottom: 15px; font-size: 18px; }
  input, select { width: 100%; padding: 12px; margin: 6px 0; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
  button { width: 100%; padding: 12px; background: #1a73e8; color: white; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; margin-top: 8px; font-weight: bold; }
  button:hover { background: #1557b0; }
  .balance { background: linear-gradient(135deg, #1a73e8, #0d47a1); color: white; padding: 20px; border-radius: 12px; text-align: center; }
  .balance .amount { font-size: 28px; font-weight: bold; margin-top: 8px; }
  .balance .label { opacity: 0.9; font-size: 13px; }
  .item { padding: 12px; border: 1px solid #eee; border-radius: 8px; margin: 6px 0; display: flex; justify-content: space-between; align-items: center; }
  .item button { width: auto; padding: 8px 16px; margin: 0; font-size: 13px; }
  .msg { padding: 10px; border-radius: 8px; margin: 10px 0; display: none; }
  .msg.ok { background: #d4edda; color: #155724; display: block; }
  .msg.err { background: #f8d7da; color: #721c24; display: block; }
  .history-item { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }
  .history-item .desc { font-weight: bold; }
  .history-item .date { color: #888; font-size: 11px; }
  .tabs { display: flex; gap: 5px; margin-bottom: 15px; }
  .tab { flex: 1; padding: 10px; text-align: center; background: #e0e0e0; border-radius: 8px; cursor: pointer; font-size: 13px; }
  .tab.active { background: #1a73e8; color: white; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="container">
  <h1>🏦 PPOB Simpel</h1>
  <div id="loginSection" class="card">
    <h2>Login / Daftar</h2>
    <input id="loginPhone" placeholder="Nomor HP (08xxx)">
    <input id="loginName" placeholder="Nama (untuk daftar baru)">
    <input id="loginPin" type="password" placeholder="PIN (default: 123456)">
    <button onclick="doLogin()">Masuk / Daftar</button>
    <div id="loginMsg" class="msg"></div>
  </div>
  <div id="dashboard" class="hidden">
    <div class="balance">
      <div class="label">Saldo Anda</div>
      <div class="amount" id="balanceAmount">Rp 0</div>
      <div class="label" id="userName"></div>
    </div>
    <div class="tabs">
      <div class="tab active" onclick="showTab('produk')">Produk</div>
      <div class="tab" onclick="showTab('topup')">Top Up</div>
      <div class="tab" onclick="showTab('riwayat')">Riwayat</div>
    </div>
    <div id="tabProduk" class="card">
      <h2>Beli Pulsa / PLN</h2>
      <input id="targetNumber" placeholder="Nomor tujuan / ID Pelanggan">
      <div id="productList"></div>
      <div id="buyMsg" class="msg"></div>
    </div>
    <div id="tabTopup" class="card hidden">
      <h2>Top Up Saldo</h2>
      <input id="topupAmount" type="number" placeholder="Jumlah (contoh: 50000)">
      <button onclick="doTopup()">Top Up Sekarang</button>
      <div id="topupMsg" class="msg"></div>
    </div>
    <div id="tabRiwayat" class="card hidden">
      <h2>Riwayat Transaksi</h2>
      <div id="historyList"></div>
    </div>
    <button onclick="logout()" style="background:#dc3545;margin-top:10px">Logout</button>
  </div>
</div>
<script>
let currentUser = null;
async function doLogin() {
  const phone = document.getElementById('loginPhone').value;
  const name = document.getElementById('loginName').value;
  const pin = document.getElementById('loginPin').value || '123456';
  const msg = document.getElementById('loginMsg');
  let res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone, pin }) });
  let data = await res.json();
  if (!data.ok && name) {
    res = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone, name }) });
    data = await res.json();
    if (data.ok) {
      res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone, pin }) });
      data = await res.json();
    }
  }
  if (data.ok) {
    currentUser = data.user;
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadDashboard();
  } else { msg.className = 'msg err'; msg.textContent = data.msg; }
}
async function loadDashboard() {
  const res = await fetch('/api/balance/' + currentUser.phone);
  const data = await res.json();
  document.getElementById('balanceAmount').textContent = 'Rp ' + data.balance.toLocaleString('id-ID');
  document.getElementById('userName').textContent = data.name + ' • ' + data.phone;
  const pRes = await fetch('/api/products');
  const pData = await pRes.json();
  document.getElementById('productList').innerHTML = pData.products.map(p => '<div class="item"><div><b>' + p.name + '</b><br><small>' + rp(p.price) + '</small></div><button onclick="doBuy(\\'' + p.code + '\\')">Beli</button></div>').join('');
  loadHistory();
}
function rp(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }
async function doBuy(code) {
  const target = document.getElementById('targetNumber').value;
  const msg = document.getElementById('buyMsg');
  if (!target) { msg.className='msg err'; msg.textContent='Isi nomor tujuan'; return; }
  const res = await fetch('/api/buy', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone: currentUser.phone, productCode: code, target }) });
  const data = await res.json();
  if (data.ok) { msg.className = 'msg ok'; msg.textContent = '✅ Berhasil! SN: ' + data.sn; loadDashboard(); }
  else { msg.className = 'msg err'; msg.textContent = data.msg; }
}
async function doTopup() {
  const amount = document.getElementById('topupAmount').value;
  const msg = document.getElementById('topupMsg');
  if (!amount || amount < 10000) { msg.className='msg err'; msg.textContent='Min. Rp 10.000'; return; }
  const res = await fetch('/api/topup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone: currentUser.phone, amount: Number(amount) }) });
  const data = await res.json();
  if (data.ok) { msg.className = 'msg ok'; msg.textContent = '✅ Top up berhasil!'; loadDashboard(); document.getElementById('topupAmount').value = ''; }
  else { msg.className = 'msg err'; msg.textContent = data.msg; }
}
async function loadHistory() {
  const res = await fetch('/api/history/' + currentUser.phone);
  const data = await res.json();
  document.getElementById('historyList').innerHTML = data.history.length === 0 ? '<p style="color:#888;text-align:center;padding:20px">Belum ada transaksi</p>' : data.history.map(h => '<div class="history-item"><div class="desc">' + h.desc + '</div><div>' + rp(h.amount) + ' • ' + h.type + '</div><div class="date">' + new Date(h.date).toLocaleString('id-ID') + '</div></div>').join('');
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabProduk').classList.add('hidden');
  document.getElementById('tabTopup').classList.add('hidden');
  document.getElementById('tabRiwayat').classList.add('hidden');
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.remove('hidden');
  event.target.classList.add('active');
  if (name === 'riwayat') loadHistory();
}
function logout() { currentUser = null; document.getElementById('loginSection').classList.remove('hidden'); document.getElementById('dashboard').classList.add('hidden'); }
</script>
</body>
</html>`);
});
