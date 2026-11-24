const express = require('express');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== KONFIGURASI TRIPAY =====
const MERCHANT = process.env.TRIPAY_MERCHANT;
const APIKEY   = process.env.TRIPAY_APIKEY;
const PRIVATE  = process.env.TRIPAY_PRIVATE;
const BASE_URL = process.env.BASE_URL;
const MODE     = process.env.MODE || 'production';

const TRIPAY_URL = MODE === 'sandbox' 
  ? 'https://tripay.co.id/api-sandbox' 
  : 'https://tripay.co.id/api';

// ===== HELPER =====
const read = () => JSON.parse(fs.readFileSync('data.json', 'utf8'));
const save = (d) => fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

function signature(method, uri, body = '') {
  const data = method + uri + (typeof body === 'string' ? body : JSON.stringify(body));
  return crypto.createHmac('sha256', PRIVATE).update(data).digest('hex');
}

// ===== REGISTER =====
app.post('/api/register', (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) return res.json({ ok: false, msg: 'Isi lengkap' });
  const data = read();
  if (data.users.find(u => u.phone === phone)) return res.json({ ok: false, msg: 'Sudah daftar' });
  const user = { id: Date.now(), phone, name, balance: 0, pin: '123456', createdAt: new Date().toISOString() };
  data.users.push(user);
  save(data);
  res.json({ ok: true, user });
});

// ===== LOGIN =====
app.post('/api/login', (req, res) => {
  const { phone, pin } = req.body;
  const user = read().users.find(u => u.phone === phone && u.pin === (pin || '123456'));
  user ? res.json({ ok: true, user }) : res.json({ ok: false, msg: 'Salah' });
});

// ===== TOP UP VIA TRIPAY =====
app.post('/api/topup', async (req, res) => {
  const { phone, amount, method } = req.body;
  const data = read();
  const user = data.users.find(u => u.phone === phone);
  if (!user) return res.json({ ok: false, msg: 'User tidak ditemukan' });
  if (!amount || amount < 10000) return res.json({ ok: false, msg: 'Min Rp 10.000' });

  const refId = 'TOP' + Date.now();
  const uri = '/transaction/create';
  const body = {
    method: method || 'QRIS',
    merchant_code: MERCHANT,
    return_url: BASE_URL,
    reference_id: refId,
    amount: Number(amount),
    customer_name: user.name,
    customer_email: user.phone + '@ppob.id',
    customer_phone: user.phone,
    order_items: [{ sku: 'topup', name: 'Top Up Saldo', price: Number(amount), quantity: 1 }]
  };

  try {
    const r = await axios.post(TRIPAY_URL + uri, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + APIKEY,
        'Signature': signature('POST', uri, body)
      }
    });

    const tx = r.data.data;
    data.transactions.push({
      id: Date.now(), userId: user.id, type: 'topup_pending',
      amount: Number(amount), desc: 'Top Up - Menunggu Pembayaran',
      reference: refId, pay_code: tx.pay_code, checkout_url: tx.checkout_url,
      qr_string: tx.qr_string, date: new Date().toISOString()
    });
    save(data);
    res.json({ ok: true, checkout_url: tx.checkout_url, qr_string: tx.qr_string, pay_code: tx.pay_code, reference: refId });
  } catch (err) {
    res.json({ ok: false, msg: err.response?.data?.message || err.message });
  }
});

// ===== CALLBACK TRIPAY =====
app.post('/api/callback', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const callbackData = JSON.parse(req.body.toString());
    const privateSignature = crypto.createHmac('sha256', PRIVATE)
      .update(JSON.stringify(callbackData)).digest('hex');

    if (privateSignature !== callbackData.signature) {
      return res.status(400).json({ success: false });
    }

    const data = read();
    const tx = data.transactions.find(t => t.reference === callbackData.reference);
    if (!tx) return res.json({ success: true });

    if (callbackData.status === 'PAID' || callbackData.status === 'SETTLED') {
      const user = data.users.find(u => u.id === tx.userId);
      if (user) {
        user.balance += Number(callbackData.total_amount);
        tx.type = 'topup';
        tx.desc = 'Top Up - Berhasil';
        tx.paid_at = new Date().toISOString();
        save(data);
      }
    } else if (callbackData.status === 'EXPIRED' || callbackData.status === 'FAILED') {
      tx.type = 'topup_failed';
      tx.desc = 'Top Up - Gagal/Expired';
      save(data);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false });
  }
});

// ===== CEK SALDO =====
app.get('/api/balance/:phone', (req, res) => {
  const user = read().users.find(u => u.phone === req.params.phone);
  user ? res.json({ ok: true, balance: user.balance, name: user.name }) : res.json({ ok: false });
});

// ===== RIWAYAT =====
app.get('/api/history/:phone', (req, res) => {
  const user = read().users.find(u => u.phone === req.params.phone);
  if (!user) return res.json({ ok: false });
  const hist = read().transactions.filter(t => t.userId === user.id).reverse();
  res.json({ ok: true, history: hist });
});

