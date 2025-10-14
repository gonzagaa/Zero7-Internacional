const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();
const app = express();

const allowedOrigin = 'https://zero7.com.br'; // frontend
app.use(cors({
  origin: allowedOrigin,
  methods: ['POST'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

app.post('/api/send-event', async (req, res) => {
  const { event_name, event_id, fbc, fbp, email } = req.body;

  const hashedEmail = crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex');

  const payload = {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id,
    event_source_url: 'https://zero7.com.br/home',
    action_source: 'website',
    user_data: {
      em: [hashedEmail],
      fbc: fbc || null,
      fbp: fbp || null
    }
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.FACEBOOK_PIXEL_ID}/events`,
      {
        data: [payload],
        access_token: process.env.FACEBOOK_ACCESS_TOKEN,
      }
    );

    console.log('✅ Evento enviado com sucesso para o Facebook:', response.data);
    res.status(200).json({ success: true, fb: response.data });
  } catch (error) {
    console.error('❌ Erro ao enviar evento para o Facebook:', error?.response?.data || error.message);
    res.status(500).json({ success: false, error: error?.response?.data || error.message });
  }
});

module.exports = app;
