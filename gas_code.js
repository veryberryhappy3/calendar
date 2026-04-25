// ════════════════════════════════════════════════════════════
//  家族カレンダー  Google Apps Script バックエンド  v2
//  更新: 2026-04-25 サーバー側マージ対応（複数デバイス同時書き込み競合解消）
//
//  デプロイ方法:
//    1. https://script.google.com を開く
//    2. 「新しいプロジェクト」→ このファイルの内容を全て貼り付けて保存
//    3. 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
//    4. 実行者: 自分 ／ アクセス: 全員（匿名を含む）→「デプロイ」
//    5. 表示されたURLをコピー
//    6. index.html の GAS_URL = '' の '' の中に貼り付ける
//    7. GitHubにプッシュ → 全デバイスで自動同期が始まります
// ════════════════════════════════════════════════════════════

const SHEET_NAME = 'CalendarData';

function getSheet() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) { ss = null; }

  if (!ss) {
    // スタンドアロンスクリプトの場合: スクリプトプロパティからIDを取得 or 新規作成
    const props = PropertiesService.getScriptProperties();
    const ssId  = props.getProperty('SPREADSHEET_ID');
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
    } else {
      ss = SpreadsheetApp.create('家族カレンダーデータ');
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  }

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange('A1').setValue('data');
    sheet.getRange('B1').setValue('');
  }
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action || '';
  if (action === 'load') {
    return loadData();
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'save_all') {
      return saveData(body);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function loadData() {
  try {
    const sheet = getSheet();
    const raw = sheet.getRange('B1').getValue();
    if (!raw) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', data: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const data = JSON.parse(raw);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── サーバー側マージヘルパー ────────────────────────────────

function mergeAllEvents(stored, incoming) {
  const SFXS = ['_acc', '_memo', '_updatedAt', '_recur_cancel', '_recur_hidden', '_attachments', '_note'];
  const merged = JSON.parse(JSON.stringify(stored));
  Object.keys(incoming).forEach(function(monthKey) {
    if (!merged[monthKey]) merged[monthKey] = {};
    const days = incoming[monthKey];
    Object.keys(days).forEach(function(day) {
      const incomingDay = days[day];
      if (!merged[monthKey][day]) {
        merged[monthKey][day] = JSON.parse(JSON.stringify(incomingDay));
      } else {
        const local = merged[monthKey][day];
        const incomingMemberKeys = Object.keys(incomingDay).filter(function(k) {
          return !SFXS.some(function(s) { return k.endsWith(s); });
        });
        incomingMemberKeys.forEach(function(mKey) {
          const localTs    = local[mKey + '_updatedAt']       || 0;
          const incomingTs = incomingDay[mKey + '_updatedAt'] || 0;
          if (incomingTs > localTs || !(mKey in local)) {
            local[mKey] = incomingDay[mKey];
            SFXS.forEach(function(sfx) {
              const k = mKey + sfx;
              if (incomingDay[k] !== undefined) local[k] = incomingDay[k];
              else delete local[k];
            });
          }
        });
        Object.keys(incomingDay).forEach(function(k) {
          if (!SFXS.some(function(s) { return k.endsWith(s); }) && incomingMemberKeys.indexOf(k) >= 0) return;
          if (!(k in local)) local[k] = incomingDay[k];
        });
      }
    });
  });
  return merged;
}

function mergeRecurEvents(stored, incoming) {
  const result = JSON.parse(JSON.stringify(stored));
  const storedMap = {};
  result.forEach(function(r, i) { storedMap[r.id] = i; });
  incoming.forEach(function(r) {
    if (r.id in storedMap) {
      if ((r._updatedAt || 0) > (result[storedMap[r.id]]._updatedAt || 0)) {
        result[storedMap[r.id]] = r;
      }
    } else {
      storedMap[r.id] = result.length;
      result.push(r);
    }
  });
  return result;
}

function mergeDeletedSpanIds(stored, incoming) {
  const result = JSON.parse(JSON.stringify(stored));
  const storedSet = {};
  stored.forEach(function(d) { storedSet[d.id] = true; });
  incoming.forEach(function(d) {
    if (!storedSet[d.id]) { result.push(d); storedSet[d.id] = true; }
  });
  return result;
}

function mergeSpanEvents(stored, incoming, allDeletedIds) {
  const deletedSet = {};
  allDeletedIds.forEach(function(d) { deletedSet[d.id] = true; });
  const result = JSON.parse(JSON.stringify(stored)).filter(function(s) { return !deletedSet[s.id]; });
  const resultMap = {};
  result.forEach(function(s, i) { resultMap[s.id] = i; });
  incoming.forEach(function(rs) {
    if (deletedSet[rs.id]) return;
    if (rs.id in resultMap) {
      if ((rs._updatedAt || 0) > (result[resultMap[rs.id]]._updatedAt || 0)) {
        result[resultMap[rs.id]] = rs;
      }
    } else {
      resultMap[rs.id] = result.length;
      result.push(rs);
    }
  });
  return result;
}

// ── 保存（サーバー側マージ） ────────────────────────────────

function saveData(body) {
  try {
    const sheet = getSheet();
    const raw = sheet.getRange('B1').getValue();
    const stored = raw ? JSON.parse(raw) : {
      members: [], allEvents: {}, recurEvents: [],
      spanEvents: [], deletedSpanIds: [], attachmentsData: {}
    };

    const incomingDeletedSpanIds = body.deletedSpanIds || [];
    const mergedDeletedSpanIds   = mergeDeletedSpanIds(stored.deletedSpanIds || [], incomingDeletedSpanIds);

    const incomingMembers = body.members || [];
    const mergedMembers   = incomingMembers.length >= (stored.members || []).length
      ? incomingMembers
      : (stored.members || []);

    const incomingAttachments = body.attachmentsData || {};
    const mergedAttachments   = Object.assign({}, stored.attachmentsData || {}, incomingAttachments);

    const data = {
      members:         mergedMembers,
      allEvents:       mergeAllEvents(stored.allEvents || {}, body.allEvents || {}),
      recurEvents:     mergeRecurEvents(stored.recurEvents || [], body.recurEvents || []),
      spanEvents:      mergeSpanEvents(stored.spanEvents || [], body.spanEvents || [], mergedDeletedSpanIds),
      deletedSpanIds:  mergedDeletedSpanIds,
      attachmentsData: mergedAttachments,
      _savedAt:        new Date().toISOString(),
    };

    sheet.getRange('B1').setValue(JSON.stringify(data));
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