// ===== PRODUK =====
app.get('/api/products', (req, res) => {
  res.json({ ok: true, products: [
    { code: 't5', name: 'Telkomsel 5rb', price: 7000 },
    { code: 't10', name: 'Telkomsel 10rb', price: 12000 },
    { code: 't25', name: 'Telkomsel 25rb', price: 26000 },
    { code: 'pln50', name: 'PLN 50rb', price: 51500 }
  ]});
});

// ===== BELI (Simulasi) =====
app.post('/api/buy', (req, res) => {
  const { phone, productCode, target } = req.body;
  const data = read();
  const user = data.users.find(u => u.phone === phone);
  const products = [
    { code: 't5', name: 'Telkomsel 5rb', price: 7000 },
    { code: 't10', name: 'Telkomsel 10rb', price: 12000 },
    { code: 't25', name: 'Telkomsel 25rb', price: 26000 },
    { code: 'pln50', name: 'PLN 50rb', price: 51500 }
  ];
  const product = products.find(p => p.code === productCode);
  
  if (!user) return res.json({ ok: false, msg: 'User tidak ditemukan' });
  if (!product) return res.json({ ok: false, msg: 'Produk tidak ada' });
  if (user.balance < product.price) return res.json({ ok: false, msg: 'Saldo kurang' });

  user.balance -= product.price;
  data.transactions.push({
    id: Date.now(), userId: user.id, type: 'purchase',
    amount: product.price, desc: product.name + ' → ' + target,
    sn: 'SIM' + Date.now(), date: new Date().toISOString()
  });
  save(data);
  res.json({ ok: true, sn: 'SIM' + Date.now(), balance: user.balance, msg: '✅ Berhasil (simulasi)' });
});

