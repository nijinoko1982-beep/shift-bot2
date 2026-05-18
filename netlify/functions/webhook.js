const https = require('https');

// =============================================
// ★ここを書き換えてください（3箇所）
// =============================================
const ACCESS_TOKEN   = 'YOUR_ACCESS_TOKEN';
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const GAS_URL        = 'YOUR_GAS_URL';
// GAS_URL = スプレッドシートのGASのデプロイURL
// 例: https://script.google.com/macros/s/xxx/exec

// シフトの選択肢
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

// ユーザーの状態をメモリで管理
const userStates = {};

exports.handler = async (event) => {
  // LINEからのPOSTリクエストのみ処理
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const body = JSON.parse(event.body);
    const events = body.events || [];

    for (const e of events) {
      if (e.type === 'message' && e.message.type === 'text') {
        await handleText(e);
      } else if (e.type === 'postback') {
        await handlePostback(e);
      }
    }
  } catch (err) {
    console.error('ERROR:', err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'ok' })
  };
};

async function handleText(event) {
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  if (text === 'シフト希望を入力' || text === 'スタート' || text === 'start') {
    await startFlow(userId, replyToken);
  } else if (text === '終了' || text === 'おわり') {
    await endFlow(userId, replyToken);
  } else {
    await replyText(replyToken, '「シフト希望を入力」と送ってください📅');
  }
}

async function handlePostback(event) {
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const data = event.postback.data;
  const params = Object.fromEntries(data.split('&').map(p => p.split('=')));

  if (params.action === 'select_date') {
    await onDateSelected(userId, replyToken, decodeURIComponent(params.date));
  } else if (params.action === 'select_shift') {
    await onShiftSelected(userId, replyToken, decodeURIComponent(params.shift));
  } else if (params.action === 'continue') {
    await startFlow(userId, replyToken);
  } else if (params.action === 'end') {
    await endFlow(userId, replyToken);
  }
}

async function startFlow(userId, replyToken) {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const year = nextMonth.getFullYear();
  const month = nextMonth.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const DAYS = ['日','月','火','水','木','金','土'];

  const items = [];
  for (let d = 1; d <= Math.min(daysInMonth, 13); d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `${d}日(${DAYS[dow]})`,
        data: `action=select_date&date=${year}-${mm}-${dd}`
      }
    });
  }

  userStates[userId] = { step: 'date', year, month, daysInMonth };

  await replyMessage(replyToken, {
    type: 'text',
    text: `📅 ${month}月のシフト希望を入力します！\n日付を選んでください👇\n（1〜13日）`,
    quickReply: { items }
  });
}

async function onDateSelected(userId, replyToken, date) {
  userStates[userId] = { ...(userStates[userId] || {}), step: 'shift', date };

  const items = SHIFTS.map(shift => ({
    type: 'action',
    action: {
      type: 'postback',
      label: shift.length > 20 ? shift.substring(0, 20) : shift,
      data: `action=select_shift&shift=${encodeURIComponent(shift)}`
    }
  }));

  await replyMessage(replyToken, {
    type: 'text',
    text: `${date} のシフトを選んでください👇`,
    quickReply: { items }
  });
}

async function onShiftSelected(userId, replyToken, shift) {
  const state = userStates[userId] || {};
  const date = state.date || '不明';
  const profile = await getUserProfile(userId);
  const name = profile ? profile.displayName : userId;

  await writeToGAS(name, userId, date, shift);
  delete userStates[userId];

  await replyMessage(replyToken, {
    type: 'text',
    text: `✅ 記録しました！\n📅 ${date}\n🕐 ${shift}\n👤 ${name}\n\n続けて入力しますか？`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'postback', label: '📅 続けて入力', data: 'action=continue' }
        },
        {
          type: 'action',
          action: { type: 'postback', label: '✅ 終了する', data: 'action=end' }
        }
      ]
    }
  });
}

async function endFlow(userId, replyToken) {
  const profile = await getUserProfile(userId);
  const name = profile ? profile.displayName : userId;
  await replyText(replyToken,
    `📋 ${name}さんの入力が完了しました！\n\nお疲れさまでした！🎉\n変更がある場合は\nもう一度「シフト希望を入力」と送ってね✏️`
  );
}

async function writeToGAS(name, userId, date, shift) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthLabel = `${next.getFullYear()}年${next.getMonth() + 1}月`;
  const params = new URLSearchParams({ name, userId, date, shift, month: monthLabel });
  const url = `${GAS_URL}?${params.toString()}`;
  await fetch(url);
}

async function getUserProfile(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function replyText(replyToken, text) {
  await replyMessage(replyToken, { type: 'text', text });
}

async function replyMessage(replyToken, message) {
  await fetch('https://api.line.me/v2/bot/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`
    },
    body: JSON.stringify({ replyToken, messages: [message] })
  });
}
