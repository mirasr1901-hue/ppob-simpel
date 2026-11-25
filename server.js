const express = require('express');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MERCHANT = process.env.TRIPAY_MERCHANT;
const APIKEY = process.env.TRIPAY_APIKEY;
const PRIVATE = process.env.TRIPAY_PRIVATE;
const BASE_URL = process.env.BASE_URL || 'https://ppob-simpel-production.up.railway.app';
const MODE = process.env.MODE || 'sandbox';
const TRIPAY_URL = MODE === 'sandbox' ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api';

const read = () => JSON.parse(fs.readFileSync('data.json', 'utf8'));
const save = (d) => fs.writeFileSync('data.json', JSON.stringify(d, null, 2));

function sign(method, uri, body) {
  const data = method + uri + (typeof body === 'string' ? body : JSON.stringify(body));
  return crypto.createHmac('sha256', PRIVATE).update(data).digest('hex');
}

// Produk
app.get('/api/products', (req, res) => res.json(read().products));

// Order
app.post('/api/order', async (req, res) => {
  const { items, customer, method } = req.body;
  if (!items || !items.length) return res.json({ ok: false, msg: 'Keranjang kosong' });
  if (!customer || !customer.name || !customer.phone) return res.json({ ok: false, msg: 'Data tidak lengkap' });

  const data = read();
  let total = 0;
  const orderItems = items.map(i => {
    const p = data.products.find(x => x.id == i.id);
    if (!p) throw new Error('Produk tidak ada');
    if (p.stock < i.qty) throw new Error('Stok ' + p.name + ' habis');
    total += p.price * i.qty;
    return { productId: p.id, name: p.name, price: p.price, qty: i.qty };
  });

  items.forEach(i => { const p = data.products.find(x => x.id == i.id); p.stock -= i.qty; });

  const refId = 'ORD' + Date.now();
  const order = { id: refId, items: orderItems, total, customer, method, status: 'pending', createdAt: new Date().toISOString() };
  data.orders.push(order);

  // Buat transaksi Tripay
  try {
    const uri = '/transaction/create';
    const body = {
      method: method || 'QRIS',
      merchant_code: MERCHANT,
      return_url: BASE_URL,
      callback_url: BASE_URL + '/api/callback',
      reference_id: refId,
      amount: total,
      customer_name: customer.name,
      customer_email: customer.phone + '@email.com',
      customer_phone: customer.phone,
      order_items: orderItems.map(i => ({ sku: 'P' + i.productId, name: i.name, price: i.price, quantity: i.qty }))
    };

    const r = await axios.post(TRIPAY_URL + uri, body, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + APIKEY, 'Signature': sign('POST', uri, body) }
    });

    order.payCode = r.data.data.pay_code;
    order.checkoutUrl = r.data.data.checkout_url;
    order.qrString = r.data.data.qr_string;
    save(data);
    res.json({ ok: true, order });
  } catch (err) {
    res.json({ ok: false, msg: err.response?.data?.message || err.message });
  }
});

// Callback Tripay
app.post('/api/callback', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const cb = JSON.parse(req.body.toString());
    const sig = crypto.createHmac('sha256', PRIVATE).update(JSON.stringify(cb)).digest('hex');
    if (sig !== cb.signature) return res.status(400).json({ success: false });
    const data = read();
    const o = data.orders.find(x => x.id === cb.reference);
    if (o) {
      o.status = cb.status === 'PAID' ? 'paid' : cb.status === 'EXPIRED' ? 'expired' : o.status;
      save(data);
    }
    res.json({ success: true });
  } catch (e) { res.status(400).json({ success: false }); }
});

// Cek order
app.get('/api/order/:id', (req, res) => {
  const o = read().orders.find(x => x.id === req.params.id);
  o ? res.json({ ok: true, order: o }) : res.json({ ok: false });
});

// Admin: semua order
app.get('/api/orders', (req, res) => res.json(read().orders.reverse()));

// Admin: tambah produk
app.post('/api/admin/product', (req, res) => {
  const data = read();
  const p = { id: Date.now(), ...req.body, price: Number(req.body.price), stock: Number(req.body.stock) };
  data.products.push(p);
  save(data);
  res.json({ ok: true, product: p });
});

// Admin: hapus produk
app.delete('/api/admin/product/:id', (req, res) => {
  const data = read();
  data.products = data.products.filter(x => x.id != req.params.id);
  save(data);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('E-commerce Tripay jalan port ' + PORT));
