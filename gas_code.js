// ════════════════════════════════════════════════════════════
//  家族カレンダー  Google Apps Script バックエンド
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

function saveData(body) {
  try {
    const sheet = getSheet();
    const data = {
      members:        body.members        || [],
      allEvents:      body.allEvents      || {},
      recurEvents:    body.recurEvents    || [],
      spanEvents:     body.spanEvents     || [],
      deletedSpanIds: body.deletedSpanIds || [],
      attachmentsData: body.attachmentsData || {},
      _savedAt: new Date().toISOString(),
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
