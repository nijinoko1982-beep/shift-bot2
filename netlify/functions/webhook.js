exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  const ACCESS_TOKEN = 'jN1cM++5VyjCL8mTG7Oz2Ep2+yCkwPF5gRBNP16xEJitf33HXW7I+w552IAHIHez19gxIspmqUblWw1KISdoOn3k3dQKr6RBToHv8wiOmQqAZhOxIWmXjK84pUwnPyWY0353sMtO6dbw+v3Xsqr5BAdB04t89/1O/w1cDnyilFU=';
  const GAS_URL      = 'https://script.google.com/macros/s/AKfycbwZz52y-81yvTYt8wAXf_TXB_L-4xJy4D2kRc9oKiLPxCrDBWTI2tIVUzf6I4SnF76HQg/exec';

  const SHIFTS = [
    '①平日 14:00-18:15',
    '①木曜 13:30-18:15',
    '②土曜全日 9:00-17:00',
    '③土曜/長期午前 8:30-13:00',
    '④土曜/長期午後 13:00-18:00',
    '⑤長期終日A 9:45-18:15',
    '⑥長期終日B 8:00-17:00',
    '⑦長期終日C 9:30-17:30',
    '⑧長期終日D 8:30-17:30',
    '⑨給食なし 11:00-18:15',
    '⑩出勤不可',
    '★有給'
  ];

  const states = {};

  try {
    const body = JSON.parse(event.body);
    for (const e of (body.events || [])) {
      const uid = e.source.userId;
      const rt  = e.replyToken;

      if (e.type === 'message' && e.message.type === 'text') {
        const txt = e.message.text.trim();
        if (txt === 'シフト希望を入力' || txt === 'スタート') {
          await sendDatePicker(uid, rt, ACCESS_TOKEN);
        } else if (txt === '終了') {
          await send(rt, ACCESS_TOKEN, [{ type: 'text', text: 'お疲れさまでした！🎉\n変更は「シフト希望を入力」で再入力できます✏️' }]);
        } else {
          await send(rt, ACCESS_TOKEN, [{ type: 'text', text: '「シフト希望を入力」と送ってください📅' }]);
        }
      } else if (e.type === 'postback') {
        const p = Object.fromEntries(e.postback.data.split('&').map(x => x.split('=')));
        if (p.action === 'date') {
          const date = decodeURIComponent(p.date);
          await sendShiftPicker(rt, ACCESS_TOKEN, date, SHIFTS);
        } else if (p.action === 'shift') {
          const date  = decodeURIComponent(p.date);
          const shift = decodeURIComponent(p.shift);
          const name  = await getName(uid, ACCESS_TOKEN);
          await saveToGAS(GAS_URL, name, uid, date, shift);
          await send(rt, ACCESS_TOKEN, [{
            type: 'text',
            text: `✅ 記録しました！\n📅 ${date}\n🕐 ${shift}\n👤 ${name}\n\n続けて入力しますか？`,
            quickReply: { items: [
              { type: 'action', action: { type: 'postback', label: '📅 続けて入力', data: 'action=start' }},
              { type: 'action', action: { type: 'message',  label: '✅ 終了する',   text: '終了' }}
            ]}
          }]);
        } else if (p.action === 'start') {
          await sendDatePicker(uid, rt, ACCESS_TOKEN);
        }
      }
    }
  } catch(err) {
    console.log('ERR:', err.message);
  }

  return { statusCode: 200, body: 'OK' };
};

async function sendDatePicker(uid, rt, token) {
  const now   = new Date();
  const year  = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const month = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
  const days  = new Date(year, month, 0).getDate();
  const DAYS  = ['日','月','火','水','木','金','土'];
  const items = [];
  for (let d = 1; d <= Math.min(days, 13); d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const mm  = String(month).padStart(2,'0');
    const dd  = String(d).padStart(2,'0');
    items.push({ type: 'action', action: {
      type: 'postback',
      label: `${d}日(${DAYS[dow]})`,
      data: `action=date&date=${year}-${mm}-${dd}`
    }});
  }
  await send(rt, token, [{
    type: 'text',
    text: `📅 ${month}月のシフト希望を入力！\n日付を選んでください👇`,
    quickReply: { items }
  }]);
}

async function sendShiftPicker(rt, token, date, shifts) {
  const items = shifts.map(s => ({ type: 'action', action: {
    type: 'postback',
    label: s.length > 20 ? s.slice(0,20) : s,
    data: `action=shift&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(s)}`
  }}));
  await send(rt, token, [{
    type: 'text',
    text: `${date} のシフトを選んでください👇`,
    quickReply: { items }
  }]);
}

async function send(rt, token, messages) {
  await fetch('https://api.line.me/v2/bot/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken: rt, messages })
  });
}

async function getName(uid, token) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${uid}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    return j.displayName || uid;
  } catch(e) { return uid; }
}

async function saveToGAS(gasUrl, name, uid, date, shift) {
  const now   = new Date();
  const next  = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const month = `${next.getFullYear()}年${next.getMonth()+1}月`;
  const url   = `${gasUrl}?name=${encodeURIComponent(name)}&userId=${uid}&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}&month=${encodeURIComponent(month)}`;
  await fetch(url);
}