// ===== SITEMAP =====
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>2026-11-24</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// ===== ROBOTS.TXT =====
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml`);
});

// ===== UI WEB =====
app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PPOB - Top Up Nyata</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
body{background:#f0f2f5;padding:15px}
.container{max-width:480px;margin:auto}
.card{background:#fff;padding:15px;border-radius:12px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
h1{color:#1a73e8;margin-bottom:10px;font-size:22px}
h2{font-size:16px;margin-bottom:10px}
input,select{width:100%;padding:12px;margin:5px 0;border:1px solid #ddd;border-radius:8px;font-size:14px}
button{width:100%;padding:12px;background:#1a73e8;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;margin-top:5px}
button:hover{background:#1557b0}
.bal{background:linear-gradient(135deg,#1a73e8,#0d47a1);color:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:10px}
.bal b{font-size:28px;display:block;margin-top:5px}
.bal small{opacity:0.9}
.tabs{display:flex;gap:5px;margin-bottom:10px}
.tab{flex:1;padding:10px;text-align:center;background:#e0e0e0;border-radius:8px;cursor:pointer;font-size:13px}
.tab.on{background:#1a73e8;color:#fff}
.item{padding:10px;border:1px solid #eee;border-radius:8px;margin:5px 0;display:flex;justify-content:space-between;align-items:center}
.item button{width:auto;padding:8px 16px;margin:0;font-size:12px}
.ok{background:#d4edda;color:#155724;padding:10px;border-radius:8px;margin:10px 0}
.err{background:#f8d7da;color:#721c24;padding:10px;border-radius:8px;margin:10px 0}
.hitem{padding:10px;border-bottom:1px solid #eee;font-size:13px}
.hitem b{display:block}
.hitem small{color:#888}
.hidden{display:none}
.qrbox{text-align:center;padding:15px;background:#f9f9f9;border-radius:8px;margin-top:10px}
.qrbox img{max-width:200px}
.qrbox code{display:block;margin-top:10px;padding:8px;background:#fff;border-radius:4px;font-size:12px}
</style></head><body>
<div class="container">
<h1>🏦 PPOB</h1>

<div id="loginBox" class="card">
<h2>Masuk / Daftar</h2>
<input id="ph" placeholder="No HP (08xxx)">
<input id="nm" placeholder="Nama (isi jika daftar baru)">
<input id="pin" type="password" placeholder="PIN (default: 123456)">
<button onclick="doLogin()">Masuk</button>
<div id="loginMsg"></div>
</div>

<div id="app" class="hidden">
<div class="bal">
<small>Saldo Anda</small>
<b id="balAmt">Rp 0</b>
<small id="usrInfo"></small>
</div>

<div class="tabs">
<div class="tab on" onclick="tab('p',this)">Top Up</div>
<div class="tab" onclick="tab('b',this)">Beli</div>
<div class="tab" onclick="tab('h',this)">Riwayat</div>
</div>

<div id="tabP" class="card">
<h2>💰 Top Up Saldo (Uang Asli)</h2>
<input id="amt" type="number" placeholder="Jumlah (min 10000)">
<select id="mtd">
<option value="QRIS">QRIS (Semua E-Wallet/M-Banking)</option>
<option value="BCAVA">VA BCA</option>
<option value="BNIVA">VA BNI</option>
<option value="BRIVA">VA BRI</option>
<option value="MDVA">VA Mandiri</option>
</select>
<button onclick="doTopup()">Bayar Sekarang</button>
<div id="payBox"></div>
<div id="payMsg"></div>
</div>

<div id="tabB" class="card hidden">
<h2>📱 Beli Produk (Simulasi)</h2>
<input id="tgt" placeholder="No HP / ID Pelanggan">
<div id="plist"></div>
<div id="buyMsg"></div>
</div>

<div id="tabH" class="card hidden">
<h2>📋 Riwayat</h2>
<div id="hist"></div>
</div>

<button onclick="logout()" style="background:#dc3545;margin-top:10px">Logout</button>
</div>
</div>

<script>
let U=null;
async function doLogin(){
  const ph=document.getElementById('ph').value;
  const nm=document.getElementById('nm').value;
  const pin=document.getElementById('pin').value||'123456';
  const msg=document.getElementById('loginMsg');
  let r=await(await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,pin})})).json();
  if(!r.ok&&nm){
    await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm})});
    r=await(await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,pin})})).json();
  }
  if(r.ok){U=r.user;document.getElementById('loginBox').classList.add('hidden');document.getElementById('app').classList.remove('hidden');load();}
  else{msg.innerHTML='<div class="err">'+r.msg+'</div>';}
}
async function load(){
  const b=await(await fetch('/api/balance/'+U.phone)).json();
  document.getElementById('balAmt').textContent='Rp '+b.balance.toLocaleString('id-ID');
  document.getElementById('usrInfo').textContent=U.name+' • '+U.phone;
  const p=await(await fetch('/api/products')).json();
  document.getElementById('plist').innerHTML=p.products.map(x=>'<div class="item"><div><b>'+x.name+'</b><br><small>'+x.price.toLocaleString('id-ID')+'</small></div><button onclick="buy(\\''+x.code+'\\')">Beli</button></div>').join('');
}
async function doTopup(){
  const amt=document.getElementById('amt').value;
  const mtd=document.getElementById('mtd').value;
  const msg=document.getElementById('payMsg');
  const box=document.getElementById('payBox');
  if(!amt||amt<10000){msg.innerHTML='<div class="err">Min Rp 10.000</div>';return;}
  msg.innerHTML='';box.innerHTML='Memproses...';
  const r=await(await fetch('/api/topup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:U.phone,amount:Number(amt),method:mtd})})).json();
  if(r.ok){
    if(r.qr_string){
      box.innerHTML='<div class="qrbox"><h3>Scan QRIS untuk Bayar</h3><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(r.qr_string)+'"><code>'+r.pay_code+'</code><p style="margin-top:10px;font-size:12px;color:#666">Setelah bayar, saldo otomatis masuk dalam 1-5 detik</p></div>';
    }else if(r.checkout_url){
      box.innerHTML='<div class="qrbox"><h3>Bayar via '+mtd+'</h3><p style="margin:10px 0">Kode Bayar:</p><code style="font-size:18px;padding:15px;display:block;background:#fff;border-radius:8px">'+r.pay_code+'</code><a href="'+r.checkout_url+'" target="_blank"><button style="margin-top:10px">Buka Halaman Pembayaran</button></a></div>';
    }
    setTimeout(load,3000);
  }else{box.innerHTML='';msg.innerHTML='<div class="err">'+r.msg+'</div>';}
}
async function buy(c){
  const t=document.getElementById('tgt').value;
  const msg=document.getElementById('buyMsg');
  if(!t){msg.innerHTML='<div class="err">Isi nomor tujuan</div>';return;}
  const r=await(await fetch('/api/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:U.phone,productCode:c,target:t})})).json();
  if(r.ok){msg.innerHTML='<div class="ok">✅ '+r.msg+'<br>SN: '+r.sn+'</div>';load();}
  else{msg.innerHTML='<div class="err">'+r.msg+'</div>';}
}
async function loadH(){
  const h=await(await fetch('/api/history/'+U.phone)).json();
  document.getElementById('hist').innerHTML=h.history.length?h.history.map(x=>'<div class="hitem"><b>'+x.desc+'</b><small>'+new Date(x.date).toLocaleString('id-ID')+'</small><br><span style="color:'+(x.type==='topup'?'green':'red')+'">'+x.amount.toLocaleString('id-ID')+' • '+x.type+'</span></div>').join(''):'<p style="text-align:center;color:#888;padding:20px">Belum ada transaksi</p>';
}
function tab(n,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  ['P','B','H'].forEach(i=>document.getElementById('tab'+i).classList.add('hidden'));
  document.getElementById('tab'+n).classList.remove('hidden');
  if(n==='h')loadH();
}
function logout(){U=null;document.getElementById('loginBox').classList.remove('hidden');document.getElementById('app').classList.add('hidden');}
</script>
</body></html>`));

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('PPOB Tripay production jalan di port ' + PORT));
